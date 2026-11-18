/**
 * Adapter interface for Canvas (see Table 2: CanvasClient).
 * Subsystems depend on this interface, never on the HTTP details,
 * so the access route (personal token now, OAuth later) can change here alone.
 * Every method is a read: Cue never writes to Canvas.
 */
export interface CanvasClient {
  listCourses(): Promise<CanvasCourse[]>;
  listAssignments(courseId: string): Promise<CanvasAssignment[]>;
  listCalendarEvents(courseIds: string[], from: Date, to: Date): Promise<CanvasEvent[]>;
}

export interface CanvasCourse {
  id: string;
  name: string;
  courseCode: string | null;
}

export interface CanvasAssignment {
  id: string;
  courseId: string;
  name: string;
  dueAt: string | null;
  /** Canvas marks graded quizzes with this submission type. */
  isQuiz: boolean;
}

export interface CanvasEvent {
  id: string;
  courseId: string;
  title: string;
  startAt: string | null;
  endAt: string | null;
  allDay: boolean;
}

export type CanvasClientFactory = (baseUrl: string, token: string) => CanvasClient;

/** Canvas refused the token (expired, revoked or wrong). */
export class CanvasAuthError extends Error {
  constructor() {
    super("Canvas rejected the access token");
    this.name = "CanvasAuthError";
  }
}

/** Canvas could not be reached or returned an unexpected error. */
export class CanvasUnavailableError extends Error {
  constructor(detail: string) {
    super(`Canvas is unavailable: ${detail}`);
    this.name = "CanvasUnavailableError";
  }
}
