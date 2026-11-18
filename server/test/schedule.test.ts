import { describe, expect, it } from "vitest";
import { setup } from "./helpers.js";

const WEEK = "/api/schedule/week?from=2026-11-02T00:00:00Z";

describe("UC2: view and edit the schedule", () => {
  it("adds a manual exam, including one Canvas does not list", async () => {
    const { newStudent } = setup();
    const s = await newStudent();
    const course = (await s.post("/api/courses", { name: "Statistics", code: "STAT 3000" }).expect(201)).body;
    const exam = (
      await s
        .post("/api/items", { title: "Quiz 3", kind: "exam", dueAt: "2026-11-04T14:00:00-05:00", courseId: course.id })
        .expect(201)
    ).body;
    expect(exam).toMatchObject({ source: "manual", kind: "exam", courseName: "Statistics", dueAt: "2026-11-04T19:00:00.000Z" });

    const week = (await s.get(WEEK).expect(200)).body;
    expect(week.items.map((i: { id: string }) => i.id)).toEqual([exam.id]);
  });

  it("shows only the requested seven days, earliest first, with undated items listed apart", async () => {
    const { newStudent } = setup();
    const s = await newStudent();
    await s.post("/api/items", { title: "Later", kind: "assignment", dueAt: "2026-11-08T12:00:00Z" });
    await s.post("/api/items", { title: "Sooner", kind: "assignment", dueAt: "2026-11-03T12:00:00Z" });
    await s.post("/api/items", { title: "Next week", kind: "assignment", dueAt: "2026-11-09T00:00:00Z" });
    await s.post("/api/items", { title: "Exam, date unknown", kind: "exam", dueAt: null });

    const week = (await s.get(WEEK)).body;
    expect(week.items.map((i: { title: string }) => i.title)).toEqual(["Sooner", "Later"]);
    expect(week.undated.map((i: { title: string }) => i.title)).toEqual(["Exam, date unknown"]);
  });

  it("edits an item and sets each of the four statuses", async () => {
    const { newStudent } = setup();
    const s = await newStudent();
    const item = (await s.post("/api/items", { title: "Essay", kind: "assignment", dueAt: "2026-11-03T12:00:00Z" })).body;

    const edited = (await s.patch(`/api/items/${item.id}`, { title: "Essay draft", dueAt: "2026-11-04T12:00:00Z" }).expect(200)).body;
    expect(edited).toMatchObject({ title: "Essay draft", dueAt: "2026-11-04T12:00:00.000Z" });

    for (const status of ["in_progress", "done", "postponed", "not_started"]) {
      const res = await s.put(`/api/items/${item.id}/status`, { status }).expect(200);
      expect(res.body.status).toBe(status);
    }
    await s.put(`/api/items/${item.id}/status`, { status: "finished" }).expect(400);
  });

  it("deletes an item", async () => {
    const { newStudent } = setup();
    const s = await newStudent();
    const item = (await s.post("/api/items", { title: "Gone", kind: "event", dueAt: "2026-11-03T12:00:00Z" })).body;
    await s.del(`/api/items/${item.id}`).expect(204);
    await s.del(`/api/items/${item.id}`).expect(404);
  });

  it("rejects invalid input with a clear message", async () => {
    const { newStudent } = setup();
    const s = await newStudent();
    const res = await s.post("/api/items", { title: "", kind: "homework", dueAt: "soon" }).expect(400);
    expect(res.body.error).toBe("invalid_request");
    await s.get("/api/schedule/week?from=yesterday").expect(400);
    await s.post("/api/items", { title: "X", kind: "exam", dueAt: null, courseId: "00000000-0000-4000-8000-000000000000" }).expect(404);
  });

  it("refuses an end that is not after the start", async () => {
    const { newStudent } = setup();
    const s = await newStudent();
    const start = "2026-11-03T15:00:00Z";
    for (const endsAt of [start, "2026-11-03T14:00:00Z"]) {
      const res = await s.post("/api/items", { title: "Lab", kind: "event", dueAt: start, endsAt }).expect(400);
      expect(res.body).toEqual({ error: "invalid_request", message: "endsAt: must be after dueAt" });
    }
    const lab = (await s.post("/api/items", { title: "Lab", kind: "event", dueAt: start, endsAt: "2026-11-03T16:00:00Z" }).expect(201)).body;

    // Only the end changes: it is compared with the saved start.
    await s.patch(`/api/items/${lab.id}`, { endsAt: "2026-11-03T15:00:00Z" }).expect(400);
    await s.patch(`/api/items/${lab.id}`, { dueAt: "2026-11-03T17:00:00Z", endsAt: "2026-11-03T16:30:00Z" }).expect(400);
    await s.patch(`/api/items/${lab.id}`, { endsAt: "2026-11-03T15:30:00Z" }).expect(200);
    await s.patch(`/api/items/${lab.id}`, { endsAt: null }).expect(200);
  });

  it("deleting the account removes all of the student's data", async () => {
    const { db, newStudent } = setup();
    const s = await newStudent();
    await s.post("/api/items", { title: "Essay", kind: "assignment", dueAt: "2026-11-03T12:00:00Z" });
    await s.del("/api/account").expect(204);
    await s.get(WEEK).expect(401);
    expect(db.prepare("SELECT COUNT(*) AS n FROM items").get()).toEqual({ n: 0 });
  });
});
