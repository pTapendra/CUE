import { randomUUID } from "node:crypto";
import type { Db } from "../db.js";
import { hashToken, newDeviceToken } from "../crypto.js";

/** Anonymous accounts: one per installed app, identified only by a device token. */
export class AccountRepository {
  constructor(private readonly db: Db) {}

  create(): { studentId: string; deviceToken: string } {
    const studentId = randomUUID();
    const deviceToken = newDeviceToken();
    this.db
      .prepare("INSERT INTO students (id, token_hash, created_at) VALUES (?, ?, ?)")
      .run(studentId, hashToken(deviceToken), new Date().toISOString());
    return { studentId, deviceToken };
  }

  findByToken(deviceToken: string): string | null {
    const row = this.db
      .prepare("SELECT id FROM students WHERE token_hash = ?")
      .get(hashToken(deviceToken)) as { id: string } | undefined;
    return row?.id ?? null;
  }

  delete(studentId: string): void {
    this.db.prepare("DELETE FROM students WHERE id = ?").run(studentId);
  }
}
