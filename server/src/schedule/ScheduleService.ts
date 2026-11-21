import type { AcceptedBlock, BlockRef, Interval, PlanItem } from "../planner/types.js";
import type { Course, Item, ItemKind, ItemStatus, ScheduleRepository, StudyBlock } from "./ScheduleRepository.js";

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

/** A move the student asked for that breaks one of the move rules; the message says which. */
export class BlockMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockMoveError";
  }
}

/** Item details the API accepted but that do not fit together; the message says which. */
export class InvalidItemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidItemError";
  }
}

/** Stores dates in one canonical form so they compare correctly as text. */
export function normalizeDate(value: string | null): string | null {
  if (value == null) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new Error(`Invalid date: ${value}`);
  return new Date(t).toISOString();
}

export interface CanvasImport {
  courses: { externalId: string; name: string; code: string | null }[];
  items: { externalId: string; courseExternalId: string; kind: ItemKind; title: string; dueAt: string | null; endsAt: string | null; allDay: boolean }[];
}

export interface BlockView {
  id: string;
  itemId: string;
  itemTitle: string;
  itemKind: ItemKind;
  courseName: string | null;
  itemDueAt: string | null;
  /** The item's study time, resolved (its own amount, else the default for its kind). */
  itemStudyMinutes: number;
  startsAt: string;
  endsAt: string;
  state: "proposed" | "accepted";
  /** "Block `index` of `total`" for its item. */
  index: number;
  total: number;
  /** For an accepted block: the first busy item it overlaps. */
  clash: { title: string; startsAt: string; endsAt: string } | null;
}

export interface Overview {
  items: Item[];
  undated: Item[];
  blocks: BlockView[];
}

export interface Week {
  from: string;
  to: string;
  items: Item[];
  /** Items with no date yet, such as exams Canvas did not list a date for. */
  undated: Item[];
  blocks: BlockView[];
}

export interface ScheduleOptions {
  defaultStudyMinutes: { exam: number; assignment: number };
  blockMinutes: number;
  now?: () => Date;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const END_OF_TIME = new Date("9999-12-31T23:59:59.999Z");

const overlaps = (a: Interval, b: Interval) =>
  Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);

/** True when the end is after the start. An end that is not means the end is unknown. */
function endsAfterStart(dueAt: string, endsAt: string | null): endsAt is string {
  return endsAt !== null && Date.parse(endsAt) > Date.parse(dueAt);
}

/** The time a busy item takes up: until its end, or one hour when the end is unknown. */
function busyInterval(item: Item): Interval {
  const startsAt = item.dueAt!; // busy items are always dated
  const endsAt = endsAfterStart(startsAt, item.endsAt) ? item.endsAt : new Date(Date.parse(startsAt) + HOUR_MS).toISOString();
  return { startsAt, endsAt };
}

/** Refuses an end that is not after the start. */
function checkEnd(dueAt: string | null, endsAt: string | null): void {
  if (dueAt !== null && endsAt !== null && !endsAfterStart(dueAt, endsAt)) {
    throw new InvalidItemError("endsAt: must be after dueAt");
  }
}

/**
 * Schedule Manager (UC2): the student's courses, dated work and study blocks.
 * Items it returns carry their resolved study time.
 */
export class ScheduleService {
  private readonly listeners: ((studentId: string) => void)[] = [];
  /** The service's clock; the API reads it so the overview agrees with the planner. */
  readonly now: () => Date;

  constructor(
    private readonly repo: ScheduleRepository,
    private readonly opts: ScheduleOptions,
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  /** Called with the student's id after each change to their items or a block they rejected or moved. */
  onChange(listener: (studentId: string) => void): void {
    this.listeners.push(listener);
  }

  /** Tells the listeners about a change saved elsewhere, such as items moved in from another account. */
  markChanged(studentId: string): void {
    this.emit(studentId);
  }

  listCourses(studentId: string): Course[] {
    return this.repo.listCourses(studentId);
  }

  addCourse(studentId: string, name: string, code: string | null): Course {
    return this.repo.createManualCourse(studentId, name, code);
  }

  /** The schedule from `from` for a number of days, or up to an end instant. */
  getWeek(studentId: string, from: Date, until: number | Date = 7): Week {
    const to = until instanceof Date ? until : new Date(from.getTime() + until * DAY_MS);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      items: this.repo.itemsDueBetween(studentId, from, to).map((item) => this.present(item)),
      undated: this.repo.undatedItems(studentId).map((item) => this.present(item)),
      blocks: this.blocksBetween(studentId, from, to),
    };
  }

  /**
   * Everything the overview screens need in one read: items due from 30 days back to 200 days ahead,
   * every undated item, and the proposed and accepted blocks that have not ended within 200 days.
   */
  getOverview(studentId: string, now: Date): Overview {
    const from = new Date(now.getTime() - 30 * DAY_MS);
    const to = new Date(now.getTime() + 200 * DAY_MS);
    return {
      items: this.repo.itemsDueBetween(studentId, from, to).map((item) => this.present(item)),
      undated: this.repo.undatedItems(studentId).map((item) => this.present(item)),
      blocks: this.blocksBetween(studentId, now, to),
    };
  }

  /** Called by the Canvas Reader once the student has confirmed a sync. */
  importFromCanvas(studentId: string, data: CanvasImport): number {
    const imported = this.repo.transaction(() => {
      const courseIds = new Map<string, string>();
      for (const c of data.courses) {
        courseIds.set(c.externalId, this.repo.upsertCanvasCourse(studentId, c.externalId, c.name, c.code));
      }
      for (const item of data.items) {
        const courseId = courseIds.get(item.courseExternalId);
        if (!courseId) continue;
        const dueAt = normalizeDate(item.dueAt);
        const endsAt = normalizeDate(item.endsAt);
        this.repo.upsertCanvasItem(studentId, {
          externalId: item.externalId,
          courseId,
          kind: item.kind,
          title: item.title,
          dueAt,
          // Canvas may give an end that is not after the start; that end is unknown.
          endsAt: dueAt !== null && endsAfterStart(dueAt, endsAt) ? endsAt : null,
          allDay: item.allDay,
        });
      }
      return data.items.length;
    });
    this.emit(studentId);
    return imported;
  }

  importedCanvasIds(studentId: string): Set<string> {
    return this.repo.importedExternalIds(studentId);
  }

  addItem(
    studentId: string,
    v: { courseId: string | null; kind: ItemKind; title: string; dueAt: string | null; endsAt?: string | null; studyMinutes?: number },
  ): Item {
    this.checkCourse(studentId, v.courseId);
    const dueAt = normalizeDate(v.dueAt);
    const endsAt = normalizeDate(v.endsAt ?? null);
    checkEnd(dueAt, endsAt);
    const item = this.repo.createManualItem(studentId, { ...v, dueAt, endsAt });
    this.emit(studentId);
    return this.present(item);
  }

  updateItem(
    studentId: string,
    itemId: string,
    v: Partial<{ courseId: string | null; kind: ItemKind; title: string; dueAt: string | null; endsAt: string | null; studyMinutes: number }>,
  ): Item {
    const saved = this.repo.findItem(studentId, itemId);
    if (!saved) throw new NotFoundError("Item");
    if ("courseId" in v) this.checkCourse(studentId, v.courseId ?? null);
    const changes = {
      ...v,
      ...("dueAt" in v ? { dueAt: normalizeDate(v.dueAt ?? null) } : {}),
      ...("endsAt" in v ? { endsAt: normalizeDate(v.endsAt ?? null) } : {}),
    };
    // A new end is compared with the new start, or with the saved one when the start does not change.
    if ("endsAt" in changes) checkEnd("dueAt" in changes ? (changes.dueAt ?? null) : saved.dueAt, changes.endsAt ?? null);
    const item = this.repo.updateItem(studentId, itemId, changes)!;
    this.emit(studentId);
    return this.present(item);
  }

  setStatus(studentId: string, itemId: string, status: ItemStatus): Item {
    const item = this.repo.updateItem(studentId, itemId, { status });
    if (!item) throw new NotFoundError("Item");
    this.emit(studentId);
    return this.present(item);
  }

  deleteItem(studentId: string, itemId: string): void {
    if (!this.repo.deleteItem(studentId, itemId)) throw new NotFoundError("Item");
    this.emit(studentId);
  }

  // --- Study blocks ---

  /** Everything the Planner needs to plan this student's study blocks. */
  planningSnapshot(studentId: string): { items: PlanItem[]; busy: Interval[]; accepted: AcceptedBlock[]; rejected: BlockRef[] } {
    const since = new Date(this.now().getTime() - DAY_MS);
    return {
      items: this.repo.studyItems(studentId).map((item) => this.toPlanItem(item)),
      busy: this.repo.busyItems(studentId, since, END_OF_TIME).map(busyInterval),
      accepted: this.repo
        .listBlocks(studentId, ["accepted"])
        .map(({ id, itemId, startsAt, endsAt }) => ({ id, itemId, startsAt, endsAt })),
      rejected: this.repo
        .listBlocks(studentId, ["rejected"])
        .map(({ itemId, startsAt, endsAt }) => ({ itemId, startsAt, endsAt })),
    };
  }

  /** Saves a new plan: replaces every suggestion and removes the listed accepted blocks. */
  applyPlan(studentId: string, plan: { proposed: BlockRef[]; removeAccepted: string[] }): void {
    this.repo.transaction(() => {
      this.repo.deleteBlocksInState(studentId, "proposed");
      this.repo.deleteBlocks(studentId, plan.removeAccepted);
      this.repo.insertBlocks(
        studentId,
        plan.proposed.map(({ itemId, startsAt, endsAt }) => ({ itemId, startsAt, endsAt, state: "proposed" as const })),
      );
    });
  }

  /** Accepts one block. A suggestion whose start has passed is gone. */
  acceptBlock(studentId: string, id: string): void {
    const block = this.findLiveBlock(studentId, id);
    if (block.state === "proposed" && this.hasStarted(block)) throw new NotFoundError("Block");
    this.repo.updateBlock(studentId, id, { state: "accepted" });
  }

  /** Accepts every suggestion that starts in [from, to) and has not started yet. Returns how many. */
  acceptBlocks(studentId: string, from: Date, to: Date): number {
    const inRange = (b: StudyBlock) =>
      !this.hasStarted(b) && Date.parse(b.startsAt) >= from.getTime() && Date.parse(b.startsAt) < to.getTime();
    return this.repo.transaction(() => {
      const ids = this.repo.listBlocks(studentId, ["proposed"]).filter(inRange).map((b) => b.id);
      for (const id of ids) this.repo.updateBlock(studentId, id, { state: "accepted" });
      return ids.length;
    });
  }

  /** "Not this time": the slot is remembered as rejected for the block's item. */
  rejectBlock(studentId: string, id: string): void {
    this.findLiveBlock(studentId, id);
    this.repo.updateBlock(studentId, id, { state: "rejected" });
    this.emit(studentId);
  }

  /** Moves a block to a new start, keeping its length; it becomes accepted and its old slot is rejected. */
  moveBlock(studentId: string, id: string, startsAt: string): void {
    const block = this.findLiveBlock(studentId, id);
    const item = this.repo.findItem(studentId, block.itemId)!;
    const start = Date.parse(normalizeDate(startsAt)!);
    const length = Date.parse(block.endsAt) - Date.parse(block.startsAt);
    const target = { startsAt: new Date(start).toISOString(), endsAt: new Date(start + length).toISOString() };

    if (start < this.now().getTime()) throw new BlockMoveError("Pick a time in the future.");
    if (item.dueAt === null || Date.parse(target.endsAt) > Date.parse(item.dueAt)) {
      throw new BlockMoveError("Pick a time before the deadline.");
    }
    const clash = this.firstBusy(studentId, target);
    if (clash) throw new BlockMoveError(`Clashes with ${clash.title}.`);
    const taken = this.repo.listBlocks(studentId, ["accepted"]).some((b) => b.id !== id && overlaps(b, target));
    if (taken) throw new BlockMoveError("You already have a study block then.");

    this.repo.transaction(() => {
      this.repo.insertBlocks(studentId, [{ itemId: block.itemId, startsAt: block.startsAt, endsAt: block.endsAt, state: "rejected" }]);
      this.repo.updateBlock(studentId, id, { ...target, state: "accepted" });
    });
    this.emit(studentId);
  }

  /**
   * Accepted blocks and suggestions that have not started, overlapping [from, to),
   * numbered among all of their item's blocks.
   */
  private blocksBetween(studentId: string, from: Date, to: Date): BlockView[] {
    const range = { startsAt: from.toISOString(), endsAt: to.toISOString() };
    const blocks = this.repo
      .listBlocks(studentId, ["proposed", "accepted"])
      .filter((b) => b.state === "accepted" || !this.hasStarted(b));
    const index = new Map<string, number>();
    const count = new Map<string, number>();
    for (const b of blocks) {
      const n = (count.get(b.itemId) ?? 0) + 1;
      count.set(b.itemId, n);
      index.set(b.id, n);
    }

    const shown = blocks.filter((b) => overlaps(b, range));
    // Blocks are deleted with their item, so each one's item exists.
    const items = new Map(
      [...new Set(shown.map((b) => b.itemId))].map((itemId) => [itemId, this.present(this.repo.findItem(studentId, itemId)!)]),
    );

    return shown.map((b) => {
      const item = items.get(b.itemId)!;
      const needed = Math.ceil((item.studyMinutes ?? 0) / this.opts.blockMinutes);
      const clash = b.state === "accepted" ? this.firstBusy(studentId, b) : null;
      return {
        id: b.id,
        itemId: b.itemId,
        itemTitle: item.title,
        itemKind: item.kind,
        courseName: item.courseName,
        itemDueAt: item.dueAt,
        itemStudyMinutes: item.studyMinutes ?? 0,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        state: b.state as BlockView["state"],
        index: index.get(b.id)!,
        total: Math.max(needed, count.get(b.itemId)!),
        clash: clash ? { title: clash.title, ...busyInterval(clash) } : null,
      };
    });
  }

  /** The earliest busy item overlapping the interval, if any. */
  private firstBusy(studentId: string, interval: Interval): Item | null {
    return this.repo.busyItems(studentId, new Date(interval.startsAt), new Date(interval.endsAt))[0] ?? null;
  }

  private hasStarted(block: StudyBlock): boolean {
    return Date.parse(block.startsAt) < this.now().getTime();
  }

  /** A block the student can still act on: it exists and was not rejected. */
  private findLiveBlock(studentId: string, id: string): StudyBlock {
    const block = this.repo.findBlock(studentId, id);
    if (!block || block.state === "rejected") throw new NotFoundError("Block");
    return block;
  }

  private toPlanItem(item: Item): PlanItem {
    const { id, title, kind, dueAt, studyMinutes, status } = this.present(item);
    // studyItems returns only exams and assignments, whose study time always resolves.
    return { id, title, kind: kind as PlanItem["kind"], dueAt, studyMinutes: studyMinutes!, done: status === "done" };
  }

  /** The item with its study time resolved: the stored value, else the default for its kind; none for events. */
  private present(item: Item): Item {
    const studyMinutes = item.kind === "event" ? null : (item.studyMinutes ?? this.opts.defaultStudyMinutes[item.kind]);
    return { ...item, studyMinutes };
  }

  /** Tells each listener; the change is already saved, so a listener that fails is logged and skipped. */
  private emit(studentId: string): void {
    for (const listener of this.listeners) {
      try {
        listener(studentId);
      } catch (err) {
        console.error(err);
      }
    }
  }

  private checkCourse(studentId: string, courseId: string | null | undefined): void {
    if (courseId && !this.repo.findCourse(studentId, courseId)) throw new NotFoundError("Course");
  }
}
