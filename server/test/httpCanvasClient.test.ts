import { describe, expect, it } from "vitest";
import { CanvasAuthError } from "../src/canvas/CanvasClient.js";
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

  it("does not follow a pagination link to another host", async () => {
    const base = "https://school.instructure.com";
    const { impl, calls } = fakeFetch({
      [`${base}/api/v1/courses?`]: { body: [{ id: 1, name: "A" }], link: `<https://evil.example/steal>; rel="next"` },
    });
    await new HttpCanvasClient(base, "tok", impl).listCourses();
    expect(calls).toHaveLength(1);
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
    expect(events[0]).toEqual({ id: "7", courseId: "3", title: "Exam", startAt: "2026-12-01T10:00:00Z" });
  });

  it("parses Link headers", () => {
    expect(nextLink(null)).toBeNull();
    expect(nextLink('<https://a/x?page=2>; rel="next"')).toBe("https://a/x?page=2");
    expect(nextLink('<https://a/x?page=1>; rel="first"')).toBeNull();
  });
});
