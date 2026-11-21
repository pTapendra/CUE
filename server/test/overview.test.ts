import { describe, expect, it } from "vitest";
import { NOW, setup } from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

type Student = Awaited<ReturnType<ReturnType<typeof setup>["newStudent"]>>;

async function addItem(s: Student, title: string, days: number | null) {
  const res = await s.post("/api/items", { title, kind: "assignment", dueAt: days === null ? null : at(days) }).expect(201);
  return res.body.id as string;
}

describe("the schedule overview", () => {
  it("returns items 30 days back to 200 days ahead, all undated items, and blocks that haven't ended", async () => {
    const { db, newStudent } = setup();
    const s = await newStudent();
    const studentId = (db.prepare("SELECT id FROM students").get() as { id: string }).id;
    await addItem(s, "40 days ago", -40);
    await addItem(s, "20 days ago", -20);
    const ahead = await addItem(s, "150 days ahead", 150);
    await addItem(s, "210 days ahead", 210);
    await addItem(s, "No date", null);

    const insert = db.prepare(
      "INSERT INTO study_blocks (id, student_id, item_id, starts_at, ends_at, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'accepted', ?, ?)",
    );
    const block = (id: string, from: number, to: number) => insert.run(id, studentId, ahead, at(from), at(to), at(0), at(0));
    block("ended", -3, -2.9);
    block("running", -0.01, 0.05);
    block("soon", 12, 12.1);
    block("beyond", 205, 205.1);

    const res = (await s.get("/api/schedule/overview").expect(200)).body;
    expect(res.items.map((i: { title: string }) => i.title)).toEqual(["20 days ago", "150 days ahead"]);
    expect(res.undated.map((i: { title: string }) => i.title)).toEqual(["No date"]);
    const accepted = res.blocks.filter((b: { state: string }) => b.state === "accepted");
    expect(accepted.map((b: { id: string }) => b.id).sort()).toEqual(["running", "soon"]);
    expect(res.shortfalls).toEqual(expect.any(Array));
  });

  it("only the student's own data", async () => {
    const { newStudent } = setup();
    const a = await newStudent();
    const b = await newStudent();
    await addItem(a, "A's item", 5);
    await addItem(a, "A's undated", null);

    const mine = (await b.get("/api/schedule/overview").expect(200)).body;
    expect(mine.items).toEqual([]);
    expect(mine.undated).toEqual([]);
    expect(mine.blocks).toEqual([]);
    const theirs = (await a.get("/api/schedule/overview").expect(200)).body;
    expect(theirs.items).toHaveLength(1);
    expect(theirs.undated).toHaveLength(1);
  });

  it("changes nothing", async () => {
    const { db, newStudent } = setup();
    const s = await newStudent();
    await addItem(s, "Soon", 3);
    await addItem(s, "No date", null);
    await s.get("/api/schedule/overview").expect(200);
    const counts = () =>
      ["items", "study_blocks", "courses", "planner_settings"].map(
        (t) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n,
      );
    const dump = () => JSON.stringify(db.prepare("SELECT * FROM study_blocks ORDER BY id").all());
    const before = [counts(), dump()];
    await s.get("/api/schedule/overview").expect(200);
    expect([counts(), dump()]).toEqual(before);
  });
});
