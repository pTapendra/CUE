import type {
  ConnectionStatus,
  Course,
  Item,
  ItemInput,
  ItemStatus,
  PlannerSettings,
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
        return 'Canvas rejected your token. Create a new one in Canvas and reconnect.';
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

  constructor(
    private readonly baseUrl: string,
    private readonly store: TokenStore,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Loads the device token, creating an anonymous account on first launch. */
  async ensureAccount(): Promise<void> {
    this.token = await this.store.getItem(TOKEN_KEY);
    if (this.token) return;
    const res = await this.raw('POST', '/api/devices', undefined, false);
    this.token = (res as { deviceToken: string }).deviceToken;
    await this.store.setItem(TOKEN_KEY, this.token);
  }

  getConnection() {
    return this.call<ConnectionStatus>('GET', '/api/canvas/connection');
  }

  connectCanvas(baseUrl: string, token: string) {
    return this.call<ConnectionStatus>('PUT', '/api/canvas/connection', { baseUrl, token });
  }

  disconnectCanvas() {
    return this.call<void>('DELETE', '/api/canvas/connection');
  }

  previewSync() {
    return this.call<SyncPreview>('POST', '/api/canvas/sync');
  }

  confirmSync(syncId: string, accept: string[], dates: Record<string, string>) {
    return this.call<{ imported: number }>('POST', '/api/canvas/sync/confirm', { syncId, accept, dates });
  }

  getWeek(from: Date, days?: number) {
    const range = days === undefined ? '' : `&days=${days}`;
    return this.call<Week>('GET', `/api/schedule/week?from=${encodeURIComponent(from.toISOString())}${range}`);
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
    try {
      return (await this.raw(method, path, body, true)) as T;
    } catch (err) {
      // The server no longer knows this device (for example, its database was reset):
      // start a fresh anonymous account once and retry.
      if (err instanceof ApiError && err.status === 401) {
        await this.store.removeItem(TOKEN_KEY);
        this.token = null;
        await this.ensureAccount();
        return (await this.raw(method, path, body, true)) as T;
      }
      throw err;
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
