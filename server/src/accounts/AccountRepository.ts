import { randomUUID } from "node:crypto";
import type { Db } from "../db.js";
import { hashToken, newDeviceToken } from "../crypto.js";

/** Accounts and their devices. An account may carry a Canvas identity; each phone has its own device token. */
export class AccountRepository {
  constructor(private readonly db: Db) {}

  /** An unlinked account with one device. */
  create(): { studentId: string; deviceToken: string } {
    const studentId = this.insertStudent(null);
    return { studentId, deviceToken: this.addDevice(studentId) };
  }

  /** A new account with this Canvas identity and no device yet. */
  createLinked(identity: string): string {
    return this.insertStudent(identity);
  }

  findByToken(deviceToken: string): string | null {
    const row = this.db
      .prepare("SELECT student_id FROM devices WHERE token_hash = ?")
      .get(hashToken(deviceToken)) as { student_id: string } | undefined;
    return row?.student_id ?? null;
  }

  addDevice(studentId: string): string {
    const deviceToken = newDeviceToken();
    this.db
      .prepare("INSERT INTO devices (token_hash, student_id, created_at) VALUES (?, ?, ?)")
      .run(hashToken(deviceToken), studentId, new Date().toISOString());
    return deviceToken;
  }

  removeDevice(deviceToken: string): void {
    this.db.prepare("DELETE FROM devices WHERE token_hash = ?").run(hashToken(deviceToken));
  }

  identityOf(studentId: string): string | null {
    const row = this.db.prepare("SELECT canvas_identity FROM students WHERE id = ?").get(studentId) as
      | { canvas_identity: string | null }
      | undefined;
    return row?.canvas_identity ?? null;
  }

  findByIdentity(identity: string): string | null {
    const row = this.db.prepare("SELECT id FROM students WHERE canvas_identity = ?").get(identity) as
      | { id: string }
      | undefined;
    return row?.id ?? null;
  }

  /** Links an unlinked account. Throws when it already has an identity (that never changes) or another account has this one. */
  setIdentity(studentId: string, identity: string): void {
    const { changes } = this.db
      .prepare("UPDATE students SET canvas_identity = ? WHERE id = ? AND canvas_identity IS NULL")
      .run(identity, studentId);
    if (changes === 0) throw new Error("Only an existing unlinked account can take a Canvas identity");
  }

  /** Moves hand-added courses and items (and the study blocks of those items); returns the items moved. */
  moveManualData(fromStudentId: string, toStudentId: string): number {
    return this.transaction(() => {
      const args = { from: fromStudentId, to: toStudentId };
      this.db.prepare("UPDATE courses SET student_id = @to WHERE student_id = @from AND source = 'manual'").run(args);
      this.db
        .prepare(
          `UPDATE study_blocks SET student_id = @to
           WHERE student_id = @from AND item_id IN (SELECT id FROM items WHERE student_id = @from AND source = 'manual')`,
        )
        .run(args);
      return this.db.prepare("UPDATE items SET student_id = @to WHERE student_id = @from AND source = 'manual'").run(args)
        .changes;
    });
  }

  delete(studentId: string): void {
    this.db.prepare("DELETE FROM students WHERE id = ?").run(studentId);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  private insertStudent(identity: string | null): string {
    const studentId = randomUUID();
    this.db
      .prepare("INSERT INTO students (id, canvas_identity, created_at) VALUES (?, ?, ?)")
      .run(studentId, identity, new Date().toISOString());
    return studentId;
  }
}
