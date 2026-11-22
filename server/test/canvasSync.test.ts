import request from "supertest";
import { describe, expect, it } from "vitest";
import { CANVAS, setup } from "./helpers.js";

const WEEK = "/api/schedule/week?from=2026-11-02T00:00:00Z";
const keys = (list: { key: string }[]) => list.map((i) => i.key);

describe("UC1: retrieve schedule data", () => {
  it("rejects requests without a device token", async () => {
    const { app } = setup();
    await request(app).get("/api/schedule/week?from=2026-11-02T00:00:00Z").expect(401);
  });

  it("stores the Canvas token encrypted, never in plain text", async () => {
    const { db, newStudent } = setup();
    const s = await newStudent();
    const res = await s.put("/api/canvas/connection", CANVAS).expect(200);
    expect(res.body).toMatchObject({ connected: true, baseUrl: "https://school.instructure.com" });
    expect(JSON.stringify(res.body)).not.toContain(CANVAS.token);

    const row = db.prepare("SELECT token_sealed FROM canvas_connections").get() as { token_sealed: string };
    expect(row.token_sealed).not.toContain(CANVAS.token);
  });

  it("refuses non-https or local Canvas addresses", async () => {
    const { newStudent } = setup();
    const s = await newStudent();
    for (const baseUrl of ["http://school.instructure.com", "https://localhost", "https://127.0.0.1", "not a url"]) {
      const res = await s.put("/api/canvas/connection", { ...CANVAS, baseUrl }).expect(400);
      expect(res.body.error).toBe("invalid_canvas_url");
    }
  });

  it("previews items, flags exams without a date, and stores nothing until confirmed", async () => {
    const { newStudent } = setup();
    const s = await newStudent();
    await s.put("/api/canvas/connection", CANVAS).expect(200);

    const preview = (await s.post("/api/canvas/sync").expect(200)).body;
    const titles = preview.newItems.map((i: { title: string }) => i.title);
    expect(titles).toEqual(["SQL homework", "P2 Architecture", "Final exam (Room 210)", "Midterm Exam"]);
    expect(titles).not.toContain("Old homework"); // past work is skipped
    expect(titles).not.toContain("Reading notes"); // undated non-exams are skipped

    const midterm = preview.newItems.find((i: { title: string }) => i.title === "Midterm Exam");
    expect(midterm).toMatchObject({ kind: "exam", needsDate: true, dueAt: null });
    const final = preview.newItems.find((i: { title: string }) => i.title.startsWith("Final"));
    expect(final).toMatchObject({ kind: "exam", needsDate: false });

    const week = (await s.get("/api/schedule/week?from=2026-11-02T00:00:00Z").expect(200)).body;
    expect(week.items).toHaveLength(0);
    expect(week.undated).toHaveLength(0);
  });

  it("imports only accepted items and fills in a date the student adds", async () => {
    const { newStudent } = setup();
    const s = await newStudent();
    await s.put("/api/canvas/connection", CANVAS).expect(200);
    const preview = (await s.post("/api/canvas/sync").expect(200)).body;
    const key = (title: string) => preview.newItems.find((i: { title: string }) => i.title === title).key;

    const confirm = await s
      .post("/api/canvas/sync/confirm", {
        syncId: preview.syncId,
        accept: [key("SQL homework"), key("P2 Architecture"), key("Midterm Exam")],
        dates: { [key("Midterm Exam")]: "2026-11-06T16:00:00Z" },
      })
      .expect(200);
    expect(confirm.body).toEqual({ added: 3, updated: 0, removed: 0 });

    const week = (await s.get("/api/schedule/week?from=2026-11-02T00:00:00Z").expect(200)).body;
    expect(week.items.map((i: { title: string }) => i.title)).toEqual(["SQL homework", "P2 Architecture", "Midterm Exam"]);
    expect(week.items[0]).toMatchObject({ courseName: "Databases", source: "canvas", status: "not_started" });

    const courses = (await s.get("/api/courses").expect(200)).body.courses;
    expect(courses.map((c: { name: string }) => c.name)).toEqual(["Databases", "Software Engineering"]);
  });

  it("a sync can be confirmed only once", async () => {
    const { newStudent } = setup();
    const s = await newStudent();
    await s.put("/api/canvas/connection", CANVAS).expect(200);
    const { syncId } = (await s.post("/api/canvas/sync").expect(200)).body;
    await s.post("/api/canvas/sync/confirm", { syncId, accept: [] }).expect(200);
    const again = await s.post("/api/canvas/sync/confirm", { syncId, accept: [] }).expect(409);
    expect(again.body.error).toBe("sync_expired");
  });

  it("a re-sync lists nothing for saved items Canvas hasn't changed, and keeps their status", async () => {
    const { newStudent } = setup();
    const s = await newStudent();
    await s.put("/api/canvas/connection", CANVAS).expect(200);
    let preview = (await s.post("/api/canvas/sync").expect(200)).body;
    await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: ["assignment:3"] }).expect(200);
    const week = (await s.get(WEEK)).body;
    await s.put(`/api/items/${week.items[0].id}/status`, { status: "in_progress" }).expect(200);

    preview = (await s.post("/api/canvas/sync").expect(200)).body;
    expect(keys(preview.newItems)).not.toContain("assignment:3");
    expect(keys(preview.skipped)).not.toContain("assignment:3");
    expect(preview.changed).toEqual([]);
    expect(preview.removed).toEqual([]);
    expect((await s.get(WEEK)).body.items).toEqual([expect.objectContaining({ title: "SQL homework", status: "in_progress" })]);
  });

  it("keeps an event's end time and all-day flag", async () => {
    const { newStudent, canvas } = setup();
    const s = await newStudent();
    canvas.data.events.push({ id: "901", courseId: "101", title: "No class", startAt: "2026-11-26T06:00:00Z", endAt: "2026-11-27T06:00:00Z", allDay: true });
    await s.put("/api/canvas/connection", CANVAS).expect(200);
    const preview = (await s.post("/api/canvas/sync").expect(200)).body;
    await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: ["event:901"] }).expect(200);

    const week = (await s.get("/api/schedule/week?from=2026-11-23T00:00:00Z").expect(200)).body;
    expect(week.items.find((i: { title: string }) => i.title === "No class")).toMatchObject({ allDay: true, endsAt: "2026-11-27T06:00:00.000Z" });
  });

  it("lists a changed event with its old and new values, and Save applies them but keeps status and study time", async () => {
    const { newStudent, canvas } = setup();
    const s = await newStudent();
    await s.put("/api/canvas/connection", CANVAS).expect(200);
    let preview = (await s.post("/api/canvas/sync").expect(200)).body;
    await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: ["event:900"] }).expect(200);
    const december = "/api/schedule/week?from=2026-12-07T00:00:00Z";
    const exam = (await s.get(december)).body.items[0];
    await s.put(`/api/items/${exam.id}/status`, { status: "in_progress" }).expect(200);
    await s.patch(`/api/items/${exam.id}`, { studyMinutes: 600 }).expect(200);

    Object.assign(canvas.data.events[0], { endAt: "2026-12-10T18:00:00Z", allDay: true });
    preview = (await s.post("/api/canvas/sync").expect(200)).body;
    expect(preview.changed).toEqual([
      expect.objectContaining({
        key: "event:900",
        title: "Final exam (Room 210)",
        kind: "exam",
        courseName: "Databases",
        changes: [
          { field: "endsAt", from: "2026-12-10T17:00:00.000Z", to: "2026-12-10T18:00:00.000Z" },
          { field: "allDay", from: false, to: true },
        ],
      }),
    ]);
    const res = await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: [] }).expect(200);
    expect(res.body).toEqual({ added: 0, updated: 1, removed: 0 });

    expect((await s.get(december)).body.items).toEqual([
      expect.objectContaining({ id: exam.id, endsAt: "2026-12-10T18:00:00.000Z", allDay: true, status: "in_progress", studyMinutes: 600 }),
    ]);
  });

  it("unticked items are skipped from then on, and ticking a skipped one saves it", async () => {
    const { newStudent } = setup();
    const s = await newStudent();
    await s.put("/api/canvas/connection", CANVAS).expect(200);
    let preview = (await s.post("/api/canvas/sync").expect(200)).body;
    await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: ["assignment:3"] }).expect(200);

    preview = (await s.post("/api/canvas/sync").expect(200)).body;
    expect(preview.newItems).toEqual([]);
    expect(keys(preview.skipped)).toEqual(["assignment:1", "event:900", "assignment:2"]);
    const res = await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: ["assignment:1"] }).expect(200);
    expect(res.body).toEqual({ added: 1, updated: 0, removed: 0 });

    preview = (await s.post("/api/canvas/sync").expect(200)).body;
    expect(preview.newItems).toEqual([]);
    expect(keys(preview.skipped)).toEqual(["event:900", "assignment:2"]);
    expect((await s.get(WEEK)).body.items.map((i: { title: string }) => i.title)).toEqual(["SQL homework", "P2 Architecture"]);
  });

  it("the professor's new date replaces the one in Cue, even one the student set", async () => {
    const { newStudent, canvas } = setup();
    const s = await newStudent();
    await s.put("/api/canvas/connection", CANVAS).expect(200);
    let preview = (await s.post("/api/canvas/sync").expect(200)).body;
    await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: ["assignment:1"] }).expect(200);
    const item = (await s.get(WEEK)).body.items[0];
    await s.patch(`/api/items/${item.id}`, { dueAt: "2026-11-04T05:59:00Z" }).expect(200);

    canvas.data.assignments[0].dueAt = "2026-11-07T05:59:00Z";
    preview = (await s.post("/api/canvas/sync").expect(200)).body;
    expect(preview.changed.map((c: { changes: unknown }) => c.changes)).toEqual([
      [{ field: "dueAt", from: "2026-11-04T05:59:00.000Z", to: "2026-11-07T05:59:00.000Z" }],
    ]);
    await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: [] }).expect(200);

    expect((await s.get(WEEK)).body.items[0]).toMatchObject({ id: item.id, dueAt: "2026-11-07T05:59:00.000Z" });
  });

  it("a date the student added to an undated exam survives syncs until Canvas has one", async () => {
    const { newStudent, canvas } = setup();
    const s = await newStudent();
    await s.put("/api/canvas/connection", CANVAS).expect(200);
    let preview = (await s.post("/api/canvas/sync").expect(200)).body;
    await s
      .post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: ["assignment:2", "assignment:3"], dates: { "assignment:2": "2026-11-06T16:00:00Z" } })
      .expect(200);

    canvas.data.assignments[2].name = "SQL homework 1";
    preview = (await s.post("/api/canvas/sync").expect(200)).body;
    expect(keys(preview.changed)).toEqual(["assignment:3"]);
    await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: [] }).expect(200);
    const midterm = () => s.get(WEEK).then((r) => r.body.items.find((i: { title: string }) => i.title === "Midterm Exam"));
    expect(await midterm()).toMatchObject({ dueAt: "2026-11-06T16:00:00.000Z" });

    canvas.data.assignments[1].dueAt = "2026-11-12T16:00:00Z";
    preview = (await s.post("/api/canvas/sync").expect(200)).body;
    expect(preview.changed).toEqual([
      expect.objectContaining({ key: "assignment:2", changes: [{ field: "dueAt", from: "2026-11-06T16:00:00.000Z", to: "2026-11-12T16:00:00.000Z" }] }),
    ]);
  });

  it("a student's Exam correction survives a renamed item", async () => {
    const { newStudent, canvas } = setup();
    const s = await newStudent();
    await s.put("/api/canvas/connection", CANVAS).expect(200);
    let preview = (await s.post("/api/canvas/sync").expect(200)).body;
    await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: ["assignment:2"] }).expect(200);
    const item = (await s.get(WEEK)).body.undated[0];
    await s.patch(`/api/items/${item.id}`, { kind: "assignment" }).expect(200);

    canvas.data.assignments[1].name = "Midterm Exam (Room 5)";
    preview = (await s.post("/api/canvas/sync").expect(200)).body;
    expect(preview.changed).toEqual([
      expect.objectContaining({ key: "assignment:2", kind: "assignment", changes: [{ field: "title", from: "Midterm Exam", to: "Midterm Exam (Room 5)" }] }),
    ]);
    await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: [] }).expect(200);

    expect((await s.get(WEEK)).body.undated[0]).toMatchObject({ id: item.id, title: "Midterm Exam (Room 5)", kind: "assignment" });
  });

  it("an item gone from Canvas is listed as removed; Cancel keeps it, Save deletes it", async () => {
    const { newStudent, canvas } = setup();
    const s = await newStudent();
    await s.put("/api/canvas/connection", CANVAS).expect(200);
    let preview = (await s.post("/api/canvas/sync").expect(200)).body;
    await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: ["assignment:3"] }).expect(200);

    canvas.data.assignments = canvas.data.assignments.filter((a) => a.id !== "3");
    preview = (await s.post("/api/canvas/sync").expect(200)).body;
    expect(preview.removed).toEqual([
      { key: "assignment:3", itemId: expect.any(String), courseName: "Databases", kind: "assignment", title: "SQL homework", dueAt: "2026-11-03T22:00:00.000Z" },
    ]);

    // Cancel: nothing is confirmed, so the next sync lists it again and it is still saved.
    preview = (await s.post("/api/canvas/sync").expect(200)).body;
    expect(keys(preview.removed)).toEqual(["assignment:3"]);
    expect((await s.get(WEEK)).body.items).toHaveLength(1);

    const res = await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: [] }).expect(200);
    expect(res.body).toEqual({ added: 0, updated: 0, removed: 1 });
    expect((await s.get(WEEK)).body.items).toEqual([]);
  });

  it("an event Canvas moved past the dates read is listed as changed, not removed", async () => {
    const { newStudent, canvas } = setup();
    const s = await newStudent();
    await s.put("/api/canvas/connection", CANVAS).expect(200);
    let preview = (await s.post("/api/canvas/sync").expect(200)).body;
    await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: ["event:900"] }).expect(200);

    Object.assign(canvas.data.events[0], { startAt: "2027-06-10T15:00:00Z", endAt: "2027-06-10T17:00:00Z" });
    preview = (await s.post("/api/canvas/sync").expect(200)).body;
    expect(preview.removed).toEqual([]);
    expect(preview.changed).toEqual([
      expect.objectContaining({
        key: "event:900",
        changes: [
          { field: "dueAt", from: "2026-12-10T15:00:00.000Z", to: "2027-06-10T15:00:00.000Z" },
          { field: "endsAt", from: "2026-12-10T17:00:00.000Z", to: "2027-06-10T17:00:00.000Z" },
        ],
      }),
    ]);
  });

  it("an event Canvas deleted is removed", async () => {
    const { newStudent, canvas } = setup();
    const s = await newStudent();
    await s.put("/api/canvas/connection", CANVAS).expect(200);
    let preview = (await s.post("/api/canvas/sync").expect(200)).body;
    await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: ["event:900"] }).expect(200);

    canvas.data.events = [];
    preview = (await s.post("/api/canvas/sync").expect(200)).body;
    expect(keys(preview.removed)).toEqual(["event:900"]);
  });

  it("an event Cue can't look up is not removed", async () => {
    const { newStudent, canvas } = setup();
    const s = await newStudent();
    await s.put("/api/canvas/connection", CANVAS).expect(200);
    let preview = (await s.post("/api/canvas/sync").expect(200)).body;
    await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: ["event:900"] }).expect(200);

    canvas.data.events = [];
    canvas.failEventLookups = true;
    preview = (await s.post("/api/canvas/sync").expect(200)).body;
    expect(preview.removed).toEqual([]);
  });

  it("keeps the last synced data and asks to reconnect when Canvas rejects the token", async () => {
    const { canvas, newStudent } = setup();
    const s = await newStudent();
    await s.put("/api/canvas/connection", CANVAS).expect(200);
    const preview = (await s.post("/api/canvas/sync").expect(200)).body;
    await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: [preview.newItems[0].key] }).expect(200);

    canvas.rejectToken = true;
    const res = await s.post("/api/canvas/sync").expect(409);
    expect(res.body.error).toBe("canvas_token_rejected");

    const week = (await s.get("/api/schedule/week?from=2026-11-02T00:00:00Z")).body;
    expect(week.items).toHaveLength(1);
  });

  it("sync without a connection explains what to do", async () => {
    const { newStudent } = setup();
    const s = await newStudent();
    const res = await s.post("/api/canvas/sync").expect(409);
    expect(res.body.error).toBe("canvas_not_connected");
  });

  it("students cannot see each other's data", async () => {
    const { newStudent } = setup();
    const a = await newStudent();
    const b = await newStudent();
    const item = (await a.post("/api/items", { title: "Mine", kind: "assignment", dueAt: "2026-11-03T12:00:00Z" })).body;
    await b.patch(`/api/items/${item.id}`, { title: "Hacked" }).expect(404);
    await b.del(`/api/items/${item.id}`).expect(404);
    const bWeek = (await b.get("/api/schedule/week?from=2026-11-02T00:00:00Z")).body;
    expect(bWeek.items).toHaveLength(0);
  });
});
