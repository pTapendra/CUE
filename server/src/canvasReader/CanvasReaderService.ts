import { randomBytes } from "node:crypto";
import { CanvasAuthError, type CanvasClient, type CanvasClientFactory } from "../canvas/CanvasClient.js";
import { CanvasLoginRefusedError, type CanvasLogin } from "../canvas/CanvasLogin.js";
import { decrypt, encrypt } from "../crypto.js";
import type { ScheduleService } from "../schedule/ScheduleService.js";
import type { CanvasReaderRepository, StoredConnection } from "./CanvasReaderRepository.js";
import type { ItemKind, ProposedCourse, ProposedItem, SyncPreview } from "./types.js";

export class CanvasNotConnectedError extends Error {
  constructor() {
    super("Canvas is not connected");
    this.name = "CanvasNotConnectedError";
  }
}

export class SyncExpiredError extends Error {
  constructor() {
    super("This sync has expired; please sync again");
    this.name = "SyncExpiredError";
  }
}

export class InvalidCanvasUrlError extends Error {
  constructor(reason: string) {
    super(`Invalid Canvas address: ${reason}`);
    this.name = "InvalidCanvasUrlError";
  }
}

export class LoginExpiredError extends Error {
  constructor() {
    super("The login took too long; please try again");
    this.name = "LoginExpiredError";
  }
}

export class LoginUnavailableError extends Error {
  constructor() {
    super("Canvas login is not set up on this server");
    this.name = "LoginUnavailableError";
  }
}

const EXAM_WORDS = /\b(exam|midterm|mid-term|final|test)\b/i;
const DAY = 24 * 60 * 60 * 1000;
const PREVIEW_TTL = 30 * 60 * 1000;
const LOGIN_TTL = 10 * 60 * 1000;
const RENEW_WITHIN = 2 * 60 * 1000;

export interface CanvasReaderOptions {
  secretKey: Buffer;
  /** Allows http:// and local addresses, for development against a local fake Canvas. */
  allowInsecureUrls?: boolean;
  /** Logging in with Canvas; null or absent when the server has no login settings. */
  login?: CanvasLogin | null;
  now?: () => Date;
}

/** Canvas Reader (UC1): read-only sync that the student confirms before anything is stored. */
export class CanvasReaderService {
  private readonly now: () => Date;
  private readonly login: CanvasLogin | null;
  /** One in-flight renewal per student: Canvas replaces the access token in place. */
  private readonly renewing = new Map<string, Promise<string>>();

  constructor(
    private readonly repo: CanvasReaderRepository,
    private readonly schedule: ScheduleService,
    private readonly makeClient: CanvasClientFactory,
    private readonly opts: CanvasReaderOptions,
  ) {
    this.now = opts.now ?? (() => new Date());
    this.login = opts.login ?? null;
    if (this.login) this.checkUrl(this.login.canvasUrl);
  }

  status(studentId: string) {
    const c = this.repo.getConnection(studentId);
    return {
      connected: c != null,
      baseUrl: c?.baseUrl ?? null,
      lastSyncedAt: c?.lastSyncedAt ?? null,
      loginAvailable: this.login != null,
    };
  }

  /** Starts a login: a single-use state, kept in the database, and Canvas's authorize address. */
  startLogin(studentId: string): { authorizeUrl: string; state: string } {
    if (!this.login) throw new LoginUnavailableError();
    const state = randomBytes(32).toString("base64url");
    this.repo.saveLoginState(studentId, state, LOGIN_TTL, this.now());
    return { authorizeUrl: this.login.authorizeUrl(state), state };
  }

  /** Exchanges the code, checks the access token with one read, then stores both tokens sealed. */
  async finishLogin(studentId: string, code: string, state: string): Promise<void> {
    if (!this.login) throw new LoginUnavailableError();
    if (!this.repo.takeLoginState(studentId, state, this.now())) throw new LoginExpiredError();
    const tokens = await this.login.exchangeCode(code);
    try {
      await this.makeClient(this.login.canvasUrl, tokens.accessToken).listCourses();
    } catch (e) {
      await this.revokeQuietly(tokens.accessToken);
      throw e;
    }
    const key = this.opts.secretKey;
    const accessExpiresAt =
      tokens.expiresInSeconds == null ? null : new Date(this.now().getTime() + tokens.expiresInSeconds * 1000).toISOString();
    const previous = this.repo.getConnection(studentId);
    this.repo.saveConnection(
      studentId,
      this.login.canvasUrl,
      encrypt(tokens.accessToken, key),
      tokens.refreshToken ? { refreshSealed: encrypt(tokens.refreshToken, key), accessExpiresAt } : null,
    );
    if (previous && this.isRenewable(previous)) {
      await this.revokeQuietly(decrypt(previous.tokenSealed, key));
    }
  }

  private async revokeQuietly(accessToken: string): Promise<void> {
    try {
      await this.login!.revoke(accessToken);
    } catch {
      // Best effort.
    }
  }

  /** A login connection, still on the host that issued its tokens; only then may tokens be sent to Canvas. */
  private isRenewable(conn: StoredConnection): boolean {
    return (
      this.login != null &&
      conn.refreshSealed != null &&
      new URL(conn.baseUrl).origin === new URL(this.login.canvasUrl).origin
    );
  }

  /** Checks the token with one read before storing it, encrypted. */
  async connect(studentId: string, baseUrl: string, token: string): Promise<void> {
    const url = this.checkUrl(baseUrl);
    await this.makeClient(url, token).listCourses();
    this.repo.saveConnection(studentId, url, encrypt(token, this.opts.secretKey));
  }

  /**
   * Asks Canvas to revoke a login connection's token (best effort, any failure is
   * ignored), then deletes the connection. Pasted tokens are never revoked.
   */
  async disconnect(studentId: string): Promise<void> {
    const conn = this.repo.getConnection(studentId);
    if (conn && this.isRenewable(conn)) {
      try {
        const access = this.needsRenewal(conn)
          ? await this.renewAccess(studentId, conn)
          : decrypt(conn.tokenSealed, this.opts.secretKey);
        await this.login!.revoke(access);
      } catch {
        // Revoking is best effort; the connection is deleted regardless.
      }
    }
    this.repo.deleteConnection(studentId);
  }

  private needsRenewal(conn: StoredConnection): boolean {
    return (
      this.isRenewable(conn) &&
      conn.accessExpiresAt != null &&
      Date.parse(conn.accessExpiresAt) - this.now().getTime() <= RENEW_WITHIN
    );
  }

  /** Renews access with the stored refresh token and saves it. Refusal means the student must connect again. */
  private renewAccess(studentId: string, conn: StoredConnection): Promise<string> {
    const running = this.renewing.get(studentId);
    if (running) return running;
    const p = this.doRenew(studentId, conn).finally(() => this.renewing.delete(studentId));
    this.renewing.set(studentId, p);
    return p;
  }

  private async doRenew(studentId: string, conn: StoredConnection): Promise<string> {
    const key = this.opts.secretKey;
    let tokens;
    try {
      tokens = await this.login!.renew(decrypt(conn.refreshSealed!, key));
    } catch (e) {
      if (e instanceof CanvasLoginRefusedError) throw new CanvasAuthError();
      throw e;
    }
    const expiresAt =
      tokens.expiresInSeconds == null ? null : new Date(this.now().getTime() + tokens.expiresInSeconds * 1000).toISOString();
    this.repo.updateAccess(
      studentId,
      encrypt(tokens.accessToken, key),
      expiresAt,
      tokens.refreshToken ? encrypt(tokens.refreshToken, key) : undefined,
    );
    return tokens.accessToken;
  }

  /** Runs a Canvas read, renewing access first when it is about to expire, and once more after a 401. */
  private async withClient<T>(studentId: string, read: (client: CanvasClient) => Promise<T>): Promise<T> {
    const conn = this.repo.getConnection(studentId);
    if (!conn) throw new CanvasNotConnectedError();
    let renewed = false;
    let access = decrypt(conn.tokenSealed, this.opts.secretKey);
    if (this.needsRenewal(conn)) {
      access = await this.renewAccess(studentId, conn);
      renewed = true;
    }
    try {
      return await read(this.makeClient(conn.baseUrl, access));
    } catch (e) {
      if (!(e instanceof CanvasAuthError) || renewed || !this.isRenewable(conn)) throw e;
      access = await this.renewAccess(studentId, conn);
      return await read(this.makeClient(conn.baseUrl, access));
    }
  }

  /** Reads Canvas and returns items to confirm. Stores nothing in the schedule. */
  async preview(studentId: string): Promise<SyncPreview> {
    const now = this.now();
    const from = new Date(now.getTime() - DAY);
    const to = new Date(now.getTime() + 180 * DAY);
    const imported = this.schedule.importedCanvasIds(studentId);

    const { courses, items } = await this.withClient(studentId, (client) => this.readCanvas(client, imported, from, to));
    items.sort((x, y) => (x.dueAt ?? "9999").localeCompare(y.dueAt ?? "9999"));
    this.repo.markSynced(studentId, now);
    return this.repo.savePreview(studentId, { courses, items }, PREVIEW_TTL);
  }

  private async readCanvas(
    client: CanvasClient,
    imported: Set<string>,
    from: Date,
    to: Date,
  ): Promise<{ courses: ProposedCourse[]; items: ProposedItem[] }> {
    const canvasCourses = await client.listCourses();
    const courses: ProposedCourse[] = canvasCourses.map((c) => ({ externalId: c.id, name: c.name, code: c.courseCode }));
    const nameOf = new Map(courses.map((c) => [c.externalId, c.name]));
    const items: ProposedItem[] = [];

    for (const course of canvasCourses) {
      for (const a of await client.listAssignments(course.id)) {
        const kind: ItemKind = EXAM_WORDS.test(a.name) ? "exam" : "assignment";
        if (!keep(a.dueAt, kind, from)) continue;
        const externalId = `assignment:${a.id}`;
        items.push({
          key: externalId,
          externalId,
          courseExternalId: course.id,
          courseName: course.name,
          kind,
          title: a.name,
          dueAt: a.dueAt,
          endsAt: null,
          allDay: false,
          needsDate: kind === "exam" && !a.dueAt,
          alreadyImported: imported.has(externalId),
        });
      }
    }

    const events = await client.listCalendarEvents(canvasCourses.map((c) => c.id), from, to);
    for (const e of events) {
      const kind: ItemKind = EXAM_WORDS.test(e.title) ? "exam" : "event";
      if (!keep(e.startAt, kind, from)) continue;
      const externalId = `event:${e.id}`;
      items.push({
        key: externalId,
        externalId,
        courseExternalId: e.courseId,
        courseName: nameOf.get(e.courseId) ?? "Course",
        kind,
        title: e.title,
        dueAt: e.startAt,
        endsAt: e.endAt,
        allDay: e.allDay,
        needsDate: kind === "exam" && !e.startAt,
        alreadyImported: imported.has(externalId),
      });
    }

    return { courses, items };
  }

  /**
   * Stores the items the student accepted. `dates` lets the student fill in
   * a date Canvas did not give (for example an exam), keyed by item key.
   */
  confirm(studentId: string, syncId: string, acceptKeys: string[], dates: Record<string, string> = {}): number {
    const preview = this.repo.takePreview(studentId, syncId);
    if (!preview) throw new SyncExpiredError();
    const accepted = new Set(acceptKeys);
    const items = preview.items
      .filter((i) => accepted.has(i.key))
      .map((i) => ({
        externalId: i.externalId,
        courseExternalId: i.courseExternalId,
        kind: i.kind,
        title: i.title,
        dueAt: dates[i.key] ?? i.dueAt,
        endsAt: i.endsAt,
        allDay: i.allDay,
      }));
    const used = new Set(items.map((i) => i.courseExternalId));
    const courses = preview.courses.filter((c) => used.has(c.externalId));
    return this.schedule.importFromCanvas(studentId, { courses, items });
  }

  private checkUrl(raw: string): string {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      throw new InvalidCanvasUrlError("not a web address");
    }
    if (!this.opts.allowInsecureUrls) {
      if (url.protocol !== "https:") throw new InvalidCanvasUrlError("must start with https://");
      const host = url.hostname;
      if (host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":")) {
        throw new InvalidCanvasUrlError("must be your school's Canvas domain");
      }
    }
    return url.origin;
  }
}

/** Keeps dated work from `from` onward, and undated exams so the student can add the date. */
function keep(date: string | null, kind: ItemKind, from: Date): boolean {
  if (!date) return kind === "exam";
  return Date.parse(date) >= from.getTime();
}
