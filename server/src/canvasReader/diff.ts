import { endsAfterStart, normalizeDate } from "../schedule/ScheduleService.js";
import type { ItemKind } from "../schedule/ScheduleRepository.js";
import type { ChangedItem, FieldChange, ProposedCourse, ProposedItem, RemovedItem, SyncGroups } from "./types.js";

/** What one sync read from Canvas. */
export interface CanvasRead {
  courses: ProposedCourse[];
  /** Every assignment and event Canvas returned, before `keep`. */
  items: ProposedItem[];
  /** The dates Canvas's events were read for. */
  from: Date;
  to: Date;
}

/** A Canvas item as Cue saved it. */
export interface SavedCanvasItem {
  itemId: string;
  externalId: string;
  /** The Canvas ID of its course; null if the course is gone from Cue. */
  courseExternalId: string | null;
  courseName: string | null;
  kind: ItemKind;
  title: string;
  dueAt: string | null;
  endsAt: string | null;
  allDay: boolean;
}

/** Keeps dated work from `from` onward, and undated exams so the student can add the date. */
export function keep(date: string | null, kind: ItemKind, from: Date): boolean {
  if (!date) return kind === "exam";
  return Date.parse(date) >= from.getTime();
}

/**
 * Sorts what Canvas has into new, skipped, changed and removed, against what the student saved
 * and skipped. Saved items with nothing different are left out. Items in `unsure` (an event Cue
 * couldn't look up) are never removed.
 */
export function diffCanvas(
  read: CanvasRead,
  saved: SavedCanvasItem[],
  skippedIds: ReadonlySet<string>,
  unsure: ReadonlySet<string> = new Set(),
): SyncGroups {
  const savedById = new Map(saved.map((s) => [s.externalId, s]));
  const seen = new Set<string>();
  const groups: SyncGroups = { newItems: [], skipped: [], changed: [], removed: [] };

  for (const item of read.items) {
    seen.add(item.externalId);
    const mine = savedById.get(item.externalId);
    if (mine) {
      const changed = compare(item, mine);
      if (changed) groups.changed.push(changed);
    } else if (keep(item.dueAt, item.kind, read.from)) {
      (skippedIds.has(item.key) ? groups.skipped : groups.newItems).push(item);
    }
  }

  const listedCourses = new Set(read.courses.map((c) => c.externalId));
  for (const mine of saved) {
    if (seen.has(mine.externalId) || unsure.has(mine.externalId)) continue;
    if (mine.courseExternalId === null || !listedCourses.has(mine.courseExternalId)) continue;
    if (mine.externalId.startsWith("event:") && !withinRead(mine.dueAt, read)) continue;
    groups.removed.push({
      key: mine.externalId,
      itemId: mine.itemId,
      courseName: mine.courseName ?? "Course",
      kind: mine.kind,
      title: mine.title,
      dueAt: mine.dueAt,
    });
  }

  for (const list of [groups.newItems, groups.skipped, groups.changed, groups.removed]) {
    list.sort((x: { dueAt: string | null }, y: { dueAt: string | null }) => (x.dueAt ?? "9999").localeCompare(y.dueAt ?? "9999"));
  }
  return groups;
}

/** The Canvas item as Save would store it, with what differs from the saved one; null if nothing does. */
function compare(item: ProposedItem, mine: SavedCanvasItem): ChangedItem | null {
  const dueAt = normalizeDate(item.dueAt);
  const endsAt = dueAt !== null && endsAfterStart(dueAt, item.endsAt) ? normalizeDate(item.endsAt) : null;
  const changes: FieldChange[] = [];
  if (item.title !== mine.title) changes.push({ field: "title", from: mine.title, to: item.title });
  // Without a Canvas date, Cue keeps its own (such as one the student added to an exam).
  if (dueAt !== null) {
    if (!sameInstant(dueAt, mine.dueAt)) changes.push({ field: "dueAt", from: mine.dueAt, to: dueAt });
    if (!sameInstant(endsAt, mine.endsAt)) changes.push({ field: "endsAt", from: mine.endsAt, to: endsAt });
  }
  if (item.allDay !== mine.allDay) changes.push({ field: "allDay", from: mine.allDay, to: item.allDay });
  if (changes.length === 0) return null;
  return {
    key: item.key,
    itemId: mine.itemId,
    externalId: item.externalId,
    courseExternalId: item.courseExternalId,
    courseName: item.courseName,
    kind: mine.kind,
    title: item.title,
    dueAt,
    endsAt,
    allDay: item.allDay,
    changes,
  };
}

function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Date.parse(a) === Date.parse(b);
}

/** True when a saved date is within the dates Canvas's events were read for. */
function withinRead(dueAt: string | null, read: CanvasRead): boolean {
  if (dueAt === null) return false;
  const t = Date.parse(dueAt);
  return t >= read.from.getTime() && t <= read.to.getTime();
}
