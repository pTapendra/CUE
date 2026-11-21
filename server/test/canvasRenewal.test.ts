import { describe, expect, it } from "vitest";
import { CANVAS, NOW, setup } from "./helpers.js";

const MIN = 60 * 1000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

async function connected(opts: Parameters<typeof setup>[0] = {}) {
  const t = setup(opts);
  const s = await t.newStudent();
  const { state } = (await s.post("/api/canvas/login").expect(200)).body;
  await s.post("/api/canvas/login/finish", { code: "good-code", state }).expect(200);
  return { ...t, s };
}

const expiry = (db: ReturnType<typeof setup>["db"]) =>
  (db.prepare("SELECT access_expires_at AS e FROM canvas_connections").get() as { e: string | null }).e;

describe("renewing Canvas access", () => {
  it("renews access shortly before it expires, then syncs with the new token", async () => {
    const { s, login, tokensSeen, db, setClock } = await connected();
    setClock(at(59 * MIN));
    await s.post("/api/canvas/sync").expect(200);
    expect(login.renewals).toBe(1);
    expect(tokensSeen[tokensSeen.length - 1]).toBe("access-2");
    expect(expiry(db)).toBe(at(59 * MIN + 3600 * 1000).toISOString());
  });

  it("does not renew while access has more than 2 minutes left", async () => {
    const { s, login, setClock } = await connected();
    setClock(at(57 * MIN));
    await s.post("/api/canvas/sync").expect(200);
    expect(login.renewals).toBe(0);
  });

  it("after a 401, renews once and retries", async () => {
    const { s, login, deadTokens } = await connected();
    deadTokens.add("access-1");
    await s.post("/api/canvas/sync").expect(200);
    expect(login.renewals).toBe(1);
  });

  it("renewed but still refused: one retry, then canvas_token_rejected", async () => {
    const { s, login, deadTokens } = await connected();
    deadTokens.add("access-1");
    deadTokens.add("access-2");
    const res = await s.post("/api/canvas/sync").expect(409);
    expect(res.body.error).toBe("canvas_token_rejected");
    expect(login.renewals).toBe(1);
  });

  it("refused renewal asks the student to connect again and keeps the address", async () => {
    const { s, login, setClock } = await connected();
    login.refuseRenewal = true;
    setClock(at(59 * MIN));
    const res = await s.post("/api/canvas/sync").expect(409);
    expect(res.body.error).toBe("canvas_token_rejected");
    expect((await s.get("/api/canvas/connection").expect(200)).body.baseUrl).toBe("https://canvas.test");
  });

  it("tokens without expiry are never renewed before a read, but are after a 401", async () => {
    const t = setup();
    t.login.expiresInSeconds = null;
    const s = await t.newStudent();
    const { state } = (await s.post("/api/canvas/login").expect(200)).body;
    await s.post("/api/canvas/login/finish", { code: "good-code", state }).expect(200);
    expect(expiry(t.db)).toBeNull();

    t.setClock(at(5 * 60 * MIN));
    await s.post("/api/canvas/sync").expect(200);
    expect(t.login.renewals).toBe(0);

    t.deadTokens.add("access-1");
    await s.post("/api/canvas/sync").expect(200);
    expect(t.login.renewals).toBe(1);
  });
});

describe("disconnecting", () => {
  it("revokes a login connection, renewing first if access has expired", async () => {
    const { s, login, setClock } = await connected();
    setClock(at(120 * MIN));
    await s.del("/api/canvas/connection").expect(204);
    expect(login.revoked).toEqual(["access-2"]);
  });

  it("still deletes when revoking fails", async () => {
    const { s, login } = await connected();
    login.failRevoke = true;
    await s.del("/api/canvas/connection").expect(204);
    expect((await s.get("/api/canvas/connection").expect(200)).body.connected).toBe(false);
  });

  it("deleting the account revokes too", async () => {
    const { s, login } = await connected();
    await s.del("/api/account").expect(204);
    expect(login.revoked).toEqual(["access-1"]);
  });

  it("a pasted-token connection is never revoked", async () => {
    const { newStudent, login } = setup();
    const s = await newStudent();
    await s.put("/api/canvas/connection", CANVAS).expect(200);
    await s.del("/api/canvas/connection").expect(204);
    expect(login.revoked).toEqual([]);
  });
});
