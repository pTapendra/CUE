import type { CanvasClientFactory } from "../canvas/CanvasClient.js";
import { decrypt, encrypt } from "../crypto.js";
import type { ScheduleService } from "../schedule/ScheduleService.js";
import type { CanvasReaderRepository } from "./CanvasReaderRepository.js";
import type { ItemKind, ProposedCourse, ProposedItem, SyncPreview } from "./types.js";

export class CanvasNotConnectedError extends Error {
  constructor() {
    super("Canvas is not connected");
    this.name = "CanvasNotConnectedError";
  }
}

export class SyncExpiredError extends Error {
  constructor() {
    super("This sync has expired; please sync again");
    this.name = "SyncExpiredError";
  }
}

export class InvalidCanvasUrlError extends Error {
  constructor(reason: string) {
    super(`Invalid Canvas address: ${reason}`);
    this.name = "InvalidCanvasUrlError";
  }
}

const EXAM_WORDS = /\b(exam|midterm|mid-term|final|test)\b/i;
const DAY = 24 * 60 * 60 * 1000;
const PREVIEW_TTL = 30 * 60 * 1000;

export interface CanvasReaderOptions {
  secretKey: Buffer;
  /** Allows http:// and local addresses, for development against a local fake Canvas. */
  allowInsecureUrls?: boolean;
  now?: () => Date;
}

/** Canvas Reader (UC1): read-only sync that the student confirms before anything is stored. */
export class CanvasReaderService {
  private readonly now: () => Date;

  constructor(
    private readonly repo: CanvasReaderRepository,
    private readonly schedule: ScheduleService,
    private readonly makeClient: CanvasClientFactory,
    private readonly opts: CanvasReaderOptions,
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  status(studentId: string) {
    const c = this.repo.getConnection(studentId);
    return { connected: c != null, baseUrl: c?.baseUrl ?? null, lastSyncedAt: c?.lastSyncedAt ?? null };
  }

  /** Checks the token with one read before storing it, encrypted. */
  async connect(studentId: string, baseUrl: string, token: string): Promise<void> {
    const url = this.checkUrl(baseUrl);
    await this.makeClient(url, token).listCourses();
    this.repo.saveConnection(studentId, url, encrypt(token, this.opts.secretKey));
  }

  disconnect(studentId: string): void {
    this.repo.deleteConnection(studentId);
  }

  /** Reads Canvas and returns items to confirm. Stores nothing in the schedule. */
  async preview(studentId: string): Promise<SyncPreview> {
    const conn = this.repo.getConnection(studentId);
    if (!conn) throw new CanvasNotConnectedError();
    const client = this.makeClient(conn.baseUrl, decrypt(conn.tokenSealed, this.opts.secretKey));

    const now = this.now();
    const from = new Date(now.getTime() - DAY);
    const to = new Date(now.getTime() + 180 * DAY);
    const imported = this.schedule.importedCanvasIds(studentId);

    const canvasCourses = await client.listCourses();
    const courses: ProposedCourse[] = canvasCourses.map((c) => ({ externalId: c.id, name: c.name, code: c.courseCode }));
    const nameOf = new Map(courses.map((c) => [c.externalId, c.name]));
    const items: ProposedItem[] = [];

    for (const course of canvasCourses) {
      for (const a of await client.listAssignments(course.id)) {
        const kind: ItemKind = EXAM_WORDS.test(a.name) ? "exam" : "assignment";
        if (!keep(a.dueAt, kind, from)) continue;
        const externalId = `assignment:${a.id}`;
        items.push({
          key: externalId,
          externalId,
          courseExternalId: course.id,
          courseName: course.name,
          kind,
          title: a.name,
          dueAt: a.dueAt,
          needsDate: kind === "exam" && !a.dueAt,
          alreadyImported: imported.has(externalId),
        });
      }
    }

    const events = await client.listCalendarEvents(canvasCourses.map((c) => c.id), from, to);
    for (const e of events) {
      const kind: ItemKind = EXAM_WORDS.test(e.title) ? "exam" : "event";
      if (!keep(e.startAt, kind, from)) continue;
      const externalId = `event:${e.id}`;
      items.push({
        key: externalId,
        externalId,
        courseExternalId: e.courseId,
        courseName: nameOf.get(e.courseId) ?? "Course",
        kind,
        title: e.title,
        dueAt: e.startAt,
        needsDate: kind === "exam" && !e.startAt,
        alreadyImported: imported.has(externalId),
      });
    }

    items.sort((x, y) => (x.dueAt ?? "9999").localeCompare(y.dueAt ?? "9999"));
    this.repo.markSynced(studentId, now);
    return this.repo.savePreview(studentId, { courses, items }, PREVIEW_TTL);
  }

  /**
   * Stores the items the student accepted. `dates` lets the student fill in
   * a date Canvas did not give (for example an exam), keyed by item key.
   */
  confirm(studentId: string, syncId: string, acceptKeys: string[], dates: Record<string, string> = {}): number {
    const preview = this.repo.takePreview(studentId, syncId);
    if (!preview) throw new SyncExpiredError();
    const accepted = new Set(acceptKeys);
    const items = preview.items
      .filter((i) => accepted.has(i.key))
      .map((i) => ({
        externalId: i.externalId,
        courseExternalId: i.courseExternalId,
        kind: i.kind,
        title: i.title,
        dueAt: dates[i.key] ?? i.dueAt,
      }));
    const used = new Set(items.map((i) => i.courseExternalId));
    const courses = preview.courses.filter((c) => used.has(c.externalId));
    return this.schedule.importFromCanvas(studentId, { courses, items });
  }

  private checkUrl(raw: string): string {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      throw new InvalidCanvasUrlError("not a web address");
    }
    if (!this.opts.allowInsecureUrls) {
      if (url.protocol !== "https:") throw new InvalidCanvasUrlError("must start with https://");
      const host = url.hostname;
      if (host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":")) {
        throw new InvalidCanvasUrlError("must be your school's Canvas domain");
      }
    }
    return url.origin;
  }
}

/** Keeps dated work from `from` onward, and undated exams so the student can add the date. */
function keep(date: string | null, kind: ItemKind, from: Date): boolean {
  if (!date) return kind === "exam";
  return Date.parse(date) >= from.getTime();
}
