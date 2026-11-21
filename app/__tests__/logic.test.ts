import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ApiProvider } from '../src/api/ApiContext';
import { loginUserAgent, readLoginReturn } from '../src/viewmodels/canvasLogin';
import { useCanvasLogin } from '../src/viewmodels/useCanvasLogin';
import { ApiClient, ApiError, friendlyMessage } from '../src/api/client';
import type { Item, StudyBlock, StudyWindow } from '../src/api/types';
import { serverUrl } from '../src/config';
import { fromInput, monthTitle, parseDay, rangeLabel, startOfWeek, toInput } from '../src/dates';
import { deadlinesFor, gridRange, placeInDay, timedEventsFor } from '../src/viewmodels/grid';
import { canvasSettingsUrl, normalizeUrl } from '../src/viewmodels/useConnectCanvas';
import { pageStart } from '../src/viewmodels/useSchedule';
import { syncTimeZone, withDeviceTimeZone } from '../src/timeZone';
import { buildDates } from '../src/viewmodels/useSyncReview';
import { rangeText, windowError } from '../src/viewmodels/useStudyTimes';
import { fakeServer, memoryStore } from '../test-support/fakeServer';

describe('dates', () => {
  it('starts the week on Monday', () => {
    const wed = new Date(2026, 10, 4, 15, 30); // Wed 4 Nov 2026
    const mon = startOfWeek(wed);
    expect([mon.getFullYear(), mon.getMonth(), mon.getDate(), mon.getHours()]).toEqual([2026, 10, 2, 0]);
    expect(startOfWeek(new Date(2026, 10, 8)).getDate()).toBe(2); // Sunday belongs to the same week
  });

  it('round-trips the date field', () => {
    const iso = fromInput('2026-11-06 14:05')!;
    expect(toInput(iso)).toBe('2026-11-06 14:05');
    expect(toInput(fromInput('2026-11-06')!)).toBe('2026-11-06 23:59');
  });

  it('rejects impossible or badly formed dates', () => {
    expect(fromInput('')).toBeNull();
    expect(fromInput('2026-02-30')).toBeUndefined();
    expect(fromInput('2026-11-06 25:00')).toBeUndefined();
    expect(fromInput('next friday')).toBeUndefined();
  });
});

describe('view model helpers', () => {
  it('sends picked dates only for accepted items, and none that were cleared', () => {
    const dates = buildDates(
      { x: '2026-11-06T10:00:00.000Z', y: '2026-11-07T10:00:00.000Z', z: null },
      new Set(['x', 'z']),
    );
    expect(dates).toEqual({ x: '2026-11-06T10:00:00.000Z' });
  });

  it('adds https:// to a bare Canvas address', () => {
    expect(normalizeUrl(' school.instructure.com ')).toBe('https://school.instructure.com');
    expect(normalizeUrl('https://school.instructure.com')).toBe('https://school.instructure.com');
  });
});

describe('canvasSettingsUrl', () => {
  it('points a bare Canvas address at the page where tokens are made', () => {
    expect(canvasSettingsUrl(' school.instructure.com ')).toBe('https://school.instructure.com/profile/settings');
  });

  it('keeps only the host of a pasted Canvas link', () => {
    expect(canvasSettingsUrl('https://school.instructure.com/courses/42?x=1')).toBe(
      'https://school.instructure.com/profile/settings',
    );
  });

  it('gives no link until a usable address is typed', () => {
    expect(canvasSettingsUrl('')).toBeNull();
    expect(canvasSettingsUrl('   ')).toBeNull();
    expect(canvasSettingsUrl('my school')).toBeNull();
  });
});

describe('ApiClient', () => {
  it('creates an anonymous account once and sends its token', async () => {
    const server = fakeServer();
    const store = memoryStore();
    const api = new ApiClient('http://cue.test', store, server.fetchImpl);
    await api.getConnection();
    await api.getConnection();
    expect(server.state.calls.filter((c) => c.path === '/api/devices')).toHaveLength(1);
    expect(store.map.get('cue.deviceToken')).toBe('device-1');
    expect(server.state.calls.at(-1)!.auth).toBe('Bearer device-1');
  });

  it('turns server errors into messages a student can act on', async () => {
    const server = fakeServer();
    const api = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);
    const err = await api.connectCanvas('https://s.instructure.com', 'bad-token-123').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(friendlyMessage(err)).toBe("Canvas no longer accepts Cue's access. Connect again.");
    expect(friendlyMessage(new TypeError('Network request failed'))).toMatch(/Cannot reach/);
  });

  it('asks for the schedule between two instants and reads its blocks', async () => {
    const server = fakeServer();
    const api = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);
    const week = await api.getWeek(new Date('2026-11-17T06:00:00.000Z'), new Date('2026-11-20T06:00:00.000Z'));
    expect(server.state.calls.at(-1)).toMatchObject({
      path: '/api/schedule/week',
      query: { from: '2026-11-17T06:00:00.000Z', to: '2026-11-20T06:00:00.000Z' },
    });
    expect(week.blocks).toEqual([]);
    expect(week.to).toBe('2026-11-20T06:00:00.000Z');
  });

  it('getOverview calls GET /api/schedule/overview', async () => {
    const server = fakeServer();
    const api = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);
    const overview = await api.getOverview();
    expect(server.state.calls.at(-1)).toMatchObject({ method: 'GET', path: '/api/schedule/overview' });
    expect(overview).toEqual({ items: [], undated: [], blocks: [], shortfalls: [] });
  });

  it('deleteAccount forgets the device token only after the server agrees', async () => {
    const server = fakeServer();
    const store = memoryStore();
    const api = new ApiClient('http://cue.test', store, server.fetchImpl);
    await api.getConnection();
    expect(store.map.get('cue.deviceToken')).toBe('device-1');

    server.state.deleteFails = true;
    await expect(api.deleteAccount()).rejects.toBeInstanceOf(ApiError);
    expect(store.map.get('cue.deviceToken')).toBe('device-1');

    const offline = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const lost = new ApiClient('http://cue.test', store, offline);
    await expect(lost.deleteAccount()).rejects.toBeInstanceOf(TypeError);
    expect(store.map.get('cue.deviceToken')).toBe('device-1');

    server.state.deleteFails = false;
    await api.deleteAccount();
    expect(server.state.calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/api/account' });
    expect(store.map.has('cue.deviceToken')).toBe(false);
    await api.ensureAccount();
    expect(server.state.calls.filter((c) => c.path === '/api/devices')).toHaveLength(2);
  });

  it('forgetDevice removes the stored device token', async () => {
    const server = fakeServer();
    const store = memoryStore();
    const api = new ApiClient('http://cue.test', store, server.fetchImpl);
    await api.getConnection();
    await api.forgetDevice();
    expect(store.map.has('cue.deviceToken')).toBe(false);
  });

  it('explains a refused move', () => {
    expect(friendlyMessage(new ApiError(409, 'block_move_invalid', 'Pick a time before the deadline.'))).toBe(
      'Pick a time before the deadline.',
    );
  });
});

describe('serverUrl', () => {
  it('uses the computer that serves the app in Expo Go', () => {
    expect(serverUrl(undefined, '192.168.1.20:8081')).toBe('http://192.168.1.20:3000');
  });

  it('lets an environment variable override it', () => {
    expect(serverUrl('https://cue.example.edu/', '192.168.1.20:8081')).toBe('https://cue.example.edu');
  });

  it('falls back to localhost', () => {
    expect(serverUrl(undefined, undefined)).toBe('http://localhost:3000');
  });
});

describe('withDeviceTimeZone', () => {
  const base = { timeZone: null as string | null, dailyLimitMinutes: 180, windows: [] };

  it('returns null when the zone already matches', () => {
    expect(withDeviceTimeZone({ ...base, timeZone: 'Europe/Oslo' }, 'Europe/Oslo')).toBeNull();
  });

  it('returns a copy with the zone when it differs or is null', () => {
    const input = { ...base, timeZone: 'Europe/Oslo' };
    expect(withDeviceTimeZone(input, 'Asia/Dhaka')).toEqual({ ...input, timeZone: 'Asia/Dhaka' });
    expect(input.timeZone).toBe('Europe/Oslo');
    expect(withDeviceTimeZone(base, 'Asia/Dhaka')).toEqual({ ...base, timeZone: 'Asia/Dhaka' });
  });
});

describe('syncTimeZone', () => {
  it("saves the phone's zone only when the server has another, and says whether it did", async () => {
    const server = fakeServer();
    server.state.settings.timeZone = 'Europe/Oslo';
    const api = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);

    expect(await syncTimeZone(api, 'Europe/Oslo')).toBe(false);
    expect(server.state.calls.filter((c) => c.method === 'PUT')).toEqual([]);

    expect(await syncTimeZone(api, 'Asia/Dhaka')).toBe(true);
    expect(server.state.settings.timeZone).toBe('Asia/Dhaka');
  });

  it('gives up quietly when the settings cannot be read', async () => {
    const offline = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const api = new ApiClient('http://cue.test', memoryStore(), offline);
    await expect(syncTimeZone(api, 'Asia/Dhaka')).resolves.toBe(false);
  });
});

describe('grid layout', () => {
  const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();
  const entry = (sd: number, sh: number, ed: number, eh: number) => ({ startsAt: at(sd, sh), endsAt: at(ed, eh) });
  const item = (over: Partial<Item>): Item => ({
    id: 'i', courseId: null, courseName: null, source: 'manual', kind: 'event', title: 't',
    dueAt: null, endsAt: null, allDay: false, studyMinutes: null, status: 'not_started', ...over,
  });
  const win = (weekday: number, start: string, end: string, enabled = true): StudyWindow => ({ weekday, enabled, start, end });

  it('places a block by its local hour', () => {
    const [p] = placeInDay(new Date(2026, 10, 2), [entry(2, 19, 2, 20)], { startHour: 18, endHour: 22 });
    expect([p.top, p.height]).toEqual([50, 50]);
  });

  it('clips an entry that crosses midnight to each day', () => {
    const e = entry(2, 23, 3, 1);
    const range = { startHour: 0, endHour: 24 };
    const mon = placeInDay(new Date(2026, 10, 2), [e], range);
    const tue = placeInDay(new Date(2026, 10, 3), [e], range);
    expect([mon[0].top, mon[0].height]).toEqual([23 * 50, 50]);
    expect([tue[0].top, tue[0].height]).toEqual([0, 50]);
    expect(placeInDay(new Date(2026, 10, 4), [e], range)).toEqual([]);
    expect(placeInDay(new Date(2026, 10, 2), [e], { startHour: 8, endHour: 22 })).toEqual([]);
  });

  it('covers the study times of the visible days', () => {
    const days = [new Date(2026, 10, 2), new Date(2026, 10, 3)]; // Mon, Tue
    const windows = [win(1, '18:00', '22:00'), win(2, '17:30', '21:00'), win(3, '06:00', '07:00'), win(0, '10:00', '16:00', false)];
    expect(gridRange(days, windows, [], [])).toEqual({ startHour: 17, endHour: 22 });
    const block = { startsAt: at(3, 9), endsAt: at(3, 10, 15) } as StudyBlock;
    expect(gridRange(days, windows, [block], [])).toEqual({ startHour: 9, endHour: 22 });
    expect(gridRange(days, [], [], [])).toEqual({ startHour: 8, endHour: 22 });
    // overnight window: Mon 22:00-02:00 covers Mon to 24 and Tue from 0
    expect(gridRange([days[0]], [win(1, '22:00', '02:00')], [], [])).toEqual({ startHour: 22, endHour: 24 });
    expect(gridRange([days[1]], [win(1, '22:00', '02:00')], [], [])).toEqual({ startHour: 0, endHour: 2 });
  });

  it('puts all-day events and deadlines in the deadline row and timed events in the grid', () => {
    const day = new Date(2026, 10, 2);
    const items = [
      item({ id: 'a', kind: 'assignment', dueAt: at(2, 23) }),
      item({ id: 'x', kind: 'exam', dueAt: at(2, 9) }),
      item({ id: 'd', kind: 'event', allDay: true, dueAt: at(2, 0) }),
      item({ id: 't', kind: 'event', dueAt: at(2, 14), endsAt: at(2, 15, 30) }),
      item({ id: 'u', kind: 'event', dueAt: at(2, 16) }),
      item({ id: 'o', kind: 'exam', dueAt: at(3, 9) }),
    ];
    expect(deadlinesFor(day, items).map((i) => i.id)).toEqual(['d', 'x', 'a']);
    const timed = timedEventsFor(day, items);
    expect(timed.map((e) => e.item.id)).toEqual(['t', 'u']);
    expect(timed[1].endsAt).toBe(at(2, 17));
  });

  it('shows an event whose end is not after its start as one hour', () => {
    const day = new Date(2026, 10, 2);
    const timed = timedEventsFor(day, [
      item({ id: 'same', dueAt: at(2, 14), endsAt: at(2, 14) }),
      item({ id: 'before', dueAt: at(2, 16), endsAt: at(2, 15) }),
    ]);
    expect(timed.map((e) => e.endsAt)).toEqual([at(2, 15), at(2, 17)]);
    expect(placeInDay(day, timed, { startHour: 8, endHour: 22 }).map((p) => p.height)).toEqual([50, 50]);
  });

  it('labels a range of days, and a single day', () => {
    expect(rangeLabel(new Date(2026, 10, 2), 3)).toBe('Mon 2 Nov – Wed 4 Nov');
    expect(rangeLabel(new Date(2026, 10, 2), 1)).toBe('Mon 2 Nov');
  });

  it('titles a page by its month, naming the year only when it is not this year', () => {
    const now = new Date(2026, 10, 2, 9, 0);
    expect(monthTitle(new Date(2026, 10, 2), new Date(2026, 10, 8), now)).toBe('November');
    expect(monthTitle(new Date(2026, 9, 26), new Date(2026, 10, 1), now)).toBe('Oct – Nov');
    expect(monthTitle(new Date(2027, 0, 4), new Date(2027, 0, 10), now)).toBe('January 2027');
    expect(monthTitle(new Date(2026, 11, 28), new Date(2027, 0, 3), now)).toBe('Dec 2026 – Jan 2027');
  });

  it("reads a route's date as a local day", () => {
    const wed = new Date(2026, 10, 4);
    expect(parseDay('2026-11-04')).toEqual(wed); // a date alone is a local date, not UTC midnight
    expect(parseDay(new Date(2026, 10, 4, 23, 30).toISOString())).toEqual(wed);
    expect(parseDay('next friday')).toBeNull();
    expect(parseDay('2026-02-30')).toBeNull();
    expect(parseDay(undefined)).toBeNull();
  });

  it('starts a week page on Monday and other pages on the day, at local midnight', () => {
    const sundayNight = new Date(2026, 10, 8, 23, 30);
    expect(pageStart('week', sundayNight)).toEqual(new Date(2026, 10, 2));
    expect(pageStart('week', new Date(2026, 10, 2, 0, 0))).toEqual(new Date(2026, 10, 2));
    expect(pageStart('3days', sundayNight)).toEqual(new Date(2026, 10, 8));
    expect(pageStart('day', sundayNight)).toEqual(new Date(2026, 10, 8));
    // The week with the clock change (Sunday 1 November in North America) still starts at midnight.
    expect(pageStart('week', new Date(2026, 10, 1, 12, 0))).toEqual(new Date(2026, 9, 26));
  });
});

describe('study windows', () => {
  const win = (start: string, end: string): StudyWindow => ({ weekday: 1, enabled: true, start, end });

  it('accepts valid ranges, including one that ends the next day', () => {
    expect(windowError(win('18:00', '22:00'))).toBeNull();
    expect(windowError(win('22:00', '01:00'))).toBeNull();
    expect(windowError(win('08:00', '20:00'))).toBeNull();
  });

  it('rejects a bad format', () => {
    for (const bad of ['6pm', '25:00', '18:60', '', '1800']) {
      expect(windowError(win(bad, '22:00'))).toBe('Use the form 18:00');
      expect(windowError(win('18:00', bad))).toBe('Use the form 18:00');
    }
  });

  it('rejects less than 1 hour', () => {
    expect(windowError(win('18:00', '18:59'))).toBe('At least 1 hour');
    expect(windowError(win('23:30', '00:15'))).toBe('At least 1 hour');
    expect(windowError(win('18:00', '19:00'))).toBeNull();
    expect(windowError(win('23:30', '00:30'))).toBeNull();
  });

  it('rejects equal start and end, and more than 12 hours', () => {
    expect(windowError(win('18:00', '18:00'))).toBe("Start and end can't be the same");
    expect(windowError(win('08:00', '20:01'))).toBe('At most 12 hours');
    expect(windowError(win('22:00', '11:00'))).toBe('At most 12 hours');
    expect(windowError(win('22:00', '10:00'))).toBeNull();
  });

  it('describes the range', () => {
    expect(rangeText(win('18:00', '22:00'))).toBe('18:00 – 22:00');
    expect(rangeText(win('22:00', '01:00'))).toBe('22:00 – 01:00 (next day)');
  });
});

describe('Canvas login', () => {
  const A = 'https://canvas.test/login/oauth2/auth?client_id=1&state=s1';

  it("readLoginReturn lets Canvas's own pages load", () => {
    expect(readLoginReturn(A, A, 's1')).toBeNull();
    expect(readLoginReturn('https://canvas.test/login/canvas', A, 's1')).toBeNull();
    expect(readLoginReturn('https://canvas.test/login/oauth2/confirm', A, 's1')).toBeNull();
  });

  it('readLoginReturn catches the code', () => {
    expect(readLoginReturn('https://canvas.test/login/oauth2/auth?code=c1&state=s1', A, 's1')).toEqual({
      kind: 'code',
      code: 'c1',
    });
  });

  it('readLoginReturn: denied, wrong state, other site', () => {
    expect(readLoginReturn('https://canvas.test/login/oauth2/auth?error=access_denied&state=s1', A, 's1')).toEqual({
      kind: 'denied',
    });
    expect(readLoginReturn('https://canvas.test/login/oauth2/auth?code=c1&state=zz', A, 's1')).toEqual({
      kind: 'mismatch',
    });
    expect(readLoginReturn('https://evil.test/login/oauth2/auth?code=c1&state=s1', A, 's1')).toBeNull();
  });

  it('readLoginReturn: only access_denied is denied, other errors failed', () => {
    expect(readLoginReturn('https://canvas.test/login/oauth2/auth?error=invalid_scope&state=s1', A, 's1')).toEqual({
      kind: 'failed',
    });
  });

  it('readLoginReturn compares the host, so an http return address still counts', () => {
    expect(readLoginReturn('http://canvas.test/login/oauth2/auth?code=c1&state=s1', A, 's1')).toEqual({
      kind: 'code',
      code: 'c1',
    });
    expect(readLoginReturn('http://evil.test/login/oauth2/auth?code=c1&state=s1', A, 's1')).toBeNull();
    expect(readLoginReturn('http://canvas.test/login/oauth2/auth?code=c1&state=zz', A, 's1')).toEqual({
      kind: 'mismatch',
    });
  });

  it('friendly messages for the login errors', () => {
    expect(friendlyMessage(new ApiError(409, 'canvas_token_rejected', 'x'))).toBe(
      "Canvas no longer accepts Cue's access. Connect again.",
    );
    expect(friendlyMessage(new ApiError(409, 'login_expired', 'x'))).toBe('The login took too long. Please try again.');
    expect(friendlyMessage(new ApiError(409, 'canvas_login_failed', 'x'))).toBe(
      "Canvas didn't complete the login. Please try again.",
    );
  });

  it('asks the server to start and finish a login', async () => {
    const server = fakeServer();
    const api = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);
    expect(await api.startCanvasLogin()).toEqual({ authorizeUrl: A, state: 's1' });
    expect((await api.finishCanvasLogin('good-code', 's1')).connected).toBe(true);
    const err = await api.finishCanvasLogin('bad', 's1').catch((e) => e);
    expect(err).toMatchObject({ status: 409, code: 'canvas_login_failed' });
  });

  async function mount(onConnected: () => void) {
    const server = fakeServer();
    const api = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);
    let current!: ReturnType<typeof useCanvasLogin>;
    function Probe() {
      current = useCanvasLogin(onConnected);
      return null;
    }
    await act(async () => {
      ReactTestRenderer.create(React.createElement(ApiProvider, { client: api, children: React.createElement(Probe) }));
    });
    return { server, hook: () => current };
  }

  const back = (code: string, state = 's1') => `https://canvas.test/login/oauth2/auth?code=${code}&state=${state}`;

  it('finishes once even when the return address is reported repeatedly', async () => {
    const onConnected = jest.fn();
    const { server, hook } = await mount(onConnected);
    await act(async () => hook().start());
    expect(hook().authorizeUrl).toBe(A);
    expect(hook().onNavigate(A)).toBe(true);
    let results: boolean[] = [];
    await act(async () => {
      results = [hook().onNavigate(back('good-code')), hook().onNavigate(back('good-code'))];
    });
    expect(results).toEqual([false, false]);
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(server.state.calls.filter((c) => c.path === '/api/canvas/login/finish')).toHaveLength(1);
    expect(hook().authorizeUrl).toBeNull();
    expect(hook().error).toBeNull();
    expect(hook().busy).toBe(false);
  });

  it('closes with a message when denied, mismatched or refused, and quietly on cancel', async () => {
    const onConnected = jest.fn();
    const { hook } = await mount(onConnected);
    await act(async () => hook().start());
    await act(async () => {
      hook().onNavigate('https://canvas.test/login/oauth2/auth?error=access_denied&state=s1');
    });
    expect(hook().authorizeUrl).toBeNull();
    expect(hook().error).toBe("You didn't allow Cue to read Canvas.");

    await act(async () => hook().start());
    expect(hook().error).toBeNull();
    await act(async () => {
      hook().onNavigate(back('c1', 'zz'));
    });
    expect(hook().error).toBe("The login didn't complete. Please try again.");

    await act(async () => hook().start());
    await act(async () => {
      hook().onNavigate(back('nope'));
    });
    expect(hook().authorizeUrl).toBeNull();
    expect(hook().error).toBe("Canvas didn't complete the login. Please try again.");

    await act(async () => hook().start());
    await act(async () => {
      hook().onNavigate('https://canvas.test/login/oauth2/auth?error=invalid_scope&state=s1');
    });
    expect(hook().authorizeUrl).toBeNull();
    expect(hook().error).toBe("Canvas didn't complete the login. Please try again.");

    await act(async () => hook().start());
    act(() => hook().cancel());
    expect(hook().authorizeUrl).toBeNull();
    expect(hook().error).toBeNull();
    expect(onConnected).not.toHaveBeenCalled();
  });
});

describe('loginUserAgent', () => {
  const ngrok = 'https://demo.ngrok-free.dev/login/oauth2/auth?client_id=1&state=s1';

  it('gives ngrok addresses a Cue user agent, so ngrok skips its warning page', () => {
    expect(loginUserAgent(ngrok, 'ios')).toBe(
      'CueApp/0.1 (iPhone; CPU iPhone OS like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    );
    expect(loginUserAgent(ngrok, 'android')).toBe('CueApp/0.1 (Linux; Android) AppleWebKit/537.36 (KHTML, like Gecko) Mobile');
    expect(loginUserAgent('https://x.ngrok-free.app/login/oauth2/auth', 'ios')).toMatch(/^CueApp\//);
    expect(loginUserAgent('https://x.ngrok.io/login/oauth2/auth', 'ios')).toMatch(/^CueApp\//);
  });

  it('leaves every other address with the default user agent', () => {
    expect(loginUserAgent('https://canvas.test/login/oauth2/auth', 'ios')).toBeUndefined();
    expect(loginUserAgent('https://school.instructure.com/login/oauth2/auth', 'android')).toBeUndefined();
    expect(loginUserAgent('https://ngrok-free.dev.evil.test/login/oauth2/auth', 'ios')).toBeUndefined();
    expect(loginUserAgent('not a url', 'ios')).toBeUndefined();
  });
});
