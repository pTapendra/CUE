import { describe, expect, it } from "vitest";
import { type CanvasRead, diffCanvas, type SavedCanvasItem } from "../src/canvasReader/diff.js";
import type { ProposedItem } from "../src/canvasReader/types.js";

const FROM = new Date("2026-11-01T15:00:00.000Z");
const TO = new Date(FROM.getTime() + 181 * 24 * 60 * 60 * 1000);
const DAY = 24 * 60 * 60 * 1000;
const COURSES = [
  { externalId: "101", name: "Software Engineering", code: "CS 4350" },
  { externalId: "102", name: "Databases", code: "CS 4420" },
];

/** A Canvas item as the server reads it; `id` is "assignment:1" or "event:900". */
function canvasItem(id: string, overrides: Partial<ProposedItem> = {}): ProposedItem {
  return {
    key: id,
    externalId: id,
    courseExternalId: "102",
    courseName: "Databases",
    kind: id.startsWith("event:") ? "event" : "assignment",
    title: `Title of ${id}`,
    dueAt: "2026-11-05T05:59:00Z",
    endsAt: null,
    allDay: false,
    needsDate: false,
    ...overrides,
  };
}

/** The same item as Cue saved it. */
function savedItem(id: string, overrides: Partial<SavedCanvasItem> = {}): SavedCanvasItem {
  return {
    itemId: `i-${id}`,
    externalId: id,
    courseExternalId: "102",
    courseName: "Databases",
    kind: id.startsWith("event:") ? "event" : "assignment",
    title: `Title of ${id}`,
    dueAt: "2026-11-05T05:59:00.000Z",
    endsAt: null,
    allDay: false,
    ...overrides,
  };
}

function read(items: ProposedItem[], courses = COURSES): CanvasRead {
  return { courses, items, from: FROM, to: TO };
}

const keys = (list: { key: string }[]) => list.map((i) => i.key);
const none = new Set<string>();

describe("diffCanvas", () => {
  it("a Canvas item not saved or skipped is new; past and undated non-exam items are left out", () => {
    const groups = diffCanvas(
      read([
        canvasItem("assignment:1"),
        canvasItem("assignment:2", { kind: "exam", dueAt: null, needsDate: true }),
        canvasItem("assignment:4", { dueAt: "2026-09-01T22:00:00Z" }),
        canvasItem("assignment:5", { dueAt: null }),
      ]),
      [],
      none,
    );
    expect(keys(groups.newItems)).toEqual(["assignment:1", "assignment:2"]);
    expect(groups.newItems[1]).toMatchObject({ kind: "exam", needsDate: true });
    expect(groups).toMatchObject({ skipped: [], changed: [], removed: [] });
  });

  it("a skipped item goes to skipped, not new", () => {
    const groups = diffCanvas(read([canvasItem("assignment:1")]), [], new Set(["assignment:1"]));
    expect(groups.newItems).toEqual([]);
    expect(keys(groups.skipped)).toEqual(["assignment:1"]);
  });

  it("a saved item with the same values isn't listed, whatever the date format", () => {
    const groups = diffCanvas(read([canvasItem("assignment:1")]), [savedItem("assignment:1")], none);
    expect(groups).toEqual({ newItems: [], skipped: [], changed: [], removed: [] });
  });

  it("lists each changed field with the saved and Canvas values, and the saved kind", () => {
    const groups = diffCanvas(
      read([canvasItem("assignment:1", { title: "New", dueAt: "2026-11-09T05:59:00Z" })]),
      [savedItem("assignment:1", { itemId: "i1", kind: "exam", title: "Old" })],
      none,
    );
    expect(groups.changed).toEqual([
      {
        key: "assignment:1",
        itemId: "i1",
        externalId: "assignment:1",
        courseExternalId: "102",
        courseName: "Databases",
        kind: "exam",
        title: "New",
        dueAt: "2026-11-09T05:59:00.000Z",
        endsAt: null,
        allDay: false,
        changes: [
          { field: "title", from: "Old", to: "New" },
          { field: "dueAt", from: "2026-11-05T05:59:00.000Z", to: "2026-11-09T05:59:00.000Z" },
        ],
      },
    ]);
  });

  it("lists a changed end and all-day flag", () => {
    const groups = diffCanvas(
      read([canvasItem("event:900", { dueAt: "2026-12-10T15:00:00Z", endsAt: "2026-12-10T18:00:00Z", allDay: true })]),
      [savedItem("event:900", { dueAt: "2026-12-10T15:00:00.000Z", endsAt: "2026-12-10T17:00:00.000Z" })],
      none,
    );
    expect(groups.changed[0].changes).toEqual([
      { field: "endsAt", from: "2026-12-10T17:00:00.000Z", to: "2026-12-10T18:00:00.000Z" },
      { field: "allDay", from: false, to: true },
    ]);
  });

  it("Canvas without a due date is never a change", () => {
    const groups = diffCanvas(
      read([canvasItem("assignment:2", { kind: "exam", dueAt: null, needsDate: true })]),
      [savedItem("assignment:2", { kind: "exam", dueAt: "2026-11-06T16:00:00.000Z" })],
      none,
    );
    expect(groups).toEqual({ newItems: [], skipped: [], changed: [], removed: [] });
  });

  it("a Canvas due date replaces a different one, or none, in Cue", () => {
    const groups = diffCanvas(
      read([canvasItem("assignment:2", { kind: "exam", dueAt: "2026-11-06T16:00:00Z" })]),
      [savedItem("assignment:2", { kind: "exam", dueAt: null })],
      none,
    );
    expect(groups.changed[0].changes).toEqual([{ field: "dueAt", from: null, to: "2026-11-06T16:00:00.000Z" }]);
  });

  it("an end that isn't after the start counts as no end", () => {
    const groups = diffCanvas(
      read([canvasItem("event:900", { dueAt: "2026-12-10T15:00:00Z", endsAt: "2026-12-10T15:00:00Z" })]),
      [savedItem("event:900", { dueAt: "2026-12-10T15:00:00.000Z", endsAt: null })],
      none,
    );
    expect(groups.changed).toEqual([]);
  });

  it("kind is never compared", () => {
    const groups = diffCanvas(read([canvasItem("assignment:1", { kind: "exam" })]), [savedItem("assignment:1", { kind: "assignment" })], none);
    expect(groups.changed).toEqual([]);
  });

  it("an assignment missing from a listed course is removed", () => {
    const groups = diffCanvas(read([]), [savedItem("assignment:9", { itemId: "i9", title: "Lab 2" })], none);
    expect(groups.removed).toEqual([
      { key: "assignment:9", itemId: "i9", courseName: "Databases", kind: "assignment", title: "Lab 2", dueAt: "2026-11-05T05:59:00.000Z" },
    ]);
  });

  it("an assignment whose date has passed is compared, never new or removed", () => {
    const past = { dueAt: "2026-10-01T22:00:00.000Z" };
    const same = diffCanvas(read([canvasItem("assignment:1", past)]), [savedItem("assignment:1", past)], none);
    expect(same).toEqual({ newItems: [], skipped: [], changed: [], removed: [] });

    const renamed = diffCanvas(read([canvasItem("assignment:1", { ...past, title: "Renamed" })]), [savedItem("assignment:1", past)], none);
    expect(renamed.changed[0].changes).toEqual([{ field: "title", from: "Title of assignment:1", to: "Renamed" }]);
    expect(renamed).toMatchObject({ newItems: [], removed: [] });
  });

  it("nothing in a course Canvas no longer lists is removed", () => {
    const groups = diffCanvas(
      read([]),
      [savedItem("assignment:7", { courseExternalId: "103" }), savedItem("event:70", { courseExternalId: "103" }), savedItem("assignment:8", { courseExternalId: null })],
      none,
    );
    expect(groups.removed).toEqual([]);
  });

  it("a saved event outside the dates read, or undated, is never removed; inside, it is", () => {
    const at = (ms: number) => new Date(ms).toISOString();
    const groups = diffCanvas(
      read([]),
      [
        savedItem("event:1", { dueAt: at(TO.getTime() + DAY) }),
        savedItem("event:2", { dueAt: at(FROM.getTime() - 2 * DAY) }),
        savedItem("event:3", { dueAt: null }),
        savedItem("event:4", { dueAt: at(FROM.getTime() + 3 * DAY) }),
      ],
      none,
    );
    expect(keys(groups.removed)).toEqual(["event:4"]);
  });

  it("an item in `unsure` is never removed", () => {
    const groups = diffCanvas(read([]), [savedItem("event:4"), savedItem("assignment:9")], none, new Set(["event:4", "assignment:9"]));
    expect(groups.removed).toEqual([]);
  });

  it("sorts each group by date, undated last", () => {
    const groups = diffCanvas(
      read([
        canvasItem("assignment:1", { kind: "exam", dueAt: null }),
        canvasItem("assignment:2", { dueAt: "2026-11-20T00:00:00Z" }),
        canvasItem("assignment:3", { dueAt: "2026-11-10T00:00:00Z" }),
        canvasItem("assignment:4", { title: "x", dueAt: "2026-11-25T00:00:00Z" }),
        canvasItem("assignment:5", { title: "x", dueAt: "2026-11-15T00:00:00Z" }),
      ]),
      [
        savedItem("assignment:4", { dueAt: "2026-11-25T00:00:00.000Z" }),
        savedItem("assignment:5", { dueAt: "2026-11-15T00:00:00.000Z" }),
        savedItem("assignment:8", { dueAt: null }),
        savedItem("assignment:9", { dueAt: "2026-11-12T00:00:00.000Z" }),
      ],
      none,
    );
    expect(keys(groups.newItems)).toEqual(["assignment:3", "assignment:2", "assignment:1"]);
    expect(keys(groups.changed)).toEqual(["assignment:5", "assignment:4"]);
    expect(keys(groups.removed)).toEqual(["assignment:9", "assignment:8"]);
  });
});
