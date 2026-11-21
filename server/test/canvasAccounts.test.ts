import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CanvasReaderRepository } from "../src/canvasReader/CanvasReaderRepository.js";
import { encrypt } from "../src/crypto.js";
import { loginAs, setup, type Student } from "./helpers.js";

/** A test server whose Canvas knows two students: maya (user 1) and liam (user 2). */
function world() {
  const t = setup();
  t.login.users = { maya: "1", liam: "2" };
  return t;
}

type Db = ReturnType<typeof setup>["db"];
const count = (db: Db, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

const work = (title: string, courseId: string | null = null) => ({
  title,
  kind: "assignment",
  dueAt: "2026-11-10T17:00:00Z",
  courseId,
});

async function overview(s: Student) {
  const body = (await s.get("/api/schedule/overview").expect(200)).body;
  return [...body.items, ...body.undated] as { title: string; courseId: string | null; courseName: string | null }[];
}
const titles = async (s: Student) => (await overview(s)).map((i) => i.title).sort();

/** Logs in and, when the reply hands the phone another account's token, switches to it. */
async function logIn(s: Student, code: string) {
  const res = await loginAs(s, code);
  expect(res.status).toBe(200);
  if (res.body.deviceToken) s.useToken(res.body.deviceToken);
  return res.body;
}

describe("a Canvas login opens that student's own account", () => {
  it("the first login links the phone's own account and keeps its hand-added items", async () => {
    const { db, newStudent } = world();
    const phone = await newStudent();
    await phone.post("/api/items", work("Read chapter 4")).expect(201);
    expect((await phone.get("/api/canvas/connection").expect(200)).body.linked).toBe(false);

    const res = await loginAs(phone, "maya");
    expect(res.status).toBe(200);
    expect(res.body.deviceToken).toBeUndefined();
    expect(res.body).toMatchObject({ connected: true, linked: true });
    expect(await titles(phone)).toEqual(["Read chapter 4"]);
    expect(count(db, "students")).toBe(1);
  });

  it("logging in again as the same student changes nothing", async () => {
    const { db, newStudent } = world();
    const phone = await newStudent();
    await phone.post("/api/items", work("Read chapter 4")).expect(201);
    await logIn(phone, "maya");

    const res = await loginAs(phone, "maya");
    expect(res.status).toBe(200);
    expect(res.body.deviceToken).toBeUndefined();
    expect(res.body).toMatchObject({ connected: true, linked: true });
    expect(await titles(phone)).toEqual(["Read chapter 4"]);
    expect(count(db, "students")).toBe(1);
    expect(count(db, "devices")).toBe(1);
    expect(count(db, "items")).toBe(1);
  });

  it("another student on the same phone gets a new account", async () => {
    const { db, newStudent } = world();
    const phone = await newStudent();
    await logIn(phone, "maya");
    await phone.post("/api/items", work("Maya's essay")).expect(201);
    const mayaToken = phone.token;

    const res = await loginAs(phone, "liam");
    expect(res.status).toBe(200);
    expect(res.body.deviceToken).toEqual(expect.any(String));
    expect(res.body).toMatchObject({ connected: true, linked: true });
    phone.useToken(res.body.deviceToken);
    expect(await titles(phone)).toEqual([]);
    expect(count(db, "students")).toBe(2);

    // The phone no longer holds maya's token, so it no longer opens her account.
    phone.useToken(mayaToken);
    await phone.get("/api/canvas/connection").expect(401);

    const second = await newStudent();
    const body = await logIn(second, "maya");
    expect(body.deviceToken).toEqual(expect.any(String));
    expect(await titles(second)).toEqual(["Maya's essay"]);
  });

  it("a phone linked to one student logging in as another existing student switches and leaves both accounts", async () => {
    const { db, newStudent } = world();
    const phone = await newStudent();
    await logIn(phone, "maya");
    await phone.post("/api/items", work("Maya's essay")).expect(201);
    await logIn(phone, "liam");
    await phone.post("/api/items", work("Liam's lab")).expect(201);

    const body = await logIn(phone, "maya");
    expect(body.deviceToken).toEqual(expect.any(String));
    expect(await titles(phone)).toEqual(["Maya's essay"]);
    expect(count(db, "students")).toBe(2);

    await logIn(phone, "liam");
    expect(await titles(phone)).toEqual(["Liam's lab"]);
  });

  it("an unlinked phone logging in to an existing account moves its hand-added items and is deleted", async () => {
    const { db, schedule, accounts, newStudent } = world();
    const a = await newStudent();
    await logIn(a, "maya");
    await a.post("/api/items", work("Maya's essay")).expect(201);
    const maya = accounts.findByToken(a.token)!;

    const b = await newStudent();
    const oldAccount = accounts.findByToken(b.token)!;
    const course = (await b.post("/api/courses", { name: "Reading group" }).expect(201)).body;
    await b.post("/api/items", work("Read chapter 4", course.id)).expect(201);
    // An account connected before accounts were linked can have Canvas courses and items.
    const canvasCourse = randomUUID();
    db.prepare(
      "INSERT INTO courses (id, student_id, source, external_id, name) VALUES (?, ?, 'canvas', '777', 'Old Canvas course')",
    ).run(canvasCourse, oldAccount);
    db.prepare(
      `INSERT INTO items (id, student_id, course_id, source, external_id, kind, title, due_at, created_at, updated_at)
       VALUES (?, ?, ?, 'canvas', 'assignment:9', 'assignment', 'Canvas homework', '2026-11-12T17:00:00.000Z', 'x', 'x')`,
    ).run(randomUUID(), oldAccount, canvasCourse);
    await b.post("/api/items", work("Notes for the old course", canvasCourse)).expect(201);
    const students = count(db, "students");
    const oldToken = b.token;
    const changed: string[] = [];
    schedule.onChange((id) => changed.push(id));

    const res = await loginAs(b, "maya");
    expect(res.status).toBe(200);
    expect(res.body.deviceToken).toEqual(expect.any(String));
    b.useToken(res.body.deviceToken);
    expect(await titles(b)).toEqual(["Maya's essay", "Notes for the old course", "Read chapter 4"]);
    const items = await overview(b);
    expect(items.find((i) => i.title === "Read chapter 4")).toMatchObject({ courseId: course.id, courseName: "Reading group" });
    expect(items.find((i) => i.title === "Notes for the old course")).toMatchObject({ courseId: null });
    expect(changed).toEqual([maya]);

    b.useToken(oldToken);
    await b.get("/api/canvas/connection").expect(401);
    expect(count(db, "students")).toBe(students - 1);
  });

  it("an unlinked phone's own Canvas login is revoked when its account goes", async () => {
    const { db, login, secretKey, accounts, newStudent } = world();
    const a = await newStudent();
    await logIn(a, "maya");
    login.revoked.length = 0;

    // An account that logged in with Canvas before accounts were linked.
    const b = await newStudent();
    const oldAccount = accounts.findByToken(b.token)!;
    new CanvasReaderRepository(db).saveConnection(oldAccount, "https://canvas.test", encrypt("old-access", secretKey), {
      refreshSealed: encrypt("old-refresh", secretKey),
      accessExpiresAt: null,
    });

    await logIn(b, "maya");
    expect(login.revoked).toContain("old-access");
  });

  it("disconnect keeps the account linked", async () => {
    const { newStudent } = world();
    const phone = await newStudent();
    await logIn(phone, "maya");
    await phone.del("/api/canvas/connection").expect(204);
    expect((await phone.get("/api/canvas/connection").expect(200)).body).toMatchObject({ connected: false, linked: true });

    const res = await loginAs(phone, "maya");
    expect(res.status).toBe(200);
    expect(res.body.deviceToken).toBeUndefined();
    expect(res.body).toMatchObject({ connected: true, linked: true });
  });

  it("the token form links the same way", async () => {
    const { canvas, newStudent } = world();
    const a = await newStudent();
    await logIn(a, "maya");
    await a.post("/api/items", work("Maya's essay")).expect(201);

    canvas.userId = "1";
    const b = await newStudent();
    const pasted = { baseUrl: "https://canvas.test/", token: "pasted-token-1234567890" };
    const res = await b.put("/api/canvas/connection", pasted).expect(200);
    expect(res.body.deviceToken).toEqual(expect.any(String));
    expect(res.body).toMatchObject({ connected: true, linked: true, baseUrl: "https://canvas.test" });
    b.useToken(res.body.deviceToken);
    expect(await titles(b)).toEqual(["Maya's essay"]);
  });

  it("deleting the account logs out its other phones", async () => {
    const { newStudent } = world();
    const one = await newStudent();
    await logIn(one, "maya");
    const two = await newStudent();
    await logIn(two, "maya");
    await two.get("/api/canvas/connection").expect(200);

    await one.del("/api/account").expect(204);
    await two.get("/api/canvas/connection").expect(401);
  });

  it("stores no Canvas user ID", async () => {
    const { db, accounts, secretKey, newStudent } = world();
    const phone = await newStudent();
    await logIn(phone, "maya");

    for (const table of ["students", "devices"]) {
      for (const row of db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]) {
        expect(Object.values(row)).not.toContain("1");
      }
    }
    const { canvas_identity } = db.prepare("SELECT canvas_identity FROM students").get() as { canvas_identity: string };
    const expected = accounts.identityHash("https://canvas.test", "1");
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    expect(expected).toBe(createHmac("sha256", secretKey).update("https://canvas.test|1").digest("hex"));
    expect(canvas_identity).toBe(expected);
  });

  it("a failed login links nothing", async () => {
    const { db, newStudent } = world();
    const phone = await newStudent();
    const res = await loginAs(phone, "nobody");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("canvas_login_failed");
    expect((await phone.get("/api/canvas/connection").expect(200)).body.linked).toBe(false);
    expect(count(db, "students")).toBe(1);
    expect(db.prepare("SELECT canvas_identity FROM students").get()).toEqual({ canvas_identity: null });
  });
});

describe("log out", () => {
  it("log out forgets only this phone", async () => {
    const { newStudent } = world();
    const phone1 = await newStudent();
    await logIn(phone1, "maya");
    const phone2 = await newStudent();
    await logIn(phone2, "maya");

    await phone1.del("/api/device").expect(204);
    await phone1.get("/api/canvas/connection").expect(401);
    const status = (await phone2.get("/api/canvas/connection").expect(200)).body;
    expect(status).toMatchObject({ connected: true, linked: true });
  });

  it("an unlinked account can't log out", async () => {
    const { newStudent } = world();
    const phone = await newStudent();
    const res = await phone.del("/api/device");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("account_not_linked");
    await phone.get("/api/canvas/connection").expect(200);
  });

  it("log out then log in again brings the data back and leaves no empty account", async () => {
    const { db, newStudent } = world();
    const phone = await newStudent();
    await logIn(phone, "maya");
    await phone.post("/api/items", work("Read chapter 4")).expect(201);
    const before = count(db, "students");

    await phone.del("/api/device").expect(204);
    const fresh = await newStudent();
    const body = await logIn(fresh, "maya");
    expect(body.deviceToken).toEqual(expect.any(String));
    expect(await titles(fresh)).toEqual(["Read chapter 4"]);
    expect(count(db, "students")).toBe(before);
  });
});
