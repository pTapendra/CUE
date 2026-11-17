import { ApiClient, ApiError, friendlyMessage } from '../src/api/client';
import type { Item } from '../src/api/types';
import { serverUrl } from '../src/config';
import { addDays, fromInput, startOfWeek, toInput } from '../src/dates';
import { canvasSettingsUrl, normalizeUrl } from '../src/viewmodels/useConnectCanvas';
import { buildDates } from '../src/viewmodels/useSyncReview';
import { groupByDay } from '../src/viewmodels/useWeek';
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
  const item = (id: string, dueAt: string | null): Item => ({
    id, dueAt, courseId: null, courseName: null, source: 'manual', kind: 'assignment', title: id, status: 'not_started',
  });

  it('groups a week into seven days and keeps empty days', () => {
    const from = new Date(2026, 10, 2);
    const days = groupByDay([item('a', new Date(2026, 10, 3, 9).toISOString()), item('b', new Date(2026, 10, 8, 23).toISOString())], from);
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.items.map((i) => i.id))).toEqual([[], ['a'], [], [], [], [], ['b']]);
    expect(days[6].date.getTime()).toBe(addDays(from, 6).getTime());
  });

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
