import { describe, expect, it } from "vitest";
import { CanvasAuthError, CanvasUnavailableError } from "../src/canvas/CanvasClient.js";
import { CANVAS_SCOPES } from "../src/canvas/CanvasLogin.js";
import { HttpCanvasClient, nextLink } from "../src/canvas/HttpCanvasClient.js";

type Call = { url: string; method: string; auth: string | null };

function fakeFetch(pages: Record<string, { body: unknown; link?: string; status?: number }>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? "GET", auth: headers.get("authorization") });
    const key = Object.keys(pages).find((k) => url.startsWith(k));
    const page = key ? pages[key] : { body: [], status: 404 };
    return new Response(JSON.stringify(page.body), {
      status: page.status ?? 200,
      headers: page.link ? { link: page.link } : {},
    });
  }) as typeof fetch;
  return { impl, calls };
}

describe("HttpCanvasClient", () => {
  it("whoAmI asks /api/v1/users/self with the token", async () => {
    const base = "https://school.instructure.com";
    const { impl, calls } = fakeFetch({ [`${base}/api/v1/users/self`]: { body: { id: 7, name: "x" } } });
    const me = await new HttpCanvasClient(base, "tok", impl).whoAmI();
    expect(me).toEqual({ id: "7" });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname).toBe("/api/v1/users/self");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].auth).toBe("Bearer tok");
  });

  it("whoAmI without a usable id is CanvasUnavailableError", async () => {
    const base = "https://school.instructure.com";
    for (const body of [{ name: "x" }, { id: "" }, { id: {} }, null]) {
      const { impl } = fakeFetch({ [`${base}/api/v1/users/self`]: { body } });
      await expect(new HttpCanvasClient(base, "tok", impl).whoAmI()).rejects.toBeInstanceOf(CanvasUnavailableError);
    }
  });

  it("whoAmI maps a 401 to CanvasAuthError", async () => {
    const base = "https://school.instructure.com";
    const { impl } = fakeFetch({ [`${base}/api/v1/users/self`]: { body: {}, status: 401 } });
    await expect(new HttpCanvasClient(base, "tok", impl).whoAmI()).rejects.toBeInstanceOf(CanvasAuthError);
  });

  it("only sends GET requests, with the token, and follows pagination", async () => {
    const base = "https://school.instructure.com";
    const { impl, calls } = fakeFetch({
      [`${base}/api/v1/courses?`]: {
        body: [{ id: 1, name: "A", course_code: "A1" }],
        link: `<${base}/api/v1/page2>; rel="next", <${base}/api/v1/courses?page=1>; rel="first"`,
      },
      [`${base}/api/v1/page2`]: { body: [{ id: 2, name: "B" }] },
    });
    const client = new HttpCanvasClient(`${base}/`, "tok", impl);
    const courses = await client.listCourses();

    expect(courses).toEqual([
      { id: "1", name: "A", courseCode: "A1" },
      { id: "2", name: "B", courseCode: null },
    ]);
    expect(calls.every((c) => c.method === "GET" && c.auth === "Bearer tok")).toBe(true);
  });

  it("fails, rather than following it or stopping short, on a pagination link to another host", async () => {
    const base = "https://school.instructure.com";
    const { impl, calls } = fakeFetch({
      [`${base}/api/v1/courses?`]: { body: [{ id: 1, name: "A" }], link: `<https://evil.example/steal>; rel="next"` },
    });
    await expect(new HttpCanvasClient(base, "tok", impl).listCourses()).rejects.toBeInstanceOf(CanvasUnavailableError);
    expect(calls).toHaveLength(1);
  });

  it("fails rather than returning part of a list longer than the page limit", async () => {
    const base = "https://s.edu";
    const { impl, calls } = fakeFetch({
      [`${base}/api/v1/courses/3/assignments`]: { body: [{ id: 1, name: "HW" }], link: `<${base}/api/v1/courses/3/assignments?page=next>; rel="next"` },
    });
    await expect(new HttpCanvasClient(base, "t", impl).listAssignments("3")).rejects.toBeInstanceOf(CanvasUnavailableError);
    expect(calls).toHaveLength(50);
  });

  it("fails on a page that isn't a list", async () => {
    const { impl } = fakeFetch({ "https://s.edu/api/v1/courses/3/assignments": { body: { errors: [] } } });
    await expect(new HttpCanvasClient("https://s.edu", "t", impl).listAssignments("3")).rejects.toBeInstanceOf(CanvasUnavailableError);
  });

  it("reports a rejected token", async () => {
    const { impl } = fakeFetch({ "https://s.edu/api/v1/courses": { body: {}, status: 401 } });
    await expect(new HttpCanvasClient("https://s.edu", "bad", impl).listCourses()).rejects.toBeInstanceOf(CanvasAuthError);
  });

  it("reads calendar events in chunks of ten courses", async () => {
    const { impl, calls } = fakeFetch({
      "https://s.edu/api/v1/calendar_events": { body: [{ id: 7, title: "Exam", start_at: "2026-12-01T10:00:00Z", context_code: "course_3" }] },
    });
    const ids = Array.from({ length: 12 }, (_, i) => String(i + 1));
    const events = await new HttpCanvasClient("https://s.edu", "t", impl).listCalendarEvents(ids, new Date(0), new Date());
    expect(calls).toHaveLength(2);
    expect(events[0]).toEqual({ id: "7", courseId: "3", title: "Exam", startAt: "2026-12-01T10:00:00Z", endAt: null, allDay: false });
  });

  it("reads an event's end time and all-day flag", async () => {
    const { impl } = fakeFetch({
      "https://s.edu/api/v1/calendar_events": {
        body: [{ id: 8, title: "Break", start_at: "2026-11-26T06:00:00Z", end_at: "2026-11-28T06:00:00Z", all_day: true, context_code: "course_3" }],
      },
    });
    const events = await new HttpCanvasClient("https://s.edu", "t", impl).listCalendarEvents(["3"], new Date(0), new Date());
    expect(events[0]).toMatchObject({ endAt: "2026-11-28T06:00:00Z", allDay: true });
  });

  it("listAllCalendarEvents asks for every event of the courses, whatever the date, ten courses at a time", async () => {
    const { impl, calls } = fakeFetch({
      "https://s.edu/api/v1/calendar_events": {
        body: [{ id: 900, title: "Final exam", start_at: "2027-06-10T15:00:00Z", end_at: "2027-06-10T17:00:00Z", context_code: "course_3" }],
      },
    });
    const ids = Array.from({ length: 12 }, (_, i) => String(i + 1));
    const events = await new HttpCanvasClient("https://s.edu", "t", impl).listAllCalendarEvents(ids);
    expect(calls).toHaveLength(2);
    const query = new URL(calls[0].url).searchParams;
    expect(query.get("all_events")).toBe("true");
    expect(query.get("type")).toBe("event");
    expect(query.has("start_date")).toBe(false);
    expect(query.getAll("context_codes[]")).toHaveLength(10);
    expect(events[0]).toEqual({ id: "900", courseId: "3", title: "Final exam", startAt: "2027-06-10T15:00:00Z", endAt: "2027-06-10T17:00:00Z", allDay: false });
  });

  it("every request a sync makes is allowed by Cue's login scopes", async () => {
    const { impl, calls } = fakeFetch({
      "https://s.edu/api/v1/courses": { body: [] },
      "https://s.edu/api/v1/calendar_events": { body: [] },
    });
    const client = new HttpCanvasClient("https://s.edu", "t", impl);
    await client.listCourses();
    await client.listAssignments("3").catch(() => {});
    await client.listCalendarEvents(["3"], new Date(0), new Date());
    await client.listAllCalendarEvents(["3"]);
    // whoAmI is left out: only the token form uses it, and a pasted token has no scopes.
    const allowed = CANVAS_SCOPES.map((scope) => new RegExp(`^${scope.replace("url:GET|", "").replace(/:[a-z_]+/g, "[^/]+")}$`));
    for (const call of calls) {
      const path = new URL(call.url).pathname;
      expect(allowed.some((re) => re.test(path)), path).toBe(true);
    }
    expect(calls.length).toBeGreaterThanOrEqual(4);
  });

  it("parses Link headers", () => {
    expect(nextLink(null)).toBeNull();
    expect(nextLink('<https://a/x?page=2>; rel="next"')).toBe("https://a/x?page=2");
    expect(nextLink('<https://a/x?page=1>; rel="first"')).toBeNull();
  });
});
