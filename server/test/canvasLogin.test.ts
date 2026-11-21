import { describe, expect, it } from "vitest";
import type { CanvasLogin } from "../src/canvas/CanvasLogin.js";
import { CanvasReaderService, InvalidCanvasUrlError } from "../src/canvasReader/CanvasReaderService.js";
import { CANVAS, NOW, setup } from "./helpers.js";

const row = (db: ReturnType<typeof setup>["db"]) =>
  db.prepare("SELECT * FROM canvas_connections").get() as Record<string, string | null>;

describe("log in with Canvas", () => {
  it("reports loginAvailable", async () => {
    const on = await setup().newStudent();
    expect((await on.get("/api/canvas/connection").expect(200)).body.loginAvailable).toBe(true);

    const off = await setup({ login: false }).newStudent();
    expect((await off.get("/api/canvas/connection").expect(200)).body.loginAvailable).toBe(false);
    const res = await off.post("/api/canvas/login").expect(404);
    expect(res.body.error).toBe("login_unavailable");
  });

  it("start returns Canvas's authorize URL and a state", async () => {
    const s = await setup().newStudent();
    const { authorizeUrl, state } = (await s.post("/api/canvas/login").expect(200)).body;
    expect(state.length).toBeGreaterThanOrEqual(43);
    expect(authorizeUrl).toBe(`https://canvas.test/login/oauth2/auth?state=${state}`);
  });

  it("finish connects: tokens sealed, expiry stored, nothing about the Canvas user kept", async () => {
    const { db, tokensSeen, newStudent } = setup();
    const s = await newStudent();
    const { state } = (await s.post("/api/canvas/login").expect(200)).body;
    const res = await s.post("/api/canvas/login/finish", { code: "good-code", state }).expect(200);
    expect(res.body).toMatchObject({ connected: true, baseUrl: "https://canvas.test" });

    const r = row(db);
    expect(r.token_sealed).not.toContain("access-1");
    expect(r.refresh_sealed).not.toContain("refresh-1");
    expect(r.refresh_sealed).toBeTruthy();
    expect(r.access_expires_at).toBe(new Date(NOW.getTime() + 3600 * 1000).toISOString());
    expect(tokensSeen).toEqual(["access-1"]);
  });

  it("a state works once", async () => {
    const s = await setup().newStudent();
    const { state } = (await s.post("/api/canvas/login").expect(200)).body;
    await s.post("/api/canvas/login/finish", { code: "good-code", state }).expect(200);
    const res = await s.post("/api/canvas/login/finish", { code: "good-code", state }).expect(409);
    expect(res.body.error).toBe("login_expired");
  });

  it("a state from another student or after 10 minutes gives login_expired", async () => {
    const { newStudent, setClock } = setup();
    const a = await newStudent();
    const b = await newStudent();
    const { state } = (await a.post("/api/canvas/login").expect(200)).body;
    expect((await b.post("/api/canvas/login/finish", { code: "good-code", state }).expect(409)).body.error).toBe("login_expired");

    const late = (await a.post("/api/canvas/login").expect(200)).body.state;
    setClock(new Date(NOW.getTime() + 10 * 60 * 1000 + 1000));
    expect((await a.post("/api/canvas/login/finish", { code: "good-code", state: late }).expect(409)).body.error).toBe("login_expired");
  });

  it("two logins started: each state works once", async () => {
    const s = await setup().newStudent();
    const first = (await s.post("/api/canvas/login").expect(200)).body.state;
    const second = (await s.post("/api/canvas/login").expect(200)).body.state;
    expect(first).not.toBe(second);
    await s.post("/api/canvas/login/finish", { code: "good-code", state: first }).expect(200);
    await s.post("/api/canvas/login/finish", { code: "good-code", state: second }).expect(200);
    await s.post("/api/canvas/login/finish", { code: "good-code", state: second }).expect(409);
  });

  it("Canvas refusing the code gives canvas_login_failed", async () => {
    const { db, newStudent } = setup();
    const s = await newStudent();
    const { state } = (await s.post("/api/canvas/login").expect(200)).body;
    const res = await s.post("/api/canvas/login/finish", { code: "bad-code", state }).expect(409);
    expect(res.body.error).toBe("canvas_login_failed");
    expect(db.prepare("SELECT COUNT(*) AS n FROM canvas_connections").get()).toEqual({ n: 0 });
  });

  it("connecting with a pasted token still works and is never renewed", async () => {
    const { db, newStudent } = setup();
    const s = await newStudent();
    await s.put("/api/canvas/connection", CANVAS).expect(200);
    expect(row(db).refresh_sealed).toBeNull();
  });

  it("an insecure login address is refused when the insecure flag is off", () => {
    const { login } = setup();
    const insecure = { ...login, canvasUrl: "http://canvas.test" } as unknown as CanvasLogin;
    expect(
      () => new CanvasReaderService({} as never, {} as never, (() => ({})) as never, { secretKey: Buffer.alloc(32), login: insecure }),
    ).toThrow(InvalidCanvasUrlError);
  });

  it("a refused check read after the code exchange gives canvas_token_rejected and saves nothing", async () => {
    const { db, deadTokens, newStudent } = setup();
    deadTokens.add("access-1");
    const s = await newStudent();
    const { state } = (await s.post("/api/canvas/login").expect(200)).body;
    const res = await s.post("/api/canvas/login/finish", { code: "good-code", state }).expect(409);
    expect(res.body.error).toBe("canvas_token_rejected");
    expect(db.prepare("SELECT COUNT(*) AS n FROM canvas_connections").get()).toEqual({ n: 0 });
  });

  it("after a refused code, the same state gives login_expired", async () => {
    const s = await setup().newStudent();
    const { state } = (await s.post("/api/canvas/login").expect(200)).body;
    await s.post("/api/canvas/login/finish", { code: "bad-code", state }).expect(409);
    const res = await s.post("/api/canvas/login/finish", { code: "good-code", state }).expect(409);
    expect(res.body.error).toBe("login_expired");
  });
});
