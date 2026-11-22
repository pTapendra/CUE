import { randomUUID } from "node:crypto";
import type { SavedCanvasItem } from "../canvasReader/diff.js";
import type { Db } from "../db.js";

export type Source = "canvas" | "manual";
export type ItemKind = "assignment" | "exam" | "event";
export type ItemStatus = "not_started" | "in_progress" | "done" | "postponed";

export interface Course {
  id: string;
  source: Source;
  name: string;
  code: string | null;
}

export interface Item {
  id: string;
  courseId: string | null;
  courseName: string | null;
  source: Source;
  kind: ItemKind;
  title: string;
  dueAt: string | null;
  endsAt: string | null;
  allDay: boolean;
  /** Raw column; null means "use the default". */
  studyMinutes: number | null;
  status: ItemStatus;
}

export type BlockState = "proposed" | "accepted" | "rejected";

export interface StudyBlock {
  id: string;
  itemId: string;
  startsAt: string;
  endsAt: string;
  state: BlockState;
}

interface ItemRow {
  id: string;
  course_id: string | null;
  course_name: string | null;
  source: Source;
  kind: ItemKind;
  title: string;
  due_at: string | null;
  ends_at: string | null;
  all_day: number;
  study_minutes: number | null;
  status: ItemStatus;
}

const toItem = (r: ItemRow): Item => ({
  id: r.id,
  courseId: r.course_id,
  courseName: r.course_name,
  source: r.source,
  kind: r.kind,
  title: r.title,
  dueAt: r.due_at,
  endsAt: r.ends_at,
  allDay: r.all_day === 1,
  studyMinutes: r.study_minutes,
  status: r.status,
});

const ITEM_SELECT = `
  SELECT i.id, i.course_id, c.name AS course_name, i.source, i.kind, i.title, i.due_at, i.ends_at, i.all_day,
         i.study_minutes, i.status
  FROM items i LEFT JOIN courses c ON c.id = i.course_id`;

const BLOCK_SELECT = "SELECT id, item_id AS itemId, starts_at AS startsAt, ends_at AS endsAt, state FROM study_blocks";

const placeholders = (values: unknown[]) => values.map(() => "?").join(", ");

/** Data owned by the Schedule Manager: courses, schedule items and study blocks. */
export class ScheduleRepository {
  constructor(private readonly db: Db) {}

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  listCourses(studentId: string): Course[] {
    return this.db
      .prepare("SELECT id, source, name, code FROM courses WHERE student_id = ? ORDER BY name")
      .all(studentId) as Course[];
  }

  findCourse(studentId: string, courseId: string): Course | null {
    return (this.db
      .prepare("SELECT id, source, name, code FROM courses WHERE student_id = ? AND id = ?")
      .get(studentId, courseId) as Course | undefined) ?? null;
  }

  upsertCanvasCourse(studentId: string, externalId: string, name: string, code: string | null): string {
    const existing = this.db
      .prepare("SELECT id FROM courses WHERE student_id = ? AND source = 'canvas' AND external_id = ?")
      .get(studentId, externalId) as { id: string } | undefined;
    if (existing) {
      this.db.prepare("UPDATE courses SET name = ?, code = ? WHERE id = ?").run(name, code, existing.id);
      return existing.id;
    }
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO courses (id, student_id, source, external_id, name, code) VALUES (?, ?, 'canvas', ?, ?, ?)")
      .run(id, studentId, externalId, name, code);
    return id;
  }

  createManualCourse(studentId: string, name: string, code: string | null): Course {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO courses (id, student_id, source, external_id, name, code) VALUES (?, ?, 'manual', ?, ?, ?)")
      .run(id, studentId, id, name, code);
    return { id, source: "manual", name, code };
  }

  /** Canvas external ids of items this student has already imported. */
  importedExternalIds(studentId: string): Set<string> {
    const rows = this.db
      .prepare("SELECT external_id FROM items WHERE student_id = ? AND source = 'canvas'")
      .all(studentId) as { external_id: string }[];
    return new Set(rows.map((r) => r.external_id));
  }

  /** Updates a saved Canvas course's name and code; does nothing if Cue doesn't have it. */
  refreshCanvasCourse(studentId: string, externalId: string, name: string, code: string | null): void {
    this.db
      .prepare("UPDATE courses SET name = ?, code = ? WHERE student_id = ? AND source = 'canvas' AND external_id = ?")
      .run(name, code, studentId, externalId);
  }

  /** Every Canvas item this student saved, with its course's Canvas ID. */
  savedCanvasItems(studentId: string): SavedCanvasItem[] {
    const rows = this.db
      .prepare(
        `SELECT i.id, i.external_id, c.external_id AS course_external_id, c.name AS course_name, i.kind, i.title,
                i.due_at, i.ends_at, i.all_day
         FROM items i LEFT JOIN courses c ON c.id = i.course_id
         WHERE i.student_id = ? AND i.source = 'canvas'`,
      )
      .all(studentId) as {
      id: string;
      external_id: string;
      course_external_id: string | null;
      course_name: string | null;
      kind: ItemKind;
      title: string;
      due_at: string | null;
      ends_at: string | null;
      all_day: number;
    }[];
    return rows.map((r) => ({
      itemId: r.id,
      externalId: r.external_id,
      courseExternalId: r.course_external_id,
      courseName: r.course_name,
      kind: r.kind,
      title: r.title,
      dueAt: r.due_at,
      endsAt: r.ends_at,
      allDay: r.all_day === 1,
    }));
  }

  /**
   * Gives a saved Canvas item Canvas's title, dates and all-day flag. Without a Canvas date the
   * saved date and end stay. False if the item is gone.
   */
  updateCanvasItem(
    studentId: string,
    itemId: string,
    v: { title: string; dueAt: string | null; endsAt: string | null; allDay: boolean },
  ): boolean {
    const keepDates = v.dueAt === null ? 1 : 0;
    return (
      this.db
        .prepare(
          `UPDATE items SET title = ?, all_day = ?, updated_at = ?,
             due_at = CASE WHEN ? THEN due_at ELSE ? END,
             ends_at = CASE WHEN ? THEN ends_at ELSE ? END
           WHERE student_id = ? AND id = ? AND source = 'canvas'`,
        )
        .run(v.title, v.allDay ? 1 : 0, new Date().toISOString(), keepDates, v.dueAt, keepDates, v.endsAt, studentId, itemId).changes > 0
    );
  }

  /**
   * Inserts or refreshes a Canvas item. On refresh the student's kind and status stay, and so does
   * the saved date when Canvas has none.
   */
  upsertCanvasItem(
    studentId: string,
    v: { externalId: string; courseId: string; kind: ItemKind; title: string; dueAt: string | null; endsAt: string | null; allDay: boolean },
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO items (id, student_id, course_id, source, external_id, kind, title, due_at, ends_at, all_day, created_at, updated_at)
         VALUES (?, ?, ?, 'canvas', ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (student_id, source, external_id) DO UPDATE SET
           course_id = excluded.course_id, title = excluded.title,
           due_at = COALESCE(excluded.due_at, items.due_at),
           ends_at = CASE WHEN excluded.due_at IS NULL THEN items.ends_at ELSE excluded.ends_at END,
           all_day = excluded.all_day, updated_at = excluded.updated_at`,
      )
      .run(randomUUID(), studentId, v.courseId, v.externalId, v.kind, v.title, v.dueAt, v.endsAt, v.allDay ? 1 : 0, now, now);
  }

  createManualItem(
    studentId: string,
    v: { courseId: string | null; kind: ItemKind; title: string; dueAt: string | null; endsAt?: string | null; studyMinutes?: number | null },
  ): Item {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO items (id, student_id, course_id, source, external_id, kind, title, due_at, ends_at, study_minutes, created_at, updated_at)
         VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, studentId, v.courseId, id, v.kind, v.title, v.dueAt, v.endsAt ?? null, v.studyMinutes ?? null, now, now);
    return this.findItem(studentId, id)!;
  }

  findItem(studentId: string, itemId: string): Item | null {
    const row = this.db.prepare(`${ITEM_SELECT} WHERE i.student_id = ? AND i.id = ?`).get(studentId, itemId) as
      | ItemRow
      | undefined;
    return row ? toItem(row) : null;
  }

  updateItem(
    studentId: string,
    itemId: string,
    v: Partial<{
      courseId: string | null;
      kind: ItemKind;
      title: string;
      dueAt: string | null;
      endsAt: string | null;
      studyMinutes: number | null;
      status: ItemStatus;
    }>,
  ): Item | null {
    const sets: string[] = [];
    const args: unknown[] = [];
    const columns = { courseId: "course_id", kind: "kind", title: "title", dueAt: "due_at",
      endsAt: "ends_at",
      studyMinutes: "study_minutes",
      status: "status" } as const;
    for (const [field, column] of Object.entries(columns)) {
      if (field in v) {
        sets.push(`${column} = ?`);
        args.push((v as Record<string, unknown>)[field]);
      }
    }
    if (sets.length > 0) {
      sets.push("updated_at = ?");
      args.push(new Date().toISOString(), studentId, itemId);
      this.db.prepare(`UPDATE items SET ${sets.join(", ")} WHERE student_id = ? AND id = ?`).run(...args);
    }
    return this.findItem(studentId, itemId);
  }

  deleteItem(studentId: string, itemId: string): boolean {
    return this.db.prepare("DELETE FROM items WHERE student_id = ? AND id = ?").run(studentId, itemId).changes > 0;
  }

  /** Items due in [from, to), earliest first. */
  itemsDueBetween(studentId: string, from: Date, to: Date): Item[] {
    const rows = this.db
      .prepare(`${ITEM_SELECT} WHERE i.student_id = ? AND i.due_at >= ? AND i.due_at < ? ORDER BY i.due_at, i.title`)
      .all(studentId, from.toISOString(), to.toISOString()) as ItemRow[];
    return rows.map(toItem);
  }

  undatedItems(studentId: string): Item[] {
    const rows = this.db
      .prepare(`${ITEM_SELECT} WHERE i.student_id = ? AND i.due_at IS NULL ORDER BY i.kind, i.title`)
      .all(studentId) as ItemRow[];
    return rows.map(toItem);
  }

  /** Exams and assignments, the items study blocks are planned for. */
  studyItems(studentId: string): Item[] {
    const rows = this.db
      .prepare(`${ITEM_SELECT} WHERE i.student_id = ? AND i.kind IN ('exam', 'assignment') ORDER BY i.due_at, i.title`)
      .all(studentId) as ItemRow[];
    return rows.map(toItem);
  }

  /**
   * Dated events and exams that are not all-day and overlap [from, to), earliest first.
   * Each one takes up [due_at, ends_at), or one hour when the end is unknown (missing or not after the start).
   */
  busyItems(studentId: string, from: Date, to: Date): Item[] {
    const rows = this.db
      .prepare(
        `${ITEM_SELECT}
         WHERE i.student_id = ? AND i.kind IN ('event', 'exam') AND i.due_at IS NOT NULL AND i.all_day = 0
           AND i.due_at < ?
           AND CASE WHEN i.ends_at > i.due_at THEN i.ends_at
                    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', i.due_at, '+1 hour') END > ?
         ORDER BY i.due_at, i.title`,
      )
      .all(studentId, to.toISOString(), from.toISOString()) as ItemRow[];
    return rows.map(toItem);
  }

  /** The student's blocks in the given states, earliest first. */
  listBlocks(studentId: string, states: BlockState[]): StudyBlock[] {
    if (states.length === 0) return [];
    return this.db
      .prepare(`${BLOCK_SELECT} WHERE student_id = ? AND state IN (${placeholders(states)}) ORDER BY starts_at`)
      .all(studentId, ...states) as StudyBlock[];
  }

  findBlock(studentId: string, id: string): StudyBlock | null {
    return (this.db.prepare(`${BLOCK_SELECT} WHERE student_id = ? AND id = ?`).get(studentId, id) as
      | StudyBlock
      | undefined) ?? null;
  }

  insertBlocks(studentId: string, blocks: Omit<StudyBlock, "id">[]): void {
    const now = new Date().toISOString();
    const insert = this.db.prepare(
      `INSERT INTO study_blocks (id, student_id, item_id, starts_at, ends_at, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const b of blocks) insert.run(randomUUID(), studentId, b.itemId, b.startsAt, b.endsAt, b.state, now, now);
  }

  updateBlock(studentId: string, id: string, v: Partial<Pick<StudyBlock, "startsAt" | "endsAt" | "state">>): boolean {
    const sets = ["updated_at = ?"];
    const args: unknown[] = [new Date().toISOString()];
    const columns = { startsAt: "starts_at", endsAt: "ends_at", state: "state" } as const;
    for (const [field, column] of Object.entries(columns)) {
      if (field in v) {
        sets.push(`${column} = ?`);
        args.push((v as Record<string, unknown>)[field]);
      }
    }
    return this.db
      .prepare(`UPDATE study_blocks SET ${sets.join(", ")} WHERE student_id = ? AND id = ?`)
      .run(...args, studentId, id).changes > 0;
  }

  deleteBlocks(studentId: string, ids: string[]): void {
    if (ids.length === 0) return;
    this.db
      .prepare(`DELETE FROM study_blocks WHERE student_id = ? AND id IN (${placeholders(ids)})`)
      .run(studentId, ...ids);
  }

  deleteBlocksInState(studentId: string, state: BlockState): void {
    this.db.prepare("DELETE FROM study_blocks WHERE student_id = ? AND state = ?").run(studentId, state);
  }
}
