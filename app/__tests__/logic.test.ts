import { ApiClient, ApiError, friendlyMessage } from '../src/api/client';
import type { Item, StudyBlock, StudyWindow } from '../src/api/types';
import { serverUrl } from '../src/config';
import { fromInput, rangeLabel, startOfWeek, toInput } from '../src/dates';
import { deadlinesFor, gridRange, placeInDay, timedEventsFor } from '../src/viewmodels/grid';
import { canvasSettingsUrl, normalizeUrl } from '../src/viewmodels/useConnectCanvas';
import { withDeviceTimeZone } from '../src/timeZone';
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
  it('sends typed dates only for accepted items', () => {
    const dates = buildDates({ x: '2026-11-06 10:00', y: '2026-11-07 10:00', z: '' }, new Set(['x', 'z']));
    expect(Object.keys(dates)).toEqual(['x']);
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
    expect(friendlyMessage(err)).toMatch(/reconnect/);
    expect(friendlyMessage(new TypeError('Network request failed'))).toMatch(/Cannot reach/);
  });

  it('asks for a three-day week and reads its blocks', async () => {
    const server = fakeServer();
    const api = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);
    const week = await api.getWeek(new Date('2026-11-17T00:00:00.000Z'), 3);
    expect(server.state.calls.at(-1)!.path).toBe('/api/schedule/week');
    expect(week.blocks).toEqual([]);
    expect(Date.parse(week.to) - Date.parse(week.from)).toBe(3 * 864e5);
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

  it('labels a range of days', () => {
    expect(rangeLabel(new Date(2026, 10, 2), 3)).toBe('Mon 2 Nov – Wed 4 Nov');
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
