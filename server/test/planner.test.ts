import { describe, expect, it } from "vitest";
import { setup } from "./helpers.js";

const WEEK = "/api/schedule/week?from=2026-11-02T06:00:00Z&days=14";
const DEFAULT_WINDOWS = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  enabled: true,
  start: weekday === 0 || weekday === 6 ? "10:00" : "18:00",
  end: weekday === 0 || weekday === 6 ? "16:00" : "22:00",
}));
const SETTINGS = { timeZone: "America/Chicago", dailyLimitMinutes: 180, windows: DEFAULT_WINDOWS };
const EXAM = { title: "Midterm", kind: "exam", dueAt: "2026-11-13T15:00:00Z" };

async function planned() {
  const { newStudent, db } = setup();
  const me = await newStudent();
  await me.put("/api/planner/settings", SETTINGS).expect(200);
  const item = (await me.post("/api/items", EXAM).expect(201)).body;
  return { me, db, item };
}

describe("Planner API", () => {
  it("saves study times and plans the student's exams", async () => {
    const { me } = await planned();
    const saved = await me.get("/api/planner/settings").expect(200);
    expect(saved.body.timeZone).toBe("America/Chicago");
    const week = await me.get(WEEK).expect(200);
    expect(week.body.blocks).toHaveLength(6);
    expect(week.body.blocks.every((b: { state: string; total: number }) => b.state === "proposed" && b.total === 6)).toBe(true);
    expect(week.body.shortfalls).toEqual([]);
  });

  it("rejects invalid study times", async () => {
    const { newStudent } = setup();
    const me = await newStudent();
    const withWindow = (i: number, patch: object) => DEFAULT_WINDOWS.map((w, n) => (n === i ? { ...w, ...patch } : w));
    const bad = [
      { ...SETTINGS, timeZone: "Mars/Olympus" },
      { ...SETTINGS, windows: DEFAULT_WINDOWS.slice(0, 6) },
      { ...SETTINGS, windows: withWindow(1, { start: "18:00", end: "18:00" }) },
      { ...SETTINGS, windows: withWindow(1, { start: "08:00", end: "21:00" }) },
      { ...SETTINGS, dailyLimitMinutes: 30 },
    ];
    for (const body of bad) {
      const res = await me.put("/api/planner/settings", body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    }
  });

  it("accepts one, accepts all in a range, rejects and moves blocks", async () => {
    const { me } = await planned();
    const blocks = (await me.get(WEEK)).body.blocks;
    await me.post(`/api/blocks/${blocks[0].id}/accept`).expect(204);
    const all = await me.post("/api/blocks/accept", { from: "2026-11-02T06:00:00Z", to: "2026-11-16T06:00:00Z" }).expect(200);
    expect(all.body).toEqual({ accepted: 5 });

    await me.post(`/api/blocks/${blocks[1].id}/reject`).expect(204);
    const past = await me.post(`/api/blocks/${blocks[2].id}/move`, { startsAt: "2026-11-01T18:00:00Z" });
    expect(past.status).toBe(409);
    expect(past.body).toEqual({ error: "block_move_invalid", message: "Pick a time in the future." });
    const garbage = await me.post(`/api/blocks/${blocks[2].id}/move`, { startsAt: "nope" });
    expect(garbage.status).toBe(400);
    await me.post(`/api/blocks/${blocks[2].id}/move`, { startsAt: "2026-11-12T02:00:00Z" }).expect(204);
  });

  it("drops accepted blocks that end after a moved deadline", async () => {
    const { me, item } = await planned();
    await me.post("/api/blocks/accept", { from: "2026-11-02T06:00:00Z", to: "2026-11-16T06:00:00Z" }).expect(200);
    const before = (await me.get(WEEK)).body.blocks.filter((b: { state: string }) => b.state === "accepted");
    const due = "2026-11-06T15:00:00Z";
    await me.patch(`/api/items/${item.id}`, { dueAt: due }).expect(200);
    const after = (await me.get(WEEK)).body.blocks.filter((b: { state: string }) => b.state === "accepted");
    const kept = before.filter((b: { endsAt: string }) => Date.parse(b.endsAt) <= Date.parse(due));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(before.length);
    expect(after.map((b: { id: string }) => b.id).sort()).toEqual(kept.map((b: { id: string }) => b.id).sort());
  });

  it("rejecting a block that a re-plan replaced is a 404", async () => {
    const { me, item } = await planned();
    const old = (await me.get(WEEK)).body.blocks[0];
    await me.patch(`/api/items/${item.id}`, { title: "Midterm exam" }).expect(200);
    const res = await me.post(`/api/blocks/${old.id}/reject`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("shows shortfalls in the week", async () => {
    const { me } = await planned();
    await me.patch(`/api/items/${(await me.get(WEEK)).body.items[0].id}`, { dueAt: "2026-11-03T15:00:00Z" }).expect(200);
    const week = (await me.get(WEEK)).body;
    expect(week.shortfalls).toHaveLength(1);
    expect(week.shortfalls[0]).toMatchObject({ itemTitle: "Midterm", neededMinutes: 360 });
    expect(week.shortfalls[0].plannedMinutes).toBeLessThan(360);
  });

  it("deleting the account removes blocks and settings", async () => {
    const { me, db } = await planned();
    const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect(count("study_blocks")).toBeGreaterThan(0);
    expect(count("planner_settings")).toBe(1);
    await me.del("/api/account").expect(204);
    expect(count("study_blocks")).toBe(0);
    expect(count("planner_settings")).toBe(0);
  });
});
