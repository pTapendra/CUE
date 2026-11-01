import request from "supertest";
import { describe, expect, it } from "vitest";
import { CANVAS, setup } from "./helpers.js";

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
    const titles = preview.items.map((i: { title: string }) => i.title);
    expect(titles).toEqual(["SQL homework", "P2 Architecture", "Final exam (Room 210)", "Midterm Exam"]);
    expect(titles).not.toContain("Old homework"); // past work is skipped
    expect(titles).not.toContain("Reading notes"); // undated non-exams are skipped

    const midterm = preview.items.find((i: { title: string }) => i.title === "Midterm Exam");
    expect(midterm).toMatchObject({ kind: "exam", needsDate: true, dueAt: null });
    const final = preview.items.find((i: { title: string }) => i.title.startsWith("Final"));
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
    const key = (title: string) => preview.items.find((i: { title: string }) => i.title === title).key;

    const confirm = await s
      .post("/api/canvas/sync/confirm", {
        syncId: preview.syncId,
        accept: [key("SQL homework"), key("P2 Architecture"), key("Midterm Exam")],
        dates: { [key("Midterm Exam")]: "2026-11-06T16:00:00Z" },
      })
      .expect(200);
    expect(confirm.body.imported).toBe(3);

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

  it("re-syncing keeps the student's status and marks items already imported", async () => {
    const { newStudent } = setup();
    const s = await newStudent();
    await s.put("/api/canvas/connection", CANVAS).expect(200);
    let preview = (await s.post("/api/canvas/sync").expect(200)).body;
    const sql = preview.items.find((i: { title: string }) => i.title === "SQL homework");
    await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: [sql.key] }).expect(200);

    const week = (await s.get("/api/schedule/week?from=2026-11-02T00:00:00Z")).body;
    await s.put(`/api/items/${week.items[0].id}/status`, { status: "in_progress" }).expect(200);

    preview = (await s.post("/api/canvas/sync").expect(200)).body;
    expect(preview.items.find((i: { key: string }) => i.key === sql.key).alreadyImported).toBe(true);
    await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: [sql.key] }).expect(200);

    const after = (await s.get("/api/schedule/week?from=2026-11-02T00:00:00Z")).body;
    expect(after.items).toHaveLength(1);
    expect(after.items[0].status).toBe("in_progress");
  });

  it("keeps the last synced data and asks to reconnect when Canvas rejects the token", async () => {
    const { canvas, newStudent } = setup();
    const s = await newStudent();
    await s.put("/api/canvas/connection", CANVAS).expect(200);
    const preview = (await s.post("/api/canvas/sync").expect(200)).body;
    await s.post("/api/canvas/sync/confirm", { syncId: preview.syncId, accept: [preview.items[0].key] }).expect(200);

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
