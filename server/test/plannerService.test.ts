import { describe, expect, it } from "vitest";
import { AccountRepository } from "../src/accounts/AccountRepository.js";
import { openDb } from "../src/db.js";
import { PLANNER_DEFAULTS } from "../src/planner/config.js";
import { DefaultStrategy } from "../src/planner/DefaultStrategy.js";
import { PlannerRepository } from "../src/planner/PlannerRepository.js";
import { PlannerService } from "../src/planner/PlannerService.js";
import type { PlanInput, PlannerSettings, PlanningStrategy, StudyWindow } from "../src/planner/types.js";
import { ScheduleRepository } from "../src/schedule/ScheduleRepository.js";
import { ScheduleService } from "../src/schedule/ScheduleService.js";

const START = new Date("2026-11-02T15:00:00.000Z"); // Mon 2 Nov, 09:00 in Chicago
const FROM = new Date("2026-11-01T00:00:00.000Z");
const EXAM_DUE = "2026-11-13T15:00:00.000Z";

const chicago = (windows: StudyWindow[] = PLANNER_DEFAULTS.windows): PlannerSettings => ({
  timeZone: "America/Chicago",
  dailyLimitMinutes: PLANNER_DEFAULTS.dailyLimitMinutes,
  windows,
});

function setup(strategy?: PlanningStrategy) {
  let clock = new Date(START);
  const now = () => clock;
  const db = openDb(":memory:");
  const sid = new AccountRepository(db).create().studentId;
  const schedule = new ScheduleService(new ScheduleRepository(db), {
    defaultStudyMinutes: PLANNER_DEFAULTS.studyMinutes,
    blockMinutes: PLANNER_DEFAULTS.blockMinutes,
    now,
  });
  const planner = new PlannerService(new PlannerRepository(db), schedule, { strategy, now });
  schedule.onChange((id) => planner.replan(id));
  return {
    sid,
    schedule,
    planner,
    setClock: (d: Date) => (clock = d),
    blocks: () => schedule.getWeek(sid, FROM, 60).blocks,
  };
}

const addExam = (s: ReturnType<typeof setup>, extra: object = {}) =>
  s.schedule.addItem(s.sid, { courseId: null, kind: "exam", title: "Final", dueAt: EXAM_DUE, ...extra });

/** Local wall-clock "HH:mm" of an instant. */
const localTime = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });

describe("PlannerService", () => {
  it("plans nothing until a time zone is saved", () => {
    const s = setup();
    expect(s.planner.getSettings(s.sid)).toEqual({
      timeZone: null,
      dailyLimitMinutes: PLANNER_DEFAULTS.dailyLimitMinutes,
      windows: PLANNER_DEFAULTS.windows,
    });
    addExam(s);
    s.planner.replan(s.sid);
    expect(s.blocks()).toEqual([]);
    expect(s.planner.shortfalls(s.sid)).toEqual([]);

    s.planner.saveSettings(s.sid, chicago());
    expect(s.blocks()).toHaveLength(6);
    expect(s.planner.getSettings(s.sid).timeZone).toBe("America/Chicago");
  });

  it("re-plans when the schedule changes", () => {
    const s = setup();
    s.planner.saveSettings(s.sid, chicago());
    expect(s.blocks()).toEqual([]);
    addExam(s);
    expect(s.blocks().map((b) => b.state)).toEqual(Array(6).fill("proposed"));
  });

  it("keeps accepted blocks through re-plans", () => {
    const s = setup();
    s.planner.saveSettings(s.sid, chicago());
    addExam(s);
    const first = s.blocks()[0];
    s.schedule.acceptBlock(s.sid, first.id);

    s.schedule.addItem(s.sid, { courseId: null, kind: "assignment", title: "Essay", dueAt: "2026-11-09T15:00:00.000Z" });
    const kept = s.blocks().find((b) => b.id === first.id);
    expect(kept).toMatchObject({ state: "accepted", startsAt: first.startsAt, endsAt: first.endsAt });
  });

  it("keeps an accepted block that a new event clashes with, flags it, and does not move it", () => {
    const s = setup();
    s.planner.saveSettings(s.sid, chicago());
    addExam(s);
    const accepted = s.blocks()[0];
    s.schedule.acceptBlock(s.sid, accepted.id);

    s.schedule.addItem(s.sid, { courseId: null, kind: "event", title: "Club meeting", dueAt: accepted.startsAt }); // re-plans
    s.planner.replan(s.sid);
    expect(s.blocks().find((b) => b.id === accepted.id)).toMatchObject({
      state: "accepted",
      startsAt: accepted.startsAt,
      endsAt: accepted.endsAt,
      clash: { title: "Club meeting", startsAt: accepted.startsAt },
    });
  });

  it("lowering study time removes extra future accepted blocks; 0 h removes all future ones", () => {
    const s = setup();
    s.planner.saveSettings(s.sid, chicago());
    const exam = addExam(s);
    s.schedule.acceptBlocks(s.sid, FROM, new Date("2026-11-14T00:00:00Z"));
    expect(s.blocks().filter((b) => b.state === "accepted")).toHaveLength(6);

    s.schedule.updateItem(s.sid, exam.id, { studyMinutes: 240 });
    expect(s.blocks().filter((b) => b.state === "accepted")).toHaveLength(4);

    s.schedule.updateItem(s.sid, exam.id, { studyMinutes: 0 });
    expect(s.blocks()).toEqual([]);
  });

  it("a done item clears its future blocks", () => {
    const s = setup();
    s.planner.saveSettings(s.sid, chicago());
    const exam = addExam(s);
    s.schedule.acceptBlock(s.sid, s.blocks()[0].id);
    expect(s.blocks().length).toBeGreaterThan(1);

    s.schedule.setStatus(s.sid, exam.id, "done");
    expect(s.blocks()).toEqual([]);
  });

  it("re-plans once per local day", () => {
    const inner = new DefaultStrategy();
    let calls = 0;
    const s = setup({ plan: (input: PlanInput) => (calls++, inner.plan(input)) });
    s.planner.replanIfNewDay(s.sid);
    expect(calls).toBe(0);

    s.planner.saveSettings(s.sid, chicago());
    expect(calls).toBe(1);
    s.planner.replanIfNewDay(s.sid);
    s.planner.replanIfNewDay(s.sid);
    expect(calls).toBe(1);

    s.setClock(new Date("2026-11-03T15:00:00.000Z"));
    s.planner.replanIfNewDay(s.sid);
    s.planner.replanIfNewDay(s.sid);
    expect(calls).toBe(2);
  });

  it("re-plans in a new time zone and keeps accepted blocks", () => {
    const s = setup();
    s.planner.saveSettings(s.sid, chicago());
    addExam(s);
    const accepted = s.blocks()[0];
    s.schedule.acceptBlock(s.sid, accepted.id);

    s.planner.saveSettings(s.sid, { ...chicago(), timeZone: "America/New_York" });
    const blocks = s.blocks();
    expect(blocks.find((b) => b.id === accepted.id)).toMatchObject({
      state: "accepted", startsAt: accepted.startsAt, endsAt: accepted.endsAt,
    });
    const proposed = blocks.filter((b) => b.state === "proposed");
    expect(proposed.length).toBeGreaterThan(0);
    for (const b of proposed) {
      const weekend = [0, 6].includes(new Date(b.startsAt).getUTCDay());
      expect(localTime(b.startsAt, "America/New_York")).toBe(weekend ? "10:00" : "18:00");
    }
  });

  it("a Canvas event whose end is not after its start is saved without an end and takes up an hour", () => {
    const tuesday = PLANNER_DEFAULTS.windows.map((w) => ({ ...w, enabled: w.weekday === 2, start: "18:00", end: "19:00" }));
    const s = setup();
    s.planner.saveSettings(s.sid, chicago(tuesday));
    s.schedule.importFromCanvas(s.sid, {
      courses: [{ externalId: "c", name: "Course", code: null }],
      items: [
        { externalId: "ev", courseExternalId: "c", kind: "event", title: "Review session", dueAt: "2026-11-04T00:00:00.000Z", endsAt: "2026-11-04T00:00:00.000Z", allDay: false },
        { externalId: "hw", courseExternalId: "c", kind: "assignment", title: "HW", dueAt: "2026-11-05T05:00:00.000Z", endsAt: null, allDay: false },
      ],
    });
    const week = s.schedule.getWeek(s.sid, FROM, 7);
    expect(week.items.find((i) => i.title === "Review session")!.endsAt).toBeNull();
    expect(week.blocks).toEqual([]); // Tuesday 18:00 is the only study time, and the event takes it
  });

  it("all-day events do not block study time", () => {
    const monday = PLANNER_DEFAULTS.windows.map((w) => ({ ...w, enabled: w.weekday === 1, start: "18:00", end: "19:00" }));
    const exam = { externalId: "e1", courseExternalId: "c", kind: "exam" as const, title: "Final", dueAt: "2026-11-03T15:00:00.000Z", endsAt: null, allDay: false };
    const event = (allDay: boolean) => ({
      externalId: "ev", courseExternalId: "c", kind: "event" as const, title: "Trip",
      dueAt: "2026-11-03T00:00:00.000Z", endsAt: "2026-11-03T01:00:00.000Z", allDay,
    });
    const course = { externalId: "c", name: "Course", code: null };

    for (const [allDay, expected] of [[true, 1], [false, 0]] as const) {
      const s = setup();
      s.planner.saveSettings(s.sid, chicago(monday));
      s.schedule.importFromCanvas(s.sid, { courses: [course], items: [exam, event(allDay)] });
      expect(s.blocks().map((b) => b.startsAt)).toEqual(expected ? ["2026-11-03T00:00:00.000Z"] : []);
    }
  });
});
