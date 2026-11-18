import { randomUUID } from "node:crypto";
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

/** Data owned by the Schedule Manager: courses and schedule items. */
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

  /** Inserts or refreshes a Canvas item. The student's status is kept on refresh. */
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
           course_id = excluded.course_id, kind = excluded.kind, title = excluded.title,
           due_at = excluded.due_at, ends_at = excluded.ends_at, all_day = excluded.all_day, updated_at = excluded.updated_at`,
      )
      .run(randomUUID(), studentId, v.courseId, v.externalId, v.kind, v.title, v.dueAt, v.endsAt, v.allDay ? 1 : 0, now, now);
  }

  createManualItem(
    studentId: string,
    v: { courseId: string | null; kind: ItemKind; title: string; dueAt: string | null; endsAt?: string | null },
  ): Item {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO items (id, student_id, course_id, source, external_id, kind, title, due_at, ends_at, created_at, updated_at)
         VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, studentId, v.courseId, id, v.kind, v.title, v.dueAt, v.endsAt ?? null, now, now);
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
}
