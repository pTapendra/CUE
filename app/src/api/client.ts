import type {
  CanvasLoginStart,
  ConnectionStatus,
  Course,
  Item,
  ItemInput,
  ItemStatus,
  Overview,
  PlannerSettings,
  SyncCounts,
  SyncPreview,
  Week,
} from './types';

/** Where the app keeps its anonymous device token. */
export interface TokenStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const TOKEN_KEY = 'cue.deviceToken';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Messages a student can act on, keyed by the server's error codes. */
export function friendlyMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'canvas_token_rejected':
        return "Canvas no longer accepts Cue's access. Connect again.";
      case 'login_expired':
        return 'The login took too long. Please try again.';
      case 'canvas_login_failed':
        return "Canvas didn't complete the login. Please try again.";
      case 'canvas_not_connected':
        return 'Connect your Canvas account first.';
      case 'invalid_canvas_url':
        return err.message;
      case 'canvas_unavailable':
        return 'Canvas is not responding right now. Your saved schedule is still here.';
      case 'sync_expired':
        return 'That sync is out of date. Please sync again.';
      case 'block_move_invalid':
        return err.message;
      case 'invalid_request':
        return 'Some details are not valid. Please check and try again.';
      default:
        return err.message || 'Something went wrong.';
    }
  }
  return 'Cannot reach the Cue server. Check your connection and try again.';
}

/**
 * Talks to the Cue server's API layer. The app never talks to Canvas directly:
 * the Canvas token goes to the server once, and the server keeps it.
 */
export class ApiClient {
  private token: string | null = null;
  /**
   * Counts changes of the device token: a login adopting one, the phone forgetting its own, a new account.
   * Work that started before a change doesn't overwrite the token after it.
   */
  private generation = 0;
  /** The `ensureAccount` running now, shared by everyone who asks during the same generation. */
  private loading: { generation: number; done: Promise<void> } | null = null;

  constructor(
    private readonly baseUrl: string,
    /** Where the device token is kept; the app keeps its small preferences there too (see prefs.ts). */
    readonly store: TokenStore,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Loads the device token, creating an anonymous account on first launch. Callers at the same time share
   * one request. If the token changes meanwhile (a login adopted one), that token stays and the result is dropped.
   */
  ensureAccount(): Promise<void> {
    if (this.loading?.generation !== this.generation) {
      const generation = this.generation;
      const done = this.loadOrCreate(generation).finally(() => {
        if (this.loading?.done === done) this.loading = null;
      });
      this.loading = { generation, done };
    }
    return this.loading.done;
  }

  private async loadOrCreate(generation: number): Promise<void> {
    const stored = await this.store.getItem(TOKEN_KEY);
    if (this.generation !== generation) return;
    this.token = stored;
    if (stored) return;
    const res = await this.raw('POST', '/api/devices', undefined, false);
    if (this.generation !== generation) return;
    this.token = (res as { deviceToken: string }).deviceToken;
    this.generation++;
    await this.store.setItem(TOKEN_KEY, this.token);
  }

  getConnection() {
    return this.call<ConnectionStatus>('GET', '/api/canvas/connection');
  }

  async connectCanvas(baseUrl: string, token: string): Promise<ConnectionStatus & { switched: boolean }> {
    return this.adopt(await this.call<ConnectionStatus & { deviceToken?: string }>('PUT', '/api/canvas/connection', { baseUrl, token }));
  }

  startCanvasLogin() {
    return this.call<CanvasLoginStart>('POST', '/api/canvas/login');
  }

  async finishCanvasLogin(code: string, state: string): Promise<ConnectionStatus & { switched: boolean }> {
    return this.adopt(
      await this.call<ConnectionStatus & { deviceToken?: string }>('POST', '/api/canvas/login/finish', { code, state }),
    );
  }

  /** Stores the device token a reply carries (the phone switched accounts) and reports whether it did. */
  private async adopt(reply: ConnectionStatus & { deviceToken?: string }): Promise<ConnectionStatus & { switched: boolean }> {
    const { deviceToken, ...status } = reply;
    if (!deviceToken) return { ...status, switched: false };
    this.token = deviceToken;
    this.generation++;
    await this.store.setItem(TOKEN_KEY, deviceToken);
    return { ...status, switched: true };
  }

  /**
   * Log out: the server forgets this phone. A 401 means it already has. Either way the token is forgotten;
   * any other failure keeps it. It doesn't use `call`, whose 401 recovery would make a new account.
   */
  async logout(): Promise<void> {
    if (!this.token) await this.ensureAccount();
    try {
      await this.raw('DELETE', '/api/device', undefined, true);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) throw err;
    }
    await this.forgetDevice();
  }

  disconnectCanvas() {
    return this.call<void>('DELETE', '/api/canvas/connection');
  }

  previewSync() {
    return this.call<SyncPreview>('POST', '/api/canvas/sync');
  }

  confirmSync(syncId: string, accept: string[], dates: Record<string, string>) {
    return this.call<SyncCounts>('POST', '/api/canvas/sync/confirm', { syncId, accept, dates });
  }

  /** The schedule from `from` up to `to`. */
  getWeek(from: Date, to: Date) {
    const range = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
    return this.call<Week>('GET', `/api/schedule/week?${range}`);
  }

  /** Everything the overview screens show: about 30 days back to 200 days ahead, plus undated items. */
  getOverview() {
    return this.call<Overview>('GET', '/api/schedule/overview');
  }

  /** Deletes the account on the server, then forgets the device token. A failure keeps the token. */
  async deleteAccount(): Promise<void> {
    await this.call<void>('DELETE', '/api/account');
    await this.forgetDevice();
  }

  /** Forgets the stored device token, so the next `ensureAccount()` creates a new account. */
  async forgetDevice(): Promise<void> {
    this.token = null;
    this.generation++;
    await this.store.removeItem(TOKEN_KEY);
  }

  getPlannerSettings() {
    return this.call<PlannerSettings>('GET', '/api/planner/settings');
  }

  savePlannerSettings(settings: PlannerSettings & { timeZone: string }) {
    return this.call<PlannerSettings>('PUT', '/api/planner/settings', settings);
  }

  acceptBlock(id: string) {
    return this.call<void>('POST', `/api/blocks/${id}/accept`);
  }

  acceptBlocks(from: Date, to: Date) {
    return this.call<{ accepted: number }>('POST', '/api/blocks/accept', {
      from: from.toISOString(),
      to: to.toISOString(),
    });
  }

  rejectBlock(id: string) {
    return this.call<void>('POST', `/api/blocks/${id}/reject`);
  }

  moveBlock(id: string, startsAt: string) {
    return this.call<void>('POST', `/api/blocks/${id}/move`, { startsAt });
  }

  listCourses() {
    return this.call<{ courses: Course[] }>('GET', '/api/courses');
  }

  addItem(input: ItemInput) {
    return this.call<Item>('POST', '/api/items', input);
  }

  updateItem(id: string, input: Partial<ItemInput>) {
    return this.call<Item>('PATCH', `/api/items/${id}`, input);
  }

  setStatus(id: string, status: ItemStatus) {
    return this.call<Item>('PUT', `/api/items/${id}/status`, { status });
  }

  deleteItem(id: string) {
    return this.call<void>('DELETE', `/api/items/${id}`);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.token) await this.ensureAccount();
    const sentWith = this.token;
    try {
      return (await this.raw(method, path, body, true)) as T;
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) throw err;
      // The server no longer knows this device (for example, its database was reset): start a fresh
      // anonymous account once and retry. But if the token changed since this request was sent (a login
      // switched accounts, or another request already started over), retry with the current one instead.
      if (this.token === sentWith) await this.forgetDevice();
      // A login may adopt a token while the fresh account is made; ensureAccount then keeps that one.
      if (!this.token) await this.ensureAccount();
      return (await this.raw(method, path, body, true)) as T;
    }
  }

  private async raw(method: string, path: string, body: unknown, auth: boolean): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, data.error ?? 'error', data.message ?? `HTTP ${res.status}`);
    }
    return data;
  }
}
