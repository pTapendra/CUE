import { describe, expect, it, vi } from "vitest";
import { AccountRepository } from "../src/accounts/AccountRepository.js";
import { openDb } from "../src/db.js";
import type { BlockRef } from "../src/planner/types.js";
import { ScheduleRepository } from "../src/schedule/ScheduleRepository.js";
import { BlockMoveError, NotFoundError, ScheduleService } from "../src/schedule/ScheduleService.js";

const NOW = new Date("2026-11-02T15:00:00.000Z"); // Mon 2 Nov, 09:00 in Chicago
const FROM = new Date("2026-11-02T06:00:00.000Z"); // Mon 2 Nov, midnight in Chicago
const HOUR = 60 * 60 * 1000;

function setup() {
  let clock = NOW;
  const db = openDb(":memory:");
  const accounts = new AccountRepository(db);
  const repo = new ScheduleRepository(db);
  const schedule = new ScheduleService(repo, {
    defaultStudyMinutes: { exam: 360, assignment: 120 },
    blockMinutes: 60,
    now: () => clock,
  });
  const setClock = (d: Date) => {
    clock = d;
  };
  return { sid: accounts.create().studentId, accounts, repo, schedule, setClock };
}

/** A one-hour block, unless an end is given. */
function block(itemId: string, startsAt: string, endsAt?: string): BlockRef {
  return { itemId, startsAt, endsAt: endsAt ?? new Date(Date.parse(startsAt) + HOUR).toISOString() };
}

/** The message of the BlockMoveError that `move` throws. */
function refusal(move: () => void): string {
  try {
    move();
  } catch (err) {
    expect(err).toBeInstanceOf(BlockMoveError);
    return (err as Error).message;
  }
  throw new Error("The move was allowed");
}

describe("Schedule Manager: study blocks", () => {
  it("announces changes, but not when a plan is applied", () => {
    const { sid, schedule } = setup();
    const announced: string[] = [];
    let itemsWhenAnnounced = 0;
    schedule.onChange((id) => announced.push(id));
    schedule.onChange((id) => {
      itemsWhenAnnounced = schedule.planningSnapshot(id).items.length;
    });

    schedule.importFromCanvas(sid, {
      courses: [{ externalId: "c1", name: "Databases", code: null }],
      items: [{ externalId: "1", courseExternalId: "c1", kind: "assignment", title: "SQL homework", dueAt: "2026-11-05T22:00:00Z", endsAt: null, allDay: false }],
    });
    expect(announced).toEqual([sid]);
    expect(itemsWhenAnnounced).toBe(1); // saved before the listeners hear of it

    const exam = schedule.addItem(sid, { courseId: null, kind: "exam", title: "Final", dueAt: "2026-11-13T15:00:00Z" });
    expect(itemsWhenAnnounced).toBe(2);
    schedule.updateItem(sid, exam.id, { title: "DB final" });
    schedule.setStatus(sid, exam.id, "in_progress");
    expect(announced).toHaveLength(4);

    schedule.applyPlan(sid, {
      proposed: [block(exam.id, "2026-11-04T00:00:00.000Z"), block(exam.id, "2026-11-05T00:00:00.000Z"), block(exam.id, "2026-11-06T00:00:00.000Z")],
      removeAccepted: [],
    });
    const [first, second, third] = schedule.getWeek(sid, FROM).blocks;
    schedule.acceptBlock(sid, first.id);
    expect(schedule.acceptBlocks(sid, FROM, new Date("2026-11-09T06:00:00Z"))).toBe(2);
    expect(announced).toHaveLength(4);

    schedule.rejectBlock(sid, second.id);
    schedule.moveBlock(sid, third.id, "2026-11-07T00:00:00Z");
    schedule.deleteItem(sid, exam.id);
    expect(announced).toEqual([sid, sid, sid, sid, sid, sid, sid]);
  });

  it("a listener that fails does not fail the change or stop the other listeners", () => {
    const { sid, schedule } = setup();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const heard: string[] = [];
      schedule.onChange(() => {
        throw new Error("planner broke");
      });
      schedule.onChange((id) => heard.push(id));

      const exam = schedule.addItem(sid, { courseId: null, kind: "exam", title: "Final", dueAt: "2026-11-13T15:00:00Z" });
      expect(exam.title).toBe("Final");
      expect(heard).toEqual([sid]);
      expect(logged).toHaveBeenCalledTimes(1);
    } finally {
      logged.mockRestore();
    }
  });

  it("applies a plan and numbers blocks in the week", () => {
    const { sid, schedule } = setup();
    const course = schedule.addCourse(sid, "Databases", "CS 4420");
    const exam = schedule.addItem(sid, { courseId: course.id, kind: "exam", title: "DB final", dueAt: "2026-11-13T15:00:00Z" });
    schedule.applyPlan(sid, {
      proposed: [block(exam.id, "2026-11-05T00:00:00.000Z"), block(exam.id, "2026-11-04T00:00:00.000Z")],
      removeAccepted: [],
    });

    const week = schedule.getWeek(sid, FROM);
    const same = {
      itemId: exam.id, itemTitle: "DB final", itemKind: "exam", courseName: "Databases",
      itemDueAt: "2026-11-13T15:00:00.000Z", state: "proposed", total: 6, clash: null,
    };
    expect(week.blocks).toEqual([
      { id: expect.any(String), ...same, startsAt: "2026-11-04T00:00:00.000Z", endsAt: "2026-11-04T01:00:00.000Z", index: 1 },
      { id: expect.any(String), ...same, startsAt: "2026-11-05T00:00:00.000Z", endsAt: "2026-11-05T01:00:00.000Z", index: 2 },
    ]);

    // A new plan replaces every suggestion and keeps accepted blocks it does not list.
    const kept = week.blocks[0];
    schedule.acceptBlock(sid, kept.id);
    schedule.applyPlan(sid, {
      proposed: [block(exam.id, "2026-11-06T00:00:00.000Z"), block(exam.id, "2026-11-10T00:00:00.000Z")],
      removeAccepted: [],
    });
    expect(schedule.getWeek(sid, FROM, 5).blocks.map((b) => [b.startsAt, b.state, b.index])).toEqual([
      ["2026-11-04T00:00:00.000Z", "accepted", 1],
      ["2026-11-06T00:00:00.000Z", "proposed", 2],
    ]);
    // Numbering counts the item's blocks outside the range too.
    expect(schedule.getWeek(sid, new Date("2026-11-09T06:00:00Z"), 3).blocks.map((b) => b.index)).toEqual([3]);

    schedule.applyPlan(sid, { proposed: [], removeAccepted: [kept.id] });
    expect(schedule.getWeek(sid, FROM, 14).blocks).toEqual([]);

    // More blocks than the study time needs: the total grows to match.
    const essay = schedule.addItem(sid, { courseId: null, kind: "assignment", title: "Essay", dueAt: "2026-11-09T15:00:00Z" });
    schedule.applyPlan(sid, {
      proposed: ["2026-11-03", "2026-11-04", "2026-11-05"].map((day) => block(essay.id, `${day}T01:00:00.000Z`)),
      removeAccepted: [],
    });
    expect(schedule.getWeek(sid, FROM).blocks.map((b) => `${b.index} of ${b.total}`)).toEqual(["1 of 3", "2 of 3", "3 of 3"]);
  });

  it("flags an accepted block that clashes with a new event", () => {
    const { sid, schedule } = setup();
    const exam = schedule.addItem(sid, { courseId: null, kind: "exam", title: "DB final", dueAt: "2026-11-13T15:00:00Z" });
    schedule.applyPlan(sid, {
      proposed: [block(exam.id, "2026-11-04T00:00:00.000Z"), block(exam.id, "2026-11-05T00:00:00.000Z")],
      removeAccepted: [],
    });
    schedule.acceptBlock(sid, schedule.getWeek(sid, FROM).blocks[0].id);

    schedule.addItem(sid, { courseId: null, kind: "event", title: "Study group", dueAt: "2026-11-04T00:45:00Z" });
    schedule.addItem(sid, { courseId: null, kind: "event", title: "Review session", dueAt: "2026-11-03T23:30:00Z" });
    schedule.addItem(sid, { courseId: null, kind: "event", title: "Lab", dueAt: "2026-11-05T00:30:00Z" });

    // The first event that overlaps it is named; suggestions are never flagged.
    expect(schedule.getWeek(sid, FROM).blocks.map((b) => [b.state, b.clash])).toEqual([
      ["accepted", { title: "Review session", startsAt: "2026-11-03T23:30:00.000Z", endsAt: "2026-11-04T00:30:00.000Z" }],
      ["proposed", null],
    ]);
  });

  it("moves a block: refuses the past, after the deadline, events and accepted blocks, and remembers the old slot", () => {
    const { sid, schedule } = setup();
    const exam = schedule.addItem(sid, { courseId: null, kind: "exam", title: "DB final", dueAt: "2026-11-06T15:00:00Z" });
    schedule.addItem(sid, { courseId: null, kind: "event", title: "Lab", dueAt: "2026-11-03T00:00:00Z" });
    schedule.applyPlan(sid, {
      proposed: [block(exam.id, "2026-11-04T00:00:00.000Z"), block(exam.id, "2026-11-05T00:00:00.000Z", "2026-11-05T01:30:00.000Z")],
      removeAccepted: [],
    });
    const [accepted, moving] = schedule.getWeek(sid, FROM).blocks;
    schedule.acceptBlock(sid, accepted.id);

    const moveTo = (startsAt: string) => () => schedule.moveBlock(sid, moving.id, startsAt);
    expect(refusal(moveTo("2026-11-02T14:00:00Z"))).toBe("Pick a time in the future.");
    expect(refusal(moveTo("2026-11-06T14:00:00Z"))).toBe("Pick a time before the deadline."); // would end 15:30
    expect(refusal(moveTo("2026-11-03T00:30:00Z"))).toBe("Clashes with Lab.");
    expect(refusal(moveTo("2026-11-03T23:30:00Z"))).toBe("You already have a study block then.");

    // Keeps its 90 minutes and may end exactly at the deadline.
    schedule.moveBlock(sid, moving.id, "2026-11-06T13:30:00Z");
    const snapshot = schedule.planningSnapshot(sid);
    expect(snapshot.accepted).toEqual([
      { id: accepted.id, itemId: exam.id, startsAt: "2026-11-04T00:00:00.000Z", endsAt: "2026-11-04T01:00:00.000Z" },
      { id: moving.id, itemId: exam.id, startsAt: "2026-11-06T13:30:00.000Z", endsAt: "2026-11-06T15:00:00.000Z" },
    ]);
    expect(snapshot.rejected).toEqual([{ itemId: exam.id, startsAt: "2026-11-05T00:00:00.000Z", endsAt: "2026-11-05T01:30:00.000Z" }]);

    // An accepted block may move over its own old time.
    schedule.moveBlock(sid, accepted.id, "2026-11-04T00:30:00Z");
    expect(schedule.planningSnapshot(sid).accepted[0]).toMatchObject({ startsAt: "2026-11-04T00:30:00.000Z", endsAt: "2026-11-04T01:30:00.000Z" });

    // Without a deadline there is no time before it.
    schedule.updateItem(sid, exam.id, { dueAt: null });
    expect(refusal(() => schedule.moveBlock(sid, accepted.id, "2026-11-04T02:00:00Z"))).toBe("Pick a time before the deadline.");
  });

  it("moves a block onto another item's suggestion", () => {
    const { sid, schedule } = setup();
    const exam = schedule.addItem(sid, { courseId: null, kind: "exam", title: "DB final", dueAt: "2026-11-13T15:00:00Z" });
    const essay = schedule.addItem(sid, { courseId: null, kind: "assignment", title: "Essay", dueAt: "2026-11-10T15:00:00Z" });
    schedule.applyPlan(sid, {
      proposed: [block(exam.id, "2026-11-04T00:00:00.000Z"), block(essay.id, "2026-11-05T00:00:00.000Z")],
      removeAccepted: [],
    });
    const essayBlock = schedule.getWeek(sid, FROM).blocks.find((b) => b.itemId === essay.id)!;

    schedule.moveBlock(sid, essayBlock.id, "2026-11-04T00:00:00Z");
    expect(schedule.getWeek(sid, FROM).blocks.find((b) => b.id === essayBlock.id)).toMatchObject({
      state: "accepted",
      startsAt: "2026-11-04T00:00:00.000Z",
      endsAt: "2026-11-04T01:00:00.000Z",
    });
  });

  it("resolves default study time and leaves all-day events out of busy time", () => {
    const { sid, repo, schedule } = setup();
    schedule.importFromCanvas(sid, {
      courses: [{ externalId: "c1", name: "Databases", code: null }],
      items: [
        { externalId: "1", courseExternalId: "c1", kind: "exam", title: "Midterm", dueAt: "2026-11-10T15:00:00Z", endsAt: null, allDay: false },
        { externalId: "2", courseExternalId: "c1", kind: "assignment", title: "SQL homework", dueAt: "2026-11-05T22:00:00Z", endsAt: null, allDay: false },
        { externalId: "3", courseExternalId: "c1", kind: "event", title: "Lecture", dueAt: "2026-11-03T15:00:00Z", endsAt: "2026-11-03T16:30:00Z", allDay: false },
        { externalId: "4", courseExternalId: "c1", kind: "event", title: "No class", dueAt: "2026-11-04T06:00:00Z", endsAt: "2026-11-05T06:00:00Z", allDay: true },
        { externalId: "5", courseExternalId: "c1", kind: "event", title: "Old lab", dueAt: "2026-10-30T15:00:00Z", endsAt: null, allDay: false },
      ],
    });
    const reading = schedule.addItem(sid, { courseId: null, kind: "assignment", title: "Reading", dueAt: null });
    expect(reading.studyMinutes).toBe(120);
    repo.updateItem(sid, reading.id, { studyMinutes: 0 }); // "no study needed"
    expect(schedule.setStatus(sid, reading.id, "done").studyMinutes).toBe(0);

    const snapshot = schedule.planningSnapshot(sid);
    expect([...snapshot.items].sort((a, b) => a.title.localeCompare(b.title))).toEqual([
      { id: expect.any(String), title: "Midterm", kind: "exam", dueAt: "2026-11-10T15:00:00.000Z", studyMinutes: 360, done: false },
      { id: reading.id, title: "Reading", kind: "assignment", dueAt: null, studyMinutes: 0, done: true },
      { id: expect.any(String), title: "SQL homework", kind: "assignment", dueAt: "2026-11-05T22:00:00.000Z", studyMinutes: 120, done: false },
    ]);
    expect(snapshot.busy).toEqual([
      { startsAt: "2026-11-03T15:00:00.000Z", endsAt: "2026-11-03T16:30:00.000Z" },
      { startsAt: "2026-11-10T15:00:00.000Z", endsAt: "2026-11-10T16:00:00.000Z" },
    ]);

    const week = schedule.getWeek(sid, FROM);
    expect(week.items.map((i) => [i.title, i.studyMinutes])).toEqual([["Lecture", null], ["No class", null], ["SQL homework", 120]]);
    expect(week.undated.map((i) => [i.title, i.studyMinutes])).toEqual([["Reading", 0]]);
  });

  it("accepts one block or every suggestion starting in a range, and refuses blocks that are gone", () => {
    const { sid, accounts, schedule } = setup();
    const exam = schedule.addItem(sid, { courseId: null, kind: "exam", title: "DB final", dueAt: "2026-11-13T15:00:00Z" });
    schedule.applyPlan(sid, {
      proposed: [block(exam.id, "2026-11-03T23:30:00.000Z"), block(exam.id, "2026-11-04T00:00:00.000Z"), block(exam.id, "2026-11-05T00:00:00.000Z")],
      removeAccepted: [],
    });
    expect(schedule.acceptBlocks(sid, new Date("2026-11-04T00:00:00Z"), new Date("2026-11-05T00:00:00Z"))).toBe(1);
    const [early, inRange, late] = schedule.getWeek(sid, FROM).blocks;
    expect([early.state, inRange.state, late.state]).toEqual(["proposed", "accepted", "proposed"]);

    schedule.acceptBlock(sid, late.id);
    schedule.rejectBlock(sid, early.id);
    expect(schedule.getWeek(sid, FROM).blocks.map((b) => [b.id, b.state])).toEqual([[inRange.id, "accepted"], [late.id, "accepted"]]);

    const other = accounts.create().studentId;
    for (const [studentId, id] of [[sid, early.id], [sid, "no-such-block"], [other, late.id]]) {
      expect(() => schedule.acceptBlock(studentId, id)).toThrow(NotFoundError);
      expect(() => schedule.rejectBlock(studentId, id)).toThrow(NotFoundError);
    }
    expect(() => schedule.rejectBlock(sid, early.id)).toThrow("Block not found");
  });

  it("leaves suggestions that already started out of the week and out of accepting", () => {
    const { sid, schedule, setClock } = setup();
    const exam = schedule.addItem(sid, { courseId: null, kind: "exam", title: "DB final", dueAt: "2026-11-13T15:00:00Z" });
    schedule.applyPlan(sid, {
      proposed: [block(exam.id, "2026-11-03T00:00:00.000Z"), block(exam.id, "2026-11-04T00:00:00.000Z"), block(exam.id, "2026-11-05T00:00:00.000Z")],
      removeAccepted: [],
    });
    const [first, second] = schedule.getWeek(sid, FROM).blocks;
    schedule.acceptBlock(sid, first.id);

    setClock(new Date("2026-11-04T00:30:00Z")); // both have started; only the first was accepted
    expect(schedule.getWeek(sid, FROM).blocks.map((b) => [b.startsAt, b.state])).toEqual([
      ["2026-11-03T00:00:00.000Z", "accepted"],
      ["2026-11-05T00:00:00.000Z", "proposed"],
    ]);
    expect(() => schedule.acceptBlock(sid, second.id)).toThrow(NotFoundError);
    expect(schedule.acceptBlocks(sid, FROM, new Date("2026-11-09T06:00:00Z"))).toBe(1);
    expect(schedule.planningSnapshot(sid).accepted.map((b) => b.startsAt)).toEqual([
      "2026-11-03T00:00:00.000Z",
      "2026-11-05T00:00:00.000Z",
    ]);
  });

  it("saves study time and an event's end time through the service", () => {
    const { sid, schedule } = setup();
    let announced = 0;
    schedule.onChange(() => announced++);

    const exam = schedule.addItem(sid, { courseId: null, kind: "exam", title: "Final", dueAt: "2026-11-20T15:00:00-06:00", studyMinutes: 120 });
    const event = schedule.addItem(sid, { courseId: null, kind: "event", title: "Lab", dueAt: "2026-11-10T15:00:00Z", endsAt: "2026-11-10T10:30:00-06:00" });
    expect(exam.studyMinutes).toBe(120);
    expect(event.endsAt).toBe("2026-11-10T16:30:00.000Z");

    const updated = schedule.updateItem(sid, exam.id, { studyMinutes: 0 });
    expect(updated.studyMinutes).toBe(0);
    expect(updated.title).toBe("Final");
    expect(schedule.updateItem(sid, event.id, { endsAt: "2026-11-10T11:00:00-06:00" }).endsAt).toBe("2026-11-10T17:00:00.000Z");
    expect(schedule.updateItem(sid, event.id, { title: "Lab 2" }).endsAt).toBe("2026-11-10T17:00:00.000Z");
    expect(schedule.updateItem(sid, event.id, { endsAt: null }).endsAt).toBeNull();
    expect(announced).toBe(6);
  });
});
