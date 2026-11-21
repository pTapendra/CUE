import { describe, expect, it } from "vitest";
import { AccountRepository } from "../src/accounts/AccountRepository.js";
import { openDb } from "../src/db.js";

function setup() {
  const db = openDb(":memory:");
  return { db, accounts: new AccountRepository(db) };
}

describe("AccountRepository", () => {
  it("create makes an unlinked account with one device", () => {
    const { accounts } = setup();
    const { studentId, deviceToken } = accounts.create();
    expect(accounts.identityOf(studentId)).toBeNull();
    expect(accounts.findByToken(deviceToken)).toBe(studentId);
  });

  it("addDevice gives another phone the same account", () => {
    const { accounts } = setup();
    const { studentId, deviceToken: first } = accounts.create();
    const second = accounts.addDevice(studentId);
    expect(accounts.findByToken(second)).toBe(studentId);
    accounts.removeDevice(first);
    expect(accounts.findByToken(first)).toBeNull();
    expect(accounts.findByToken(second)).toBe(studentId);
  });

  it("findByIdentity finds a linked account", () => {
    const { accounts } = setup();
    const { studentId } = accounts.create();
    accounts.setIdentity(studentId, "abc");
    expect(accounts.findByIdentity("abc")).toBe(studentId);
    expect(accounts.findByIdentity("zzz")).toBeNull();
    const linked = accounts.createLinked("def");
    expect(accounts.identityOf(linked)).toBe("def");
    expect(accounts.findByIdentity("def")).toBe(linked);
    expect(accounts.addDevice(linked)).toBeTruthy();
  });

  it("refuses a second account with the same identity", () => {
    const { accounts } = setup();
    const a = accounts.create().studentId;
    const b = accounts.create().studentId;
    accounts.setIdentity(a, "abc");
    expect(() => accounts.setIdentity(b, "abc")).toThrow();
  });

  it("moveManualData moves hand-added courses, items and their blocks, not Canvas ones", () => {
    const { db, accounts } = setup();
    const from = accounts.create().studentId;
    const to = accounts.create().studentId;
    const course = (id: string, source: string) =>
      db.prepare("INSERT INTO courses (id, student_id, source, external_id, name) VALUES (?, ?, ?, ?, 'C')").run(id, from, source, id);
    const item = (id: string, source: string) =>
      db
        .prepare(`INSERT INTO items (id, student_id, source, external_id, kind, title, created_at, updated_at)
                  VALUES (?, ?, ?, ?, 'assignment', 'T', 'x', 'x')`)
        .run(id, from, source, id);
    const block = (id: string, itemId: string) =>
      db.prepare("INSERT INTO study_blocks VALUES (?, ?, ?, 'a', 'b', 'proposed', 'x', 'x')").run(id, from, itemId);
    course("cm", "manual");
    course("cc", "canvas");
    item("im", "manual");
    item("ic", "canvas");
    block("bm", "im");
    block("bc", "ic");

    expect(accounts.moveManualData(from, to)).toBe(1);

    const owner = (table: string, id: string) =>
      (db.prepare(`SELECT student_id FROM ${table} WHERE id = ?`).get(id) as { student_id: string }).student_id;
    expect(owner("courses", "cm")).toBe(to);
    expect(owner("items", "im")).toBe(to);
    expect(owner("study_blocks", "bm")).toBe(to);
    expect(owner("courses", "cc")).toBe(from);
    expect(owner("items", "ic")).toBe(from);
    expect(owner("study_blocks", "bc")).toBe(from);
  });

  it("delete removes the account's devices", () => {
    const { accounts } = setup();
    const { studentId, deviceToken } = accounts.create();
    accounts.delete(studentId);
    expect(accounts.findByToken(deviceToken)).toBeNull();
  });
});
