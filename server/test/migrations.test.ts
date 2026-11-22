import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { AccountRepository } from "../src/accounts/AccountRepository.js";
import { hashToken } from "../src/crypto.js";
import { migrate, openDb } from "../src/db.js";
import { ScheduleRepository } from "../src/schedule/ScheduleRepository.js";

const ORIGINAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS students (
  id            TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL
);

-- No name or email is stored anywhere (privacy principle).
CREATE TABLE IF NOT EXISTS canvas_connections (
  student_id    TEXT PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  base_url      TEXT NOT NULL,
  token_sealed  TEXT NOT NULL,
  last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS courses (
  id            TEXT PRIMARY KEY,
  student_id    TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  source        TEXT NOT NULL CHECK (source IN ('canvas', 'manual')),
  external_id   TEXT,
  name          TEXT NOT NULL,
  code          TEXT,
  UNIQUE (student_id, source, external_id)
);

CREATE TABLE IF NOT EXISTS sync_previews (
  id            TEXT PRIMARY KEY,
  student_id    TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  payload       TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id            TEXT PRIMARY KEY,
  student_id    TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id     TEXT REFERENCES courses(id) ON DELETE SET NULL,
  source        TEXT NOT NULL CHECK (source IN ('canvas', 'manual')),
  external_id   TEXT,
  kind          TEXT NOT NULL CHECK (kind IN ('assignment', 'exam', 'event')),
  title         TEXT NOT NULL,
  due_at        TEXT,
  status        TEXT NOT NULL DEFAULT 'not_started'
                CHECK (status IN ('not_started', 'in_progress', 'done', 'postponed')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (student_id, source, external_id)
);

CREATE INDEX IF NOT EXISTS items_by_due ON items (student_id, due_at);
`;

describe("migrations", () => {
  it("upgrades a database created before the Planner and keeps its rows", () => {
    const db = new Database(":memory:");
    db.exec(ORIGINAL_SCHEMA);
    db.prepare("INSERT INTO students VALUES ('s1', 'h', '2026-11-01T00:00:00Z')").run();
    db.prepare(`INSERT INTO items (id, student_id, source, external_id, kind, title, due_at, created_at, updated_at)
                VALUES ('i1', 's1', 'manual', 'i1', 'assignment', 'Essay', NULL, 'x', 'x')`).run();
    migrate(db);
    expect(db.pragma("user_version", { simple: true })).toBe(4);
    const cols = (db.prepare("PRAGMA table_info(items)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["ends_at", "all_day", "study_minutes"]));
    expect(db.prepare("SELECT title, all_day FROM items").get()).toEqual({ title: "Essay", all_day: 0 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('study_blocks','planner_settings')").all()).toHaveLength(2);
  });

  it("runs each migration once", () => {
    const db = openDb(":memory:");
    migrate(db);
    expect(db.pragma("user_version", { simple: true })).toBe(4);
  });

  it("reads and writes the new item fields", () => {
    const db = openDb(":memory:");
    const sid = new AccountRepository(db).create().studentId;
    const repo = new ScheduleRepository(db);
    const item = repo.createManualItem(sid, { courseId: null, kind: "event", title: "Lab", dueAt: "2026-11-03T15:00:00.000Z", endsAt: "2026-11-03T17:00:00.000Z" });
    expect(item).toMatchObject({ endsAt: "2026-11-03T17:00:00.000Z", allDay: false, studyMinutes: null });
    expect(repo.updateItem(sid, item.id, { studyMinutes: 120 })).toMatchObject({ studyMinutes: 120 });
  });

  it("adds the login columns and keeps existing Canvas connections", () => {
    const db = new Database(":memory:");
    db.exec(ORIGINAL_SCHEMA);
    db.pragma("user_version = 1");
    db.prepare("INSERT INTO students VALUES ('s1', 'h', '2026-11-01T00:00:00Z')").run();
    db.prepare("INSERT INTO canvas_connections (student_id, base_url, token_sealed, last_synced_at) VALUES ('s1', 'https://c.edu', 'sealed', '2026-11-01T00:00:00Z')").run();
    migrate(db);
    expect(db.pragma("user_version", { simple: true })).toBe(4);
    expect(db.prepare("SELECT * FROM canvas_connections").get()).toEqual({
      student_id: "s1",
      base_url: "https://c.edu",
      token_sealed: "sealed",
      last_synced_at: "2026-11-01T00:00:00Z",
      refresh_sealed: null,
      access_expires_at: null,
    });
  });

  it("moves device tokens into devices and keeps every student's rows", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(ORIGINAL_SCHEMA);
    migrate(db); // build the schema at version 2 first, then rewind students to the old shape
    db.pragma("foreign_keys = OFF");
    db.exec(`DROP TABLE devices; DROP TABLE canvas_skipped;
      CREATE TABLE students_old (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
      DROP TABLE students; ALTER TABLE students_old RENAME TO students;`);
    db.pragma("foreign_keys = ON");
    db.pragma("user_version = 2");
    const token = "known-token";
    db.prepare("INSERT INTO students VALUES ('s1', ?, '2026-11-01T00:00:00Z')").run(hashToken(token));
    db.prepare("INSERT INTO courses (id, student_id, source, external_id, name) VALUES ('c1', 's1', 'manual', NULL, 'Math')").run();
    db.prepare(`INSERT INTO items (id, student_id, course_id, source, external_id, kind, title, created_at, updated_at)
                VALUES ('i1', 's1', 'c1', 'manual', 'i1', 'assignment', 'Essay', 'x', 'x')`).run();
    db.prepare("INSERT INTO study_blocks VALUES ('b1', 's1', 'i1', 'a', 'b', 'proposed', 'x', 'x')").run();
    db.prepare("INSERT INTO planner_settings (student_id, time_zone, daily_limit_minutes, windows) VALUES ('s1', 'UTC', 60, '[]')").run();
    db.prepare("INSERT INTO canvas_connections (student_id, base_url, token_sealed) VALUES ('s1', 'https://c.edu', 'sealed')").run();
    const tables = ["courses", "items", "study_blocks", "planner_settings", "canvas_connections"];
    const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const before = tables.map(count);

    migrate(db);

    expect(new AccountRepository(db).findByToken(token)).toBe("s1");
    expect(tables.map(count)).toEqual(before);
    expect(before).toEqual([1, 1, 1, 1, 1]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    const cols = (db.prepare("PRAGMA table_info(students)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("canvas_identity");
    expect(cols).not.toContain("token_hash");
    expect(new AccountRepository(db).identityOf("s1")).toBeNull();
  });
});
