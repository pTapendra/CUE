import { randomUUID } from "node:crypto";
import { hashToken } from "../crypto.js";
import type { Db } from "../db.js";
import type { SyncPreview } from "./types.js";

export interface StoredConnection {
  baseUrl: string;
  tokenSealed: string;
  lastSyncedAt: string | null;
  refreshSealed: string | null;
  accessExpiresAt: string | null;
}

/** Data owned by the Canvas Reader: the sealed token and pending sync previews. */
export class CanvasReaderRepository {
  constructor(private readonly db: Db) {}

  getConnection(studentId: string): StoredConnection | null {
    const row = this.db
      .prepare(
        "SELECT base_url, token_sealed, last_synced_at, refresh_sealed, access_expires_at FROM canvas_connections WHERE student_id = ?",
      )
      .get(studentId) as
      | {
          base_url: string;
          token_sealed: string;
          last_synced_at: string | null;
          refresh_sealed: string | null;
          access_expires_at: string | null;
        }
      | undefined;
    return row
      ? {
          baseUrl: row.base_url,
          tokenSealed: row.token_sealed,
          lastSyncedAt: row.last_synced_at,
          refreshSealed: row.refresh_sealed,
          accessExpiresAt: row.access_expires_at,
        }
      : null;
  }

  /** Without `renewal` (a pasted token) the refresh token and expiry are cleared. */
  saveConnection(
    studentId: string,
    baseUrl: string,
    tokenSealed: string,
    renewal?: { refreshSealed: string; accessExpiresAt: string | null } | null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO canvas_connections (student_id, base_url, token_sealed, refresh_sealed, access_expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (student_id) DO UPDATE SET base_url = excluded.base_url, token_sealed = excluded.token_sealed,
           refresh_sealed = excluded.refresh_sealed, access_expires_at = excluded.access_expires_at`,
      )
      .run(studentId, baseUrl, tokenSealed, renewal?.refreshSealed ?? null, renewal?.accessExpiresAt ?? null);
  }

  /** Stores a renewed access token; keeps the refresh token unless a new one is given. */
  updateAccess(studentId: string, tokenSealed: string, accessExpiresAt: string | null, refreshSealed?: string): void {
    this.db
      .prepare(
        `UPDATE canvas_connections SET token_sealed = ?, access_expires_at = ?, refresh_sealed = COALESCE(?, refresh_sealed)
         WHERE student_id = ?`,
      )
      .run(tokenSealed, accessExpiresAt, refreshSealed ?? null, studentId);
  }

  deleteConnection(studentId: string): void {
    this.db.prepare("DELETE FROM canvas_connections WHERE student_id = ?").run(studentId);
  }

  markSynced(studentId: string, at: Date): void {
    this.db
      .prepare("UPDATE canvas_connections SET last_synced_at = ? WHERE student_id = ?")
      .run(at.toISOString(), studentId);
  }

  savePreview(studentId: string, preview: Omit<SyncPreview, "syncId">, ttlMs: number): SyncPreview {
    const syncId = randomUUID();
    const now = Date.now();
    this.db.prepare("DELETE FROM sync_previews WHERE student_id = ? OR expires_at < ?").run(studentId, new Date(now).toISOString());
    this.db
      .prepare("INSERT INTO sync_previews (id, student_id, payload, expires_at) VALUES (?, ?, ?, ?)")
      .run(syncId, studentId, JSON.stringify(preview), new Date(now + ttlMs).toISOString());
    return { syncId, ...preview };
  }

  takePreview(studentId: string, syncId: string): SyncPreview | null {
    const row = this.db
      .prepare("SELECT payload, expires_at FROM sync_previews WHERE id = ? AND student_id = ?")
      .get(syncId, studentId) as { payload: string; expires_at: string } | undefined;
    if (!row) return null;
    this.db.prepare("DELETE FROM sync_previews WHERE id = ?").run(syncId);
    if (Date.parse(row.expires_at) < Date.now()) return null;
    return { syncId, ...(JSON.parse(row.payload) as Omit<SyncPreview, "syncId">) };
  }

  saveLoginState(studentId: string, state: string, ttlMs: number): void {
    const now = Date.now();
    this.db.prepare("DELETE FROM canvas_login_states WHERE expires_at < ?").run(new Date(now).toISOString());
    this.db
      .prepare("INSERT INTO canvas_login_states (state_hash, student_id, expires_at) VALUES (?, ?, ?)")
      .run(hashToken(state), studentId, new Date(now + ttlMs).toISOString());
  }

  /** Single use: the row is deleted whoever owns it. True only for its student, before it expires. */
  takeLoginState(studentId: string, state: string): boolean {
    const hash = hashToken(state);
    const row = this.db
      .prepare("SELECT student_id, expires_at FROM canvas_login_states WHERE state_hash = ?")
      .get(hash) as { student_id: string; expires_at: string } | undefined;
    if (!row) return false;
    this.db.prepare("DELETE FROM canvas_login_states WHERE state_hash = ?").run(hash);
    return row.student_id === studentId && Date.parse(row.expires_at) >= Date.now();
  }
}
