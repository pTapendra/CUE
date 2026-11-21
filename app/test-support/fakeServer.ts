import type { Item, PlannerSettings, Shortfall, StudyBlock } from '../src/api/types';

type Handler = (body: any, url: URL) => { status: number; body?: unknown };

/** A tiny in-memory stand-in for the Cue server, answering through `fetch`. */
export function fakeServer() {
  let nextId = 1;
  const state = {
    connected: false,
    loginAvailable: false,
    /** The Canvas address the login screen opens. */
    loginUrl: 'https://canvas.test',
    /** When set, the next syncs fail with this error (a successful login clears it). */
    /** When set, DELETE /api/account fails with a 500. */
    deleteFails: false,
    syncError: null as { status: number; error: string } | null,
    items: [] as Item[],
    blocks: [] as StudyBlock[],
    shortfalls: [] as Shortfall[],
    settings: {
      timeZone: null,
      dailyLimitMinutes: 180,
      windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        enabled: true,
        start: weekday >= 1 && weekday <= 5 ? '18:00' : '10:00',
        end: weekday >= 1 && weekday <= 5 ? '22:00' : '16:00',
      })),
    } as PlannerSettings,
    preview: {
      syncId: '11111111-1111-4111-8111-111111111111',
      items: [
        { key: 'assignment:1', courseName: 'Databases', kind: 'assignment', title: 'SQL homework', dueAt: '2026-11-03T22:00:00.000Z', needsDate: false, alreadyImported: false },
        { key: 'assignment:2', courseName: 'Software Engineering', kind: 'exam', title: 'Midterm Exam', dueAt: null, needsDate: true, alreadyImported: false },
      ],
    },
    calls: [] as { method: string; path: string; query: Record<string, string>; body: any; auth: string | null }[],
  };

  const routes: Record<string, Handler> = {
    'POST /api/devices': () => ({ status: 201, body: { deviceToken: 'device-1' } }),
    'GET /api/canvas/connection': () => ({
      status: 200,
      body: { connected: state.connected, baseUrl: state.connected ? 'https://s.instructure.com' : null, lastSyncedAt: null, loginAvailable: state.loginAvailable },
    }),
    'PUT /api/canvas/connection': (b) => {
      if (b.token === 'bad-token-123') return { status: 409, body: { error: 'canvas_token_rejected', message: 'x' } };
      state.connected = true;
      return { status: 200, body: { connected: true, baseUrl: b.baseUrl, lastSyncedAt: null, loginAvailable: state.loginAvailable } };
    },
    'POST /api/canvas/login': () => ({
      status: 200,
      body: { authorizeUrl: `${state.loginUrl}/login/oauth2/auth?client_id=1&state=s1`, state: 's1' },
    }),
    'POST /api/canvas/login/finish': (b) => {
      if (b.code !== 'good-code') return { status: 409, body: { error: 'canvas_login_failed', message: 'x' } };
      state.connected = true;
      state.syncError = null;
      return {
        status: 200,
        body: { connected: true, baseUrl: 'https://s.instructure.com', lastSyncedAt: null, loginAvailable: state.loginAvailable },
      };
    },
    'POST /api/canvas/sync': () =>
      state.syncError
        ? { status: state.syncError.status, body: { error: state.syncError.error, message: 'x' } }
        : { status: 200, body: state.preview },
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
          endsAt: null,
          allDay: false,
          studyMinutes: p.kind === 'exam' ? 360 : p.kind === 'assignment' ? 120 : null,
          status: 'not_started',
        });
      }
      return { status: 200, body: { imported: b.accept.length } };
    },
    'GET /api/schedule/week': (_b, url) => {
      const from = Date.parse(url.searchParams.get('from')!);
      const until = url.searchParams.get('to');
      const to = until ? Date.parse(until) : from + Number(url.searchParams.get('days') ?? 7) * 864e5;
      return {
        status: 200,
        body: {
          from: new Date(from).toISOString(),
          to: new Date(to).toISOString(),
          items: state.items.filter((i) => i.dueAt && Date.parse(i.dueAt) >= from && Date.parse(i.dueAt) < to),
          undated: state.items.filter((i) => !i.dueAt),
          blocks: state.blocks.filter((k) => Date.parse(k.startsAt) < to && Date.parse(k.endsAt) > from),
          shortfalls: state.shortfalls,
        },
      };
    },
    'GET /api/schedule/overview': () => ({
      status: 200,
      body: { items: state.items.filter((i) => i.dueAt), undated: state.items.filter((i) => !i.dueAt), blocks: state.blocks, shortfalls: state.shortfalls },
    }),
    'DELETE /api/account': () => {
      if (state.deleteFails) return { status: 500, body: { error: 'server_error', message: 'x' } };
      state.connected = false;
      state.items = [];
      return { status: 204 };
    },
    'GET /api/planner/settings': () => ({ status: 200, body: state.settings }),
    'PUT /api/planner/settings': (b) => {
      state.settings = b;
      return { status: 200, body: state.settings };
    },
    'POST /api/blocks/accept': (b) => {
      const from = Date.parse(b.from);
      const to = Date.parse(b.to);
      const due = state.blocks.filter((k) => k.state === 'proposed' && Date.parse(k.startsAt) >= from && Date.parse(k.startsAt) < to);
      for (const k of due) k.state = 'accepted';
      return { status: 200, body: { accepted: due.length } };
    },
    'GET /api/courses': () => ({ status: 200, body: { courses: [] } }),
    'POST /api/items': (b) => {
      const item: Item = {
        id: String(nextId++),
        courseId: null,
        courseName: null,
        source: 'manual',
        status: 'not_started',
        endsAt: null,
        allDay: false,
        studyMinutes: b.kind === 'exam' ? 360 : b.kind === 'assignment' ? 120 : null,
        ...b,
      };
      state.items.push(item);
      return { status: 201, body: item };
    },
  };

  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization ?? null;
    state.calls.push({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, auth });

    const status = /^\/api\/items\/([^/]+)\/status$/.exec(url.pathname);
    const block = /^\/api\/blocks\/([^/]+)\/(accept|reject|move)$/.exec(url.pathname);
    const patch = /^\/api\/items\/([^/]+)$/.exec(url.pathname);
    let result: { status: number; body?: unknown };
    if (method === 'POST' && block) {
      const found = state.blocks.find((k) => k.id === block[1]);
      if (!found) {
        result = { status: 404, body: { error: 'not_found', message: 'nope' } };
      } else {
        if (block[2] === 'accept') found.state = 'accepted';
        else if (block[2] === 'reject') state.blocks.splice(state.blocks.indexOf(found), 1);
        else {
          const length = Date.parse(found.endsAt) - Date.parse(found.startsAt);
          found.startsAt = body.startsAt;
          found.endsAt = new Date(Date.parse(body.startsAt) + length).toISOString();
          found.state = 'accepted';
        }
        result = { status: 204 };
      }
    } else if (method === 'PATCH' && patch) {
      const item = state.items.find((i) => i.id === patch[1]);
      if (item) Object.assign(item, body);
      // Like the real server, the change re-plans: the item's suggestions come back with new ids.
      for (const k of state.blocks.filter((b) => b.itemId === patch[1])) {
        if (body.studyMinutes !== undefined) k.itemStudyMinutes = body.studyMinutes;
        if (k.state === 'proposed') k.id = `block-${nextId++}`;
      }
      result = { status: 200, body: item ?? { id: patch[1], ...body } };
    } else if (method === 'PUT' && status) {
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
