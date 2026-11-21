import {
  CanvasAuthError,
  type CanvasAssignment,
  type CanvasClient,
  type CanvasCourse,
  type CanvasEvent,
} from "./CanvasClient.js";

export interface FakeCanvasData {
  courses: CanvasCourse[];
  assignments: CanvasAssignment[];
  events: CanvasEvent[];
}

/** In-memory Canvas for tests and offline demos. */
export class FakeCanvasClient implements CanvasClient {
  rejectToken = false;
  userId = "42";

  constructor(public data: FakeCanvasData) {}

  async listCourses() {
    this.check();
    return this.data.courses;
  }

  async listAssignments(courseId: string) {
    this.check();
    return this.data.assignments.filter((a) => a.courseId === courseId);
  }

  async listCalendarEvents(courseIds: string[], from: Date, to: Date) {
    this.check();
    return this.data.events.filter((e) => {
      if (!courseIds.includes(e.courseId)) return false;
      if (!e.startAt) return true;
      const t = Date.parse(e.startAt);
      return t >= from.getTime() && t <= to.getTime();
    });
  }

  async whoAmI() {
    this.check();
    return { id: this.userId };
  }

  private check() {
    if (this.rejectToken) throw new CanvasAuthError();
  }
}
