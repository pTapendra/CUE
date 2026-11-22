import {
  CanvasAuthError,
  CanvasUnavailableError,
  canvasIdString,
  type CanvasAssignment,
  type CanvasClient,
  type CanvasCourse,
  type CanvasEvent,
} from "./CanvasClient.js";

type Fetch = typeof fetch;

/**
 * Reads from the Canvas REST API with a personal access token.
 * The only request method in this class is GET (read-only Canvas access).
 */
export class HttpCanvasClient implements CanvasClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async listCourses(): Promise<CanvasCourse[]> {
    const rows = await this.getAll<any>("/api/v1/courses", {
      enrollment_state: "active",
      per_page: "100",
    });
    return rows
      .filter((c) => c && c.id != null && c.name)
      .map((c) => ({ id: String(c.id), name: String(c.name), courseCode: c.course_code ?? null }));
  }

  async listAssignments(courseId: string): Promise<CanvasAssignment[]> {
    const rows = await this.getAll<any>(`/api/v1/courses/${encodeURIComponent(courseId)}/assignments`, {
      per_page: "100",
      order_by: "due_at",
    });
    return rows.map((a) => ({
      id: String(a.id),
      courseId,
      name: String(a.name ?? "Untitled assignment"),
      dueAt: a.due_at ?? null,
      isQuiz: Array.isArray(a.submission_types) && a.submission_types.includes("online_quiz"),
    }));
  }

  async listCalendarEvents(courseIds: string[], from: Date, to: Date): Promise<CanvasEvent[]> {
    if (courseIds.length === 0) return [];
    const events: CanvasEvent[] = [];
    // Canvas accepts at most 10 context codes per request.
    for (let i = 0; i < courseIds.length; i += 10) {
      const chunk = courseIds.slice(i, i + 10);
      const params = new URLSearchParams({
        type: "event",
        start_date: from.toISOString(),
        end_date: to.toISOString(),
        per_page: "100",
      });
      for (const id of chunk) params.append("context_codes[]", `course_${id}`);
      const rows = await this.getAll<any>("/api/v1/calendar_events", params);
      for (const e of rows) {
        const event = toEvent(e);
        if (event) events.push(event);
      }
    }
    return events;
  }

  async getCalendarEvent(id: string): Promise<CanvasEvent | null> {
    const res = await this.get(`${this.baseUrl}/api/v1/calendar_events/${encodeURIComponent(id)}`, { notFound: true });
    if (res === null) return null;
    let body: any;
    try {
      body = await res.json();
    } catch {
      throw new CanvasUnavailableError("Unreadable reply");
    }
    if (body?.workflow_state === "deleted") return null;
    return toEvent(body);
  }

  async whoAmI(): Promise<{ id: string }> {
    const res = await this.get(`${this.baseUrl}/api/v1/users/self`);
    let body: any;
    try {
      body = await res.json();
    } catch {
      throw new CanvasUnavailableError("Unreadable reply");
    }
    const id = canvasIdString(body?.id);
    if (id === null) throw new CanvasUnavailableError("Reply had no user ID");
    return { id };
  }

  /** GET a list endpoint and follow Canvas's Link: rel="next" pagination. */
  private async getAll<T>(path: string, query: Record<string, string> | URLSearchParams): Promise<T[]> {
    const params = query instanceof URLSearchParams ? query : new URLSearchParams(query);
    let url: string | null = `${this.baseUrl}${path}?${params}`;
    const out: T[] = [];
    for (let page = 0; url && page < 50; page++) {
      const res = await this.get(url);
      const body = (await res.json()) as unknown;
      if (Array.isArray(body)) out.push(...(body as T[]));
      url = nextLink(res.headers.get("link"));
      // Never send the token to another host, even if a Link header points there.
      if (url && new URL(url).origin !== new URL(this.baseUrl).origin) url = null;
    }
    return out;
  }

  private async get(url: string): Promise<Response>;
  /** With `notFound`, a 404 gives null instead of an error. */
  private async get(url: string, opts: { notFound: true }): Promise<Response | null>;
  private async get(url: string, opts?: { notFound: true }): Promise<Response | null> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
      });
    } catch (err) {
      throw new CanvasUnavailableError((err as Error).message);
    }
    if (res.status === 401) throw new CanvasAuthError();
    if (res.status === 404 && opts?.notFound) return null;
    if (!res.ok) throw new CanvasUnavailableError(`HTTP ${res.status}`);
    return res;
  }
}

/** A Canvas calendar event in a course; null for any other context. */
function toEvent(e: any): CanvasEvent | null {
  const match = /^course_(.+)$/.exec(String(e?.context_code ?? ""));
  if (!match) return null;
  return { id: String(e.id), courseId: match[1], title: String(e.title ?? "Event"), startAt: e.start_at ?? null, endAt: e.end_at ?? null, allDay: e.all_day === true };
}

export function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (m) return m[1];
  }
  return null;
}
