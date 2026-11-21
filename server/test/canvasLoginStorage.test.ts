import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AccountRepository } from "../src/accounts/AccountRepository.js";
import { CanvasReaderRepository } from "../src/canvasReader/CanvasReaderRepository.js";
import { openDb } from "../src/db.js";

const URL_ = "https://canvas.example.edu";

function setup() {
  const db = openDb(":memory:");
  const accounts = new AccountRepository(db);
  return { db, repo: new CanvasReaderRepository(db), a: accounts.create().studentId, b: accounts.create().studentId };
}

describe("Canvas login storage", () => {
  it("a pasted token replacing a login connection clears the refresh token and expiry", () => {
    const { repo, a } = setup();
    repo.saveConnection(a, URL_, "a", { refreshSealed: "r", accessExpiresAt: "2026-11-02T16:00:00.000Z" });
    expect(repo.getConnection(a)).toMatchObject({ tokenSealed: "a", refreshSealed: "r", accessExpiresAt: "2026-11-02T16:00:00.000Z" });
    repo.saveConnection(a, URL_, "b");
    expect(repo.getConnection(a)).toMatchObject({ tokenSealed: "b", refreshSealed: null, accessExpiresAt: null });
  });

  it("updateAccess keeps the refresh token unless given a new one", () => {
    const { repo, a } = setup();
    repo.saveConnection(a, URL_, "a", { refreshSealed: "r1", accessExpiresAt: "2026-11-02T16:00:00.000Z" });
    repo.updateAccess(a, "a2", "2026-11-02T17:00:00.000Z");
    expect(repo.getConnection(a)).toMatchObject({ tokenSealed: "a2", refreshSealed: "r1", accessExpiresAt: "2026-11-02T17:00:00.000Z" });
    repo.updateAccess(a, "a3", null, "r2");
    expect(repo.getConnection(a)).toMatchObject({ tokenSealed: "a3", refreshSealed: "r2", accessExpiresAt: null });
  });

  it("a login state works once, only for its student, only before it expires", () => {
    const { repo, a, b } = setup();
    repo.saveLoginState(a, "s1", 60_000);
    expect(repo.takeLoginState(a, "s1")).toBe(true);
    expect(repo.takeLoginState(a, "s1")).toBe(false);

    repo.saveLoginState(a, "s2", 60_000);
    expect(repo.takeLoginState(b, "s2")).toBe(false);
    expect(repo.takeLoginState(a, "s2")).toBe(false);

    repo.saveLoginState(a, "s3", -1);
    expect(repo.takeLoginState(a, "s3")).toBe(false);
  });

  it("two unexpired states for one student each work once", () => {
    const { repo, a } = setup();
    repo.saveLoginState(a, "x", 60_000);
    repo.saveLoginState(a, "y", 60_000);
    expect(repo.takeLoginState(a, "x")).toBe(true);
    expect(repo.takeLoginState(a, "y")).toBe(true);
  });

  it("login states are stored hashed", () => {
    const { db, repo, a } = setup();
    repo.saveLoginState(a, "raw-state-value", 60_000);
    const rows = db.prepare("SELECT * FROM canvas_login_states").all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("raw-state-value");
  });

  it("saving a login state clears expired ones", () => {
    const { db, repo, a } = setup();
    repo.saveLoginState(a, "old", -1);
    repo.saveLoginState(a, "new", 60_000);
    expect(db.prepare("SELECT COUNT(*) AS n FROM canvas_login_states").get()).toEqual({ n: 1 });
  });

  it("login states survive reopening the database", () => {
    const dir = mkdtempSync(join(tmpdir(), "cue-login-"));
    const file = join(dir, "t.db");
    try {
      const db1 = openDb(file);
      const id = new AccountRepository(db1).create().studentId;
      new CanvasReaderRepository(db1).saveLoginState(id, "persist", 60_000);
      db1.close();
      const db2 = openDb(file);
      expect(new CanvasReaderRepository(db2).takeLoginState(id, "persist")).toBe(true);
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
