import { describe, expect, it } from "vitest";
import { AccountRepository } from "../src/accounts/AccountRepository.js";
import { openDb } from "../src/db.js";
import { ScheduleRepository } from "../src/schedule/ScheduleRepository.js";
import { ScheduleService } from "../src/schedule/ScheduleService.js";

const NOW = new Date("2026-11-02T15:00:00.000Z");

function setup() {
  const db = openDb(":memory:");
  const accounts = new AccountRepository(db);
  const schedule = new ScheduleService(new ScheduleRepository(db), {
    defaultStudyMinutes: { exam: 360, assignment: 120 },
    blockMinutes: 60,
    now: () => NOW,
  });
  const sid = accounts.create().studentId;
  const all = () => {
    const o = schedule.getOverview(sid, NOW);
    return [...o.items, ...o.undated];
  };
  const byTitle = (title: string) => all().find((i) => i.title === title);
  return { sid, schedule, all, byTitle, blocks: () => schedule.getOverview(sid, NOW).blocks };
}

const DB = { externalId: "c1", name: "Databases", code: "CS 4420" };
const SE = { externalId: "c2", name: "Software Engineering", code: "CS 4350" };

function canvas(externalId: string, title: string, overrides: Partial<{ kind: "assignment" | "exam" | "event"; dueAt: string | null; endsAt: string | null; allDay: boolean; courseExternalId: string }> = {}) {
  return { externalId, courseExternalId: "c1", kind: "assignment" as const, title, dueAt: "2026-11-05T22:00:00Z", endsAt: null, allDay: false, ...overrides };
}

const noChanges = { courses: [], add: [], update: [], remove: [] };

describe("applyCanvasSync", () => {
  it("adds, updates and removes in one go, and reports the counts", () => {
    const { sid, schedule, all, byTitle, blocks } = setup();
    schedule.importFromCanvas(sid, { courses: [DB], items: [canvas("assignment:1", "HW 1"), canvas("assignment:2", "HW 2")] });
    const hw1 = byTitle("HW 1")!;
    const hw2 = byTitle("HW 2")!;
    schedule.applyPlan(sid, { proposed: [{ itemId: hw2.id, startsAt: "2026-11-03T15:00:00.000Z", endsAt: "2026-11-03T16:00:00.000Z" }], removeAccepted: [] });

    const counts = schedule.applyCanvasSync(sid, {
      courses: [DB],
      add: [canvas("assignment:3", "HW 3")],
      update: [{ itemId: hw1.id, title: "HW 1 renamed", dueAt: "2026-11-06T22:00:00Z", endsAt: null, allDay: false }],
      remove: [hw2.id],
    });

    expect(counts).toEqual({ added: 1, updated: 1, removed: 1 });
    expect(all().map((i) => i.title)).toEqual(["HW 3", "HW 1 renamed"]);
    expect(byTitle("HW 1 renamed")).toMatchObject({ id: hw1.id, dueAt: "2026-11-06T22:00:00.000Z" });
    expect(blocks()).toEqual([]);
  });

  it("an update keeps the student's kind, status, study time and blocks", () => {
    const { sid, schedule, byTitle, blocks } = setup();
    schedule.importFromCanvas(sid, { courses: [DB], items: [canvas("assignment:2", "Final project", { kind: "exam" })] });
    const item = byTitle("Final project")!;
    schedule.updateItem(sid, item.id, { kind: "assignment", studyMinutes: 600 });
    schedule.setStatus(sid, item.id, "in_progress");
    schedule.applyPlan(sid, { proposed: [{ itemId: item.id, startsAt: "2026-11-03T15:00:00.000Z", endsAt: "2026-11-03T16:00:00.000Z" }], removeAccepted: [] });

    schedule.applyCanvasSync(sid, { ...noChanges, update: [{ itemId: item.id, title: "Final project (v2)", dueAt: "2026-11-05T22:00:00Z", endsAt: null, allDay: false }] });

    expect(byTitle("Final project (v2)")).toMatchObject({ id: item.id, kind: "assignment", status: "in_progress", studyMinutes: 600 });
    expect(blocks()).toHaveLength(1);
  });

  it("an update without a Canvas date keeps the date and end in Cue", () => {
    const { sid, schedule, byTitle } = setup();
    schedule.importFromCanvas(sid, { courses: [DB], items: [canvas("assignment:2", "Midterm", { kind: "exam", dueAt: null })] });
    const item = byTitle("Midterm")!;
    schedule.updateItem(sid, item.id, { dueAt: "2026-11-06T16:00:00.000Z", endsAt: "2026-11-06T17:00:00.000Z" });

    schedule.applyCanvasSync(sid, { ...noChanges, update: [{ itemId: item.id, title: "Midterm exam", dueAt: null, endsAt: null, allDay: false }] });

    expect(byTitle("Midterm exam")).toMatchObject({ dueAt: "2026-11-06T16:00:00.000Z", endsAt: "2026-11-06T17:00:00.000Z" });
  });

  it("adding an item that is already saved keeps its kind, and its date when Canvas has none", () => {
    const { sid, schedule, all, byTitle } = setup();
    schedule.importFromCanvas(sid, { courses: [DB], items: [canvas("assignment:2", "Midterm", { kind: "exam", dueAt: null })] });
    const item = byTitle("Midterm")!;
    schedule.updateItem(sid, item.id, { kind: "assignment", dueAt: "2026-11-06T16:00:00.000Z" });

    schedule.applyCanvasSync(sid, { courses: [DB], add: [canvas("assignment:2", "Midterm", { kind: "exam", dueAt: null })], update: [], remove: [] });

    expect(all()).toHaveLength(1);
    expect(byTitle("Midterm")).toMatchObject({ id: item.id, kind: "assignment", dueAt: "2026-11-06T16:00:00.000Z" });
  });

  it("an item deleted since the preview is neither re-created nor counted", () => {
    const { sid, schedule, all, byTitle } = setup();
    schedule.importFromCanvas(sid, { courses: [DB], items: [canvas("assignment:1", "HW 1")] });
    const item = byTitle("HW 1")!;
    schedule.deleteItem(sid, item.id);

    const counts = schedule.applyCanvasSync(sid, {
      ...noChanges,
      update: [{ itemId: item.id, title: "HW 1", dueAt: "2026-11-06T22:00:00Z", endsAt: null, allDay: false }],
      remove: [item.id],
    });

    expect(counts).toEqual({ added: 0, updated: 0, removed: 0 });
    expect(all()).toEqual([]);
    expect(schedule.savedCanvasItems(sid)).toEqual([]);
  });

  it("refreshes a saved course's name, and creates a course only for an added item", () => {
    const { sid, schedule } = setup();
    schedule.importFromCanvas(sid, { courses: [DB], items: [canvas("assignment:1", "HW 1")] });

    schedule.applyCanvasSync(sid, { ...noChanges, courses: [{ ...DB, name: "Databases I" }, SE] });

    expect(schedule.listCourses(sid).map((c) => c.name)).toEqual(["Databases I"]);
  });

  it("announces once when something changed, and not when nothing did", () => {
    const { sid, schedule, byTitle } = setup();
    schedule.importFromCanvas(sid, { courses: [DB], items: [canvas("assignment:1", "HW 1"), canvas("assignment:2", "HW 2")] });
    const announced: string[] = [];
    schedule.onChange((id) => announced.push(id));

    schedule.applyCanvasSync(sid, { ...noChanges, courses: [DB] });
    expect(announced).toEqual([]);

    schedule.applyCanvasSync(sid, { courses: [DB], add: [canvas("assignment:3", "HW 3")], update: [], remove: [byTitle("HW 1")!.id, byTitle("HW 2")!.id] });
    expect(announced).toEqual([sid]);
  });

  it("runs `alongside` in the same transaction", () => {
    const { sid, schedule, all, byTitle } = setup();
    schedule.importFromCanvas(sid, { courses: [DB], items: [canvas("assignment:1", "HW 1")] });
    const hw1 = byTitle("HW 1")!;

    expect(() =>
      schedule.applyCanvasSync(sid, { courses: [DB], add: [canvas("assignment:3", "HW 3")], update: [], remove: [hw1.id] }, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");

    expect(all().map((i) => i.title)).toEqual(["HW 1"]);
  });

  it("lists saved Canvas items with their course's Canvas ID", () => {
    const { sid, schedule, byTitle } = setup();
    schedule.importFromCanvas(sid, {
      courses: [DB],
      items: [canvas("event:900", "Review session", { kind: "event", dueAt: "2026-11-10T15:00:00Z", endsAt: "2026-11-10T16:00:00Z", allDay: true })],
    });
    schedule.addItem(sid, { courseId: null, kind: "assignment", title: "Mine", dueAt: null });

    expect(schedule.savedCanvasItems(sid)).toEqual([
      {
        itemId: byTitle("Review session")!.id,
        externalId: "event:900",
        courseExternalId: "c1",
        courseName: "Databases",
        kind: "event",
        title: "Review session",
        dueAt: "2026-11-10T15:00:00.000Z",
        endsAt: "2026-11-10T16:00:00.000Z",
        allDay: true,
      },
    ]);
  });
});
