import type { Item } from '../src/api/types';

type Handler = (body: any, url: URL) => { status: number; body?: unknown };

/** A tiny in-memory stand-in for the Cue server, answering through `fetch`. */
export function fakeServer() {
  let nextId = 1;
  const state = {
    connected: false,
    items: [] as Item[],
    preview: {
      syncId: '11111111-1111-4111-8111-111111111111',
      items: [
        { key: 'assignment:1', courseName: 'Databases', kind: 'assignment', title: 'SQL homework', dueAt: '2026-11-03T22:00:00.000Z', needsDate: false, alreadyImported: false },
        { key: 'assignment:2', courseName: 'Software Engineering', kind: 'exam', title: 'Midterm Exam', dueAt: null, needsDate: true, alreadyImported: false },
      ],
    },
    calls: [] as { method: string; path: string; body: any; auth: string | null }[],
  };

  const routes: Record<string, Handler> = {
    'POST /api/devices': () => ({ status: 201, body: { deviceToken: 'device-1' } }),
    'GET /api/canvas/connection': () => ({
      status: 200,
      body: { connected: state.connected, baseUrl: state.connected ? 'https://s.instructure.com' : null, lastSyncedAt: null },
    }),
    'PUT /api/canvas/connection': (b) => {
      if (b.token === 'bad-token-123') return { status: 409, body: { error: 'canvas_token_rejected', message: 'x' } };
      state.connected = true;
      return { status: 200, body: { connected: true, baseUrl: b.baseUrl, lastSyncedAt: null } };
    },
    'POST /api/canvas/sync': () => ({ status: 200, body: state.preview }),
    'POST /api/canvas/sync/confirm': (b) => {
      for (const p of state.preview.items.filter((i) => b.accept.includes(i.key))) {
        state.items.push({
          id: String(nextId++),
          courseId: null,
          courseName: p.courseName,
          source: 'canvas',
          kind: p.kind as Item['kind'],
          title: p.title,
          dueAt: b.dates?.[p.key] ?? p.dueAt,
          status: 'not_started',
        });
      }
      return { status: 200, body: { imported: b.accept.length } };
    },
    'GET /api/schedule/week': (_b, url) => {
      const from = Date.parse(url.searchParams.get('from')!);
      const to = from + 7 * 864e5;
      return {
        status: 200,
        body: {
          from: new Date(from).toISOString(),
          to: new Date(to).toISOString(),
          items: state.items.filter((i) => i.dueAt && Date.parse(i.dueAt) >= from && Date.parse(i.dueAt) < to),
          undated: state.items.filter((i) => !i.dueAt),
        },
      };
    },
    'GET /api/courses': () => ({ status: 200, body: { courses: [] } }),
    'POST /api/items': (b) => {
      const item: Item = { id: String(nextId++), courseId: null, courseName: null, source: 'manual', status: 'not_started', ...b };
      state.items.push(item);
      return { status: 201, body: item };
    },
  };

  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization ?? null;
    state.calls.push({ method, path: url.pathname, body, auth });

    const status = /^\/api\/items\/([^/]+)\/status$/.exec(url.pathname);
    let result: { status: number; body?: unknown };
    if (method === 'PUT' && status) {
      const item = state.items.find((i) => i.id === status[1])!;
      item.status = body.status;
      result = { status: 200, body: item };
    } else {
      const handler = routes[`${method} ${url.pathname}`];
      result = handler ? handler(body, url) : { status: 404, body: { error: 'not_found', message: 'nope' } };
    }
    return {
      ok: result.status < 400,
      status: result.status,
      json: async () => result.body,
    } as Response;
  }) as unknown as typeof fetch;

  return { state, fetchImpl };
}

export function memoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => void map.set(k, v),
    removeItem: async (k: string) => void map.delete(k),
  };
}
