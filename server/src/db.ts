import Database from "better-sqlite3";

export type Db = Database.Database;

const SCHEMA = `
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

export function openDb(file: string): Db {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
