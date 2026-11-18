import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { AccountRepository } from "../src/accounts/AccountRepository.js";
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
    expect(db.pragma("user_version", { simple: true })).toBe(1);
    const cols = (db.prepare("PRAGMA table_info(items)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["ends_at", "all_day", "study_minutes"]));
    expect(db.prepare("SELECT title, all_day FROM items").get()).toEqual({ title: "Essay", all_day: 0 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('study_blocks','planner_settings')").all()).toHaveLength(2);
  });

  it("runs each migration once", () => {
    const db = openDb(":memory:");
    migrate(db);
    expect(db.pragma("user_version", { simple: true })).toBe(1);
  });

  it("reads and writes the new item fields", () => {
    const db = openDb(":memory:");
    const sid = new AccountRepository(db).create().studentId;
    const repo = new ScheduleRepository(db);
    const item = repo.createManualItem(sid, { courseId: null, kind: "event", title: "Lab", dueAt: "2026-11-03T15:00:00.000Z", endsAt: "2026-11-03T17:00:00.000Z" });
    expect(item).toMatchObject({ endsAt: "2026-11-03T17:00:00.000Z", allDay: false, studyMinutes: null });
    expect(repo.updateItem(sid, item.id, { studyMinutes: 120 })).toMatchObject({ studyMinutes: 120 });
  });
});
