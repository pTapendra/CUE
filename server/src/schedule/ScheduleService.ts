import type { Course, Item, ItemKind, ItemStatus, ScheduleRepository } from "./ScheduleRepository.js";

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
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

export interface Week {
  from: string;
  to: string;
  items: Item[];
  /** Items with no date yet, such as exams Canvas did not list a date for. */
  undated: Item[];
}

/** Schedule Manager (UC2): the student's courses and dated work. */
export class ScheduleService {
  constructor(private readonly repo: ScheduleRepository) {}

  listCourses(studentId: string): Course[] {
    return this.repo.listCourses(studentId);
  }

  addCourse(studentId: string, name: string, code: string | null): Course {
    return this.repo.createManualCourse(studentId, name, code);
  }

  getWeek(studentId: string, from: Date): Week {
    const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      items: this.repo.itemsDueBetween(studentId, from, to),
      undated: this.repo.undatedItems(studentId),
    };
  }

  /** Called by the Canvas Reader once the student has confirmed a sync. */
  importFromCanvas(studentId: string, data: CanvasImport): number {
    return this.repo.transaction(() => {
      const courseIds = new Map<string, string>();
      for (const c of data.courses) {
        courseIds.set(c.externalId, this.repo.upsertCanvasCourse(studentId, c.externalId, c.name, c.code));
      }
      for (const item of data.items) {
        const courseId = courseIds.get(item.courseExternalId);
        if (!courseId) continue;
        this.repo.upsertCanvasItem(studentId, {
          externalId: item.externalId,
          courseId,
          kind: item.kind,
          title: item.title,
          dueAt: normalizeDate(item.dueAt),
          endsAt: normalizeDate(item.endsAt),
          allDay: item.allDay,
        });
      }
      return data.items.length;
    });
  }

  importedCanvasIds(studentId: string): Set<string> {
    return this.repo.importedExternalIds(studentId);
  }

  addItem(studentId: string, v: { courseId: string | null; kind: ItemKind; title: string; dueAt: string | null }): Item {
    this.checkCourse(studentId, v.courseId);
    return this.repo.createManualItem(studentId, { ...v, dueAt: normalizeDate(v.dueAt) });
  }

  updateItem(
    studentId: string,
    itemId: string,
    v: Partial<{ courseId: string | null; kind: ItemKind; title: string; dueAt: string | null }>,
  ): Item {
    if (!this.repo.findItem(studentId, itemId)) throw new NotFoundError("Item");
    if ("courseId" in v) this.checkCourse(studentId, v.courseId ?? null);
    const changes = "dueAt" in v ? { ...v, dueAt: normalizeDate(v.dueAt ?? null) } : v;
    return this.repo.updateItem(studentId, itemId, changes)!;
  }

  setStatus(studentId: string, itemId: string, status: ItemStatus): Item {
    const item = this.repo.updateItem(studentId, itemId, { status });
    if (!item) throw new NotFoundError("Item");
    return item;
  }

  deleteItem(studentId: string, itemId: string): void {
    if (!this.repo.deleteItem(studentId, itemId)) throw new NotFoundError("Item");
  }

  private checkCourse(studentId: string, courseId: string | null | undefined): void {
    if (courseId && !this.repo.findCourse(studentId, courseId)) throw new NotFoundError("Course");
  }
}
