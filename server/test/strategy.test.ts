import { describe, expect, it } from "vitest";
import { PLANNER_DEFAULTS } from "../src/planner/config.js";
import { DefaultStrategy } from "../src/planner/DefaultStrategy.js";
import type { PlanInput, PlanItem, PlannerSettings, StudyWindow } from "../src/planner/types.js";

const NOW = new Date("2026-11-02T15:00:00Z"); // Mon 2 Nov, 09:00 CST

function settings(windows?: StudyWindow[], limit?: number): PlannerSettings {
  return {
    timeZone: "America/Chicago",
    dailyLimitMinutes: limit ?? PLANNER_DEFAULTS.dailyLimitMinutes,
    windows: windows ?? PLANNER_DEFAULTS.windows,
  };
}
function weekdays(start: string, end: string): StudyWindow[] {
  return PLANNER_DEFAULTS.windows.map((w) => ({
    weekday: w.weekday,
    enabled: w.weekday >= 1 && w.weekday <= 5,
    start: w.weekday >= 1 && w.weekday <= 5 ? start : w.start,
    end: w.weekday >= 1 && w.weekday <= 5 ? end : w.end,
  }));
}
function onlyMonday(start: string, end: string): StudyWindow[] {
  return PLANNER_DEFAULTS.windows.map((w) => (w.weekday === 1 ? { weekday: 1, enabled: true, start, end } : { ...w, enabled: false }));
}
function exam(id: string, dueAt: string, minutes: number): PlanItem {
  return { id, title: id, kind: "exam", dueAt, studyMinutes: minutes, done: false };
}
function assignment(id: string, dueAt: string, minutes: number): PlanItem {
  return { id, title: id, kind: "assignment", dueAt, studyMinutes: minutes, done: false };
}
function plan(partial: Partial<PlanInput>) {
  return new DefaultStrategy().plan({ now: NOW, settings: settings(), items: [], busy: [], accepted: [], rejected: [], ...partial });
}

describe("DefaultStrategy", () => {
  it("spreads one exam's blocks one per day, closest to the exam", () => {
    const r = plan({ items: [exam("E", "2026-11-13T15:00:00Z", 360)] });
    expect(r.proposed.map((b) => b.startsAt)).toEqual([
      "2026-11-04T00:00:00.000Z", "2026-11-06T00:00:00.000Z", "2026-11-07T16:00:00.000Z",
      "2026-11-08T16:00:00.000Z", "2026-11-11T00:00:00.000Z", "2026-11-13T00:00:00.000Z",
    ]);
    expect(r.shortfalls).toEqual([]);
  });

  it("gives the nearest deadline first pick and respects the daily limit", () => {
    const r = plan({ settings: settings(weekdays("18:00", "20:00"), 60),
      items: [exam("A", "2026-11-05T15:00:00Z", 120), exam("B", "2026-11-05T18:00:00Z", 120)] });
    expect(r.proposed).toEqual([
      { itemId: "A", startsAt: "2026-11-03T00:00:00.000Z", endsAt: "2026-11-03T01:00:00.000Z" },
      { itemId: "B", startsAt: "2026-11-04T00:00:00.000Z", endsAt: "2026-11-04T01:00:00.000Z" },
      { itemId: "A", startsAt: "2026-11-05T00:00:00.000Z", endsAt: "2026-11-05T01:00:00.000Z" },
    ]);
    expect(r.shortfalls).toEqual([{ itemId: "B", itemTitle: "B", dueAt: "2026-11-05T18:00:00Z", neededMinutes: 120, plannedMinutes: 60 }]);
  });

  it("plans an exam before an assignment due at the same time", () => {
    const due = "2026-11-05T05:59:00Z"; // Wed 4 Nov 23:59 CST
    const r = plan({ settings: settings(weekdays("18:00", "19:00")), items: [assignment("H", due, 60), exam("E", due, 60)] });
    expect(r.proposed.map((b) => [b.itemId, b.startsAt])).toEqual([["H", "2026-11-04T00:00:00.000Z"], ["E", "2026-11-05T00:00:00.000Z"]]);
  });

  it("avoids events, accepted blocks and rejected slots", () => {
    const r = plan({ settings: settings(weekdays("18:00", "20:00")), items: [exam("E", "2026-11-04T15:00:00Z", 60)],
      busy: [{ startsAt: "2026-11-04T00:00:00.000Z", endsAt: "2026-11-04T01:00:00.000Z" }],
      rejected: [{ itemId: "E", startsAt: "2026-11-04T01:00:00.000Z", endsAt: "2026-11-04T02:00:00.000Z" }],
      accepted: [{ id: "x", itemId: "OTHER", startsAt: "2026-11-03T00:00:00.000Z", endsAt: "2026-11-03T01:00:00.000Z" }] });
    expect(r.proposed).toEqual([{ itemId: "E", startsAt: "2026-11-03T01:00:00.000Z", endsAt: "2026-11-03T02:00:00.000Z" }]);
  });

  it("counts accepted study toward the item and never doubles a day", () => {
    const r = plan({ items: [exam("E", "2026-11-13T15:00:00Z", 120)],
      accepted: [{ id: "a", itemId: "E", startsAt: "2026-11-13T00:00:00.000Z", endsAt: "2026-11-13T01:00:00.000Z" }] });
    expect(r.proposed).toHaveLength(1);
    expect(r.proposed[0].startsAt).not.toMatch(/^2026-11-13/);
  });

  it("starts earlier than the lead time when the lead days are not enough", () => {
    const r = plan({ items: [assignment("H", "2026-11-14T05:00:00Z", 480)] }); // Fri 13 Nov 23:00 CST, 8 blocks
    expect(r.proposed).toHaveLength(8);
    expect(r.proposed.some((b) => b.startsAt < "2026-11-08T06:00:00.000Z")).toBe(true);
  });

  it("plans nothing when every day is off", () => {
    const off = PLANNER_DEFAULTS.windows.map((w) => ({ ...w, enabled: false }));
    const items = [exam("E", "2026-11-13T15:00:00Z", 360), assignment("H", "2026-11-10T15:00:00Z", 120)];
    const r = plan({ settings: settings(off), items });
    expect(r.proposed).toEqual([]);
    expect(r.shortfalls).toHaveLength(2);
    expect(r.shortfalls.every((s) => s.plannedMinutes === 0)).toBe(true);
    expect(r.shortfalls.map((s) => s.itemId).sort()).toEqual(["E", "H"]);
  });

  it("never plans before now, even when the deadline is today", () => {
    const now = new Date("2026-11-03T01:30:00Z"); // Mon 19:30 CST
    expect(plan({ now, items: [assignment("H", "2026-11-03T03:00:00Z", 60)] }).proposed.map((b) => b.startsAt)).toEqual(["2026-11-03T02:00:00.000Z"]);
    const late = plan({ now, items: [assignment("H", "2026-11-03T02:30:00Z", 60)] });
    expect(late.proposed).toEqual([]);
    expect(late.shortfalls[0].plannedMinutes).toBe(0);
  });

  it("keeps study times in local time across daylight saving", () => {
    const fall = plan({ now: new Date("2026-10-30T15:00:00Z"), settings: settings(weekdays("18:00", "22:00")), items: [exam("E", "2026-11-03T15:00:00Z", 120)] });
    expect(fall.proposed.map((b) => b.startsAt)).toEqual(["2026-10-30T23:00:00.000Z", "2026-11-03T00:00:00.000Z"]);
    const spring = plan({ now: new Date("2027-03-12T15:00:00Z"), settings: settings(weekdays("18:00", "22:00")), items: [exam("E", "2027-03-16T14:00:00Z", 120)] });
    expect(spring.proposed.map((b) => b.startsAt)).toEqual(["2027-03-13T00:00:00.000Z", "2027-03-15T23:00:00.000Z"]);
  });

  it("counts a range past midnight against the day it starts", () => {
    const r = plan({ settings: settings(onlyMonday("22:00", "01:00"), 120),
      items: [exam("1", "2026-11-03T18:00:00Z", 60), exam("2", "2026-11-03T18:01:00Z", 60), exam("3", "2026-11-03T18:02:00Z", 60)] });
    expect(r.proposed.map((b) => [b.itemId, b.startsAt])).toEqual([["1", "2026-11-03T04:00:00.000Z"], ["2", "2026-11-03T05:00:00.000Z"]]);
    expect(r.shortfalls.map((s) => s.itemId)).toEqual(["3"]);
  });

  it("never proposes the same time twice when neighbouring study ranges overlap", () => {
    const windows = PLANNER_DEFAULTS.windows.map((w) =>
      w.weekday === 1 ? { weekday: 1, enabled: true, start: "20:00", end: "08:00" }
        : w.weekday === 2 ? { weekday: 2, enabled: true, start: "06:00", end: "18:00" }
        : { ...w, enabled: false });
    const r = plan({ now: new Date("2026-11-03T11:30:00Z"), settings: settings(windows),
      items: [exam("E", "2026-11-03T23:00:00Z", 120)] });
    expect(r.proposed.map((b) => b.startsAt)).toEqual(["2026-11-03T12:00:00.000Z", "2026-11-03T14:00:00.000Z"]);
    expect(r.shortfalls).toEqual([]);
  });
});
