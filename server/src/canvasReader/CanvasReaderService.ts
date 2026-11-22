import { randomBytes } from "node:crypto";
import type { AccountService, CurrentDevice } from "../accounts/AccountService.js";
import { CanvasAuthError, type CanvasClient, type CanvasClientFactory, type CanvasEvent } from "../canvas/CanvasClient.js";
import { CanvasLoginRefusedError, type CanvasLogin } from "../canvas/CanvasLogin.js";
import { decrypt, encrypt } from "../crypto.js";
import type { CanvasSyncCounts, ScheduleService } from "../schedule/ScheduleService.js";
import type { CanvasReaderRepository, StoredConnection } from "./CanvasReaderRepository.js";
import { diffCanvas } from "./diff.js";
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
  /** A Canvas login (or pasted token) decides which account the phone uses. */
  accounts: AccountService;
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
      linked: this.opts.accounts.isLinked(studentId),
    };
  }

  /** Starts a login: a single-use state, kept in the database, and Canvas's authorize address. */
  startLogin(studentId: string): { authorizeUrl: string; state: string } {
    if (!this.login) throw new LoginUnavailableError();
    const state = randomBytes(32).toString("base64url");
    this.repo.saveLoginState(studentId, state, LOGIN_TTL, this.now());
    return { authorizeUrl: this.login.authorizeUrl(state), state };
  }

  /**
   * Exchanges the code and checks the access token with one read, then puts the phone on the
   * Canvas user's account and stores both tokens sealed there. `deviceToken` is set when the
   * phone switched accounts.
   */
  async finishLogin(
    current: CurrentDevice,
    code: string,
    state: string,
  ): Promise<{ studentId: string; deviceToken: string | null }> {
    if (!this.login) throw new LoginUnavailableError();
    if (!this.repo.takeLoginState(current.studentId, state, this.now())) throw new LoginExpiredError();
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
    try {
      return this.linkAndSave(
        current,
        { canvasUrl: this.login.canvasUrl, userId: tokens.userId },
        encrypt(tokens.accessToken, key),
        tokens.refreshToken ? { refreshSealed: encrypt(tokens.refreshToken, key), accessExpiresAt } : null,
      );
    } catch (e) {
      // Nothing was saved (the transaction rolled back), so Cue won't use this grant.
      await this.revokeQuietly(tokens.accessToken);
      throw e;
    }
  }

  /**
   * Every Canvas request is done by now. Links the phone to the Canvas user's account and saves
   * the connection there in one transaction, and returns as soon as it commits. Nothing after the
   * commit throws or waits: the login connections Cue no longer uses (the one replaced, and the one
   * of the phone's old account if it was deleted) are revoked best effort, without waiting for Canvas.
   */
  private linkAndSave(
    current: CurrentDevice,
    identity: { canvasUrl: string; userId: string },
    tokenSealed: string,
    renewal: { refreshSealed: string; accessExpiresAt: string | null } | null,
  ): { studentId: string; deviceToken: string | null } {
    const ownConnection = this.repo.getConnection(current.studentId);
    let replaced = null as StoredConnection | null;
    const result = this.opts.accounts.link(current, identity, (target) => {
      replaced = this.repo.getConnection(target);
      this.repo.saveConnection(target, identity.canvasUrl, tokenSealed, renewal);
    });

    if (replaced && this.isRenewable(replaced)) void this.revokeStored(replaced);
    if (result.removedStudentId === current.studentId && ownConnection && this.isRenewable(ownConnection)) {
      void this.revokeStored(ownConnection);
    }
    if (result.movedItems > 0) this.schedule.markChanged(result.studentId);
    return { studentId: result.studentId, deviceToken: result.deviceToken };
  }

  private async revokeQuietly(accessToken: string): Promise<void> {
    try {
      await this.login!.revoke(accessToken);
    } catch {
      // Best effort.
    }
  }

  /** Revokes a stored connection's access token; never throws, so the caller need not wait for it. */
  private async revokeStored(conn: StoredConnection): Promise<void> {
    try {
      await this.login!.revoke(decrypt(conn.tokenSealed, this.opts.secretKey));
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

  /**
   * Checks the token with one read and asks Canvas who it belongs to, then links the phone
   * as a login does and stores the token, encrypted, on the resulting account.
   */
  async connect(
    current: CurrentDevice,
    baseUrl: string,
    token: string,
  ): Promise<{ studentId: string; deviceToken: string | null }> {
    const url = this.checkUrl(baseUrl);
    const client = this.makeClient(url, token);
    await client.listCourses();
    const { id } = await client.whoAmI();
    return this.linkAndSave(current, { canvasUrl: url, userId: id }, encrypt(token, this.opts.secretKey), null);
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

  /**
   * Reads Canvas and returns what's new, changed, removed and skipped against what the student
   * saved. Stores nothing in the schedule.
   */
  async preview(studentId: string): Promise<SyncPreview> {
    const now = this.now();
    const from = new Date(now.getTime() - DAY);
    const to = new Date(now.getTime() + 180 * DAY);
    const saved = this.schedule.savedCanvasItems(studentId);
    const skippedIds = this.repo.skippedIds(studentId);

    const { courses, groups } = await this.withClient(studentId, async (client) => {
      const read = { ...(await this.readCanvas(client, from, to)), from, to };
      let groups = diffCanvas(read, saved, skippedIds);
      // Canvas only lists events within the dates read: ask for each missing one before calling it removed.
      const unsure = new Set<string>();
      let found = false;
      for (const gone of groups.removed.filter((r) => r.key.startsWith("event:"))) {
        try {
          const event = await client.getCalendarEvent(gone.key.slice("event:".length));
          if (event) {
            read.items.push(this.proposeEvent(event, read.courses));
            found = true;
          }
        } catch {
          unsure.add(gone.key);
        }
      }
      if (found || unsure.size > 0) groups = diffCanvas(read, saved, skippedIds, unsure);
      return { courses: read.courses, groups };
    });
    this.repo.markSynced(studentId, now);
    return this.repo.savePreview(studentId, { courses, ...groups }, PREVIEW_TTL);
  }

  /** Every course and assignment, and the events from `from` to `to`, before `keep`. */
  private async readCanvas(client: CanvasClient, from: Date, to: Date): Promise<{ courses: ProposedCourse[]; items: ProposedItem[] }> {
    const canvasCourses = await client.listCourses();
    const courses: ProposedCourse[] = canvasCourses.map((c) => ({ externalId: c.id, name: c.name, code: c.courseCode }));
    const items: ProposedItem[] = [];

    for (const course of canvasCourses) {
      for (const a of await client.listAssignments(course.id)) {
        const kind: ItemKind = EXAM_WORDS.test(a.name) ? "exam" : "assignment";
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
        });
      }
    }

    for (const e of await client.listCalendarEvents(canvasCourses.map((c) => c.id), from, to)) {
      items.push(this.proposeEvent(e, courses));
    }
    return { courses, items };
  }

  private proposeEvent(e: CanvasEvent, courses: ProposedCourse[]): ProposedItem {
    const kind: ItemKind = EXAM_WORDS.test(e.title) ? "exam" : "event";
    const externalId = `event:${e.id}`;
    return {
      key: externalId,
      externalId,
      courseExternalId: e.courseId,
      courseName: courses.find((c) => c.externalId === e.courseId)?.name ?? "Course",
      kind,
      title: e.title,
      dueAt: e.startAt,
      endsAt: e.endAt,
      allDay: e.allDay,
      needsDate: kind === "exam" && !e.startAt,
    };
  }

  /**
   * Saves a sync: adds the new and skipped items the student accepted (`dates` fills in a date
   * Canvas did not give, keyed by item key), gives changed items Canvas's values, deletes the
   * items gone from Canvas, and remembers the new items left unticked as skipped.
   */
  confirm(studentId: string, syncId: string, acceptKeys: string[], dates: Record<string, string> = {}): CanvasSyncCounts {
    const preview = this.repo.takePreview(studentId, syncId);
    if (!preview) throw new SyncExpiredError();
    const accepted = new Set(acceptKeys);
    const add = [...preview.newItems, ...preview.skipped]
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
    const skip = preview.newItems.filter((i) => !accepted.has(i.key)).map((i) => i.key);
    const unskip = preview.skipped.filter((i) => accepted.has(i.key)).map((i) => i.key);
    return this.schedule.applyCanvasSync(
      studentId,
      {
        courses: preview.courses,
        add,
        update: preview.changed.map((c) => ({ itemId: c.itemId, title: c.title, dueAt: c.dueAt, endsAt: c.endsAt, allDay: c.allDay })),
        remove: preview.removed.map((r) => r.itemId),
      },
      () => this.repo.setSkipped(studentId, skip, unskip),
    );
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
