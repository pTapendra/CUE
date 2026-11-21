import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { ApiClient } from '../src/api/client';
import type { StudyBlock } from '../src/api/types';
import { deviceTimeZone } from '../src/timeZone';
import { lightColors } from '../src/ui/tokens';
import { studyTimesSummary } from '../src/viewmodels/useStudyTimes';
import { fakeServer, memoryStore } from '../test-support/fakeServer';
import { flush, press, styleOf, tap, texts } from '../test-support/ui';

jest.useFakeTimers({ now: new Date(2026, 10, 2, 9, 0), doNotFake: ['nextTick', 'setImmediate'] });

let tree: ReactTestRenderer.ReactTestRenderer | undefined;
let alert: jest.SpyInstance;

beforeEach(() => {
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(async () => {
  alert.mockRestore();
  await act(async () => {
    tree?.unmount();
  });
  tree = undefined;
});

const statsBlock: StudyBlock = {
  id: 'block-1',
  itemId: 'item-stats',
  itemTitle: 'Stats midterm',
  itemKind: 'exam',
  courseName: 'Statistics',
  itemDueAt: new Date(2026, 10, 5, 9, 0).toISOString(),
  itemStudyMinutes: 360,
  startsAt: new Date(2026, 10, 3, 19, 0).toISOString(),
  endsAt: new Date(2026, 10, 3, 20, 0).toISOString(),
  state: 'proposed',
  index: 1,
  total: 6,
  clash: null,
};

const HEADLINE = 'Know what to study, and when.';

/** Opens Settings from the gear on Today. */
async function openSettings({ connected = true, loginAvailable = false } = {}) {
  const server = fakeServer();
  server.state.connected = connected;
  server.state.loginAvailable = loginAvailable;
  server.state.blocks = [{ ...statsBlock }];
  server.state.lastSyncedAt = new Date(2026, 10, 2, 8, 48).toISOString();
  const store = memoryStore();
  if (!connected) store.map.set('cue.skippedCanvas', '1');
  const client = new ApiClient('http://cue.test', store, server.fetchImpl);
  await act(async () => {
    tree = ReactTestRenderer.create(<App client={client} />);
  });
  await flush();
  await tap(tree!.root, 'Settings');
  await flush();
  return { server, store, root: tree!.root };
}

/** Presses a button of the alert that was just shown. */
async function chooseInAlert(label: string) {
  const buttons = alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  await act(async () => {
    await buttons.find((b) => b.text === label)!.onPress?.();
  });
  await flush();
}

const calls = (server: ReturnType<typeof fakeServer>, method: string, path: string) =>
  server.state.calls.filter((c) => c.method === method && c.path === path);

describe('studyTimesSummary', () => {
  const day = (weekday: number, start: string, end: string, enabled = true) => ({ weekday, enabled, start, end });
  const week = (f: (weekday: number) => ReturnType<typeof day>) => [0, 1, 2, 3, 4, 5, 6].map(f);

  it('says Weekdays when only Monday to Friday are on, with the same hours', () => {
    expect(studyTimesSummary(week((d) => (d >= 1 && d <= 5 ? day(d, '18:00', '22:00') : day(d, '10:00', '16:00', false))))).toBe(
      'Weekdays 18–22',
    );
  });

  it('says Every day when all seven are on with the same hours', () => {
    expect(studyTimesSummary(week((d) => day(d, '10:00', '16:00')))).toBe('Every day 10–16');
  });

  it('counts the days when they differ', () => {
    expect(studyTimesSummary(week((d) => (d >= 1 && d <= 5 ? day(d, '18:00', '22:00') : day(d, '10:00', '16:00'))))).toBe('7 days');
    expect(studyTimesSummary(week((d) => (d === 5 ? day(d, '18:00', '22:00', false) : day(d, '18:00', d === 2 ? '21:00' : '22:00', d >= 1 && d <= 5))))).toBe('4 days');
  });

  it('has words for one day, and for none', () => {
    expect(studyTimesSummary(week((d) => day(d, '18:00', '22:00', d === 3)))).toBe('1 day');
    expect(studyTimesSummary(week((d) => day(d, '18:00', '22:00', false)))).toBe('No studying');
  });

  it('shows minutes only when there are some', () => {
    expect(studyTimesSummary(week((d) => day(d, '09:30', '22:00')))).toBe('Every day 9:30–22');
  });
});

describe('Settings', () => {
  it('shows the Canvas connection, the study plan, privacy and the version', async () => {
    const { root } = await openSettings();
    expect(texts(root)).toEqual(
      expect.arrayContaining([
        'Settings',
        'Done',
        'Connected',
        'Synced 12 min ago · read-only',
        'Sync now',
        'Disconnect Canvas',
        'Study times',
        'Daily limit',
        '3 hours',
        'What Cue keeps',
        'Delete all my data',
      ]),
    );
  });

  it('shows the study times summary', async () => {
    const server = fakeServer();
    server.state.connected = true;
    server.state.settings.windows = server.state.settings.windows.map((w) => ({
      ...w,
      enabled: w.weekday >= 1 && w.weekday <= 5,
      start: '18:00',
      end: '22:00',
    }));
    const client = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);
    await act(async () => {
      tree = ReactTestRenderer.create(<App client={client} />);
    });
    await flush();
    await tap(tree!.root, 'Settings');
    await flush();
    expect(texts(tree!.root)).toContain('Weekdays 18–22');
  });

  it('its action rows darken while pressed, and ripple on Android', async () => {
    const { root } = await openSettings();
    for (const title of ['Sync now', 'Disconnect Canvas', 'Delete all my data']) {
      const action = root.find(
        (n) => typeof n.props.onPress === 'function' && typeof n.props.style === 'function' && texts(n).includes(title),
      );
      expect(styleOf(action, true).backgroundColor).toBe(lightColors.bg2);
      expect(styleOf(action).backgroundColor).not.toBe(lightColors.bg2);
      expect(action.props.android_ripple).toBeDefined();
    }
  });

  it('Done goes back to Today', async () => {
    const { root } = await openSettings();
    await press(root, 'Done');
    await flush();
    expect(texts(root)).not.toContain('Delete all my data');
    expect(texts(root)).toContain('Today');
  });

  it('What Cue keeps explains what is stored', async () => {
    const { root } = await openSettings();
    await press(root, 'What Cue keeps');
    await flush();
    const shown = texts(root).join(' ');
    expect(shown).toContain('No name or email');
    expect(shown).toContain('encrypted on Cue');
    expect(shown).toContain('only reads Canvas');
    expect(shown).toContain('Delete all my data');
  });

  describe('Disconnect Canvas', () => {
    it('asks first, then disconnects and shows Not connected', async () => {
      const { server, root } = await openSettings({ loginAvailable: true });
      await press(root, 'Disconnect Canvas');
      expect(alert).toHaveBeenCalledWith(
        'Disconnect Canvas?',
        expect.stringContaining('stay'),
        expect.arrayContaining([
          expect.objectContaining({ text: 'Disconnect', style: 'destructive' }),
          expect.objectContaining({ text: 'Cancel' }),
        ]),
      );
      expect(calls(server, 'DELETE', '/api/canvas/connection')).toHaveLength(0);

      await chooseInAlert('Disconnect');
      expect(calls(server, 'DELETE', '/api/canvas/connection')).toHaveLength(1);
      expect(texts(root)).toContain('Not connected');
      expect(texts(root)).toContain('Log in with Canvas');
      expect(texts(root)).not.toContain('Disconnect Canvas');
      expect(texts(root)).not.toContain('Sync now');
    });

    it('Cancel changes nothing', async () => {
      const { server, root } = await openSettings();
      await press(root, 'Disconnect Canvas');
      await chooseInAlert('Cancel');
      expect(calls(server, 'DELETE', '/api/canvas/connection')).toHaveLength(0);
      expect(texts(root)).toContain('Connected');
    });
  });

  describe('Sync now', () => {
    it('opens Check what Cue found when connected', async () => {
      const { root } = await openSettings();
      await press(root, 'Sync now');
      await flush();
      expect(texts(root)).toContain('Check what Cue found');
    });

    it('reads Log in with Canvas when not connected, and opens the login, not a sync', async () => {
      const { server, root } = await openSettings({ connected: false, loginAvailable: true });
      expect(texts(root)).toContain('Not connected');
      expect(texts(root)).not.toContain('Sync now');
      await press(root, 'Log in with Canvas');
      await flush();
      expect(root.findAllByType('WebView' as never)).toHaveLength(1);
      expect(calls(server, 'POST', '/api/canvas/sync')).toHaveLength(0);
    });

    it('reads Connect Canvas in token mode, and opens the token form', async () => {
      const { root } = await openSettings({ connected: false });
      expect(texts(root)).not.toContain('Log in with Canvas');
      await press(root, 'Connect Canvas');
      await flush();
      expect(root.findAll((n) => n.props.placeholder === 'Paste your token').length).toBeGreaterThan(0);
    });
  });

  it("after disconnecting in token mode, Connect Canvas opens the token form with the school's address", async () => {
    const { root } = await openSettings();
    await press(root, 'Disconnect Canvas');
    await chooseInAlert('Disconnect');
    await press(root, 'Connect Canvas');
    await flush();
    const address = root.find(
      (n) => n.props.placeholder === 'yourschool.instructure.com' && typeof n.props.onChangeText === 'function',
    );
    expect(address.props.value).toBe('https://s.instructure.com');
  });

  describe('Delete all my data', () => {
    it('asks first, then deletes, forgets the device and the onboarded flag, and returns to Welcome', async () => {
      const { server, store, root } = await openSettings();
      store.map.set('cue.skippedCanvas', '1');
      expect(store.map.get('cue.deviceToken')).toBe('device-1');
      await press(root, 'Delete all my data');
      expect(alert).toHaveBeenCalledWith(
        'Delete all your data?',
        expect.stringContaining("can't be undone"),
        expect.arrayContaining([
          expect.objectContaining({ text: 'Delete everything', style: 'destructive' }),
          expect.objectContaining({ text: 'Cancel' }),
        ]),
      );
      expect(calls(server, 'DELETE', '/api/account')).toHaveLength(0);

      await chooseInAlert('Delete everything');
      expect(calls(server, 'DELETE', '/api/account')).toHaveLength(1);
      expect(texts(root)).toContain(HEADLINE);
      expect(texts(root)).not.toContain('Delete all my data');
      expect(store.map.get('cue.deviceToken')).toBe('device-2'); // a new anonymous account, not the deleted one
      expect(store.map.has('cue.skippedCanvas')).toBe(false);
    });

    it("tells the new account the phone's time zone, so the planner can plan", async () => {
      const { server, root } = await openSettings();
      await press(root, 'Delete all my data');
      await chooseInAlert('Delete everything');
      await flush();

      const deleted = server.state.calls.findIndex((c) => c.method === 'DELETE' && c.path === '/api/account');
      const zone = server.state.calls.slice(deleted).find((c) => c.method === 'PUT' && c.path === '/api/planner/settings');
      expect(zone!.body.timeZone).toBe(deviceTimeZone());
      expect(zone!.auth).toBe('Bearer device-2');
      expect(texts(root)).toContain(HEADLINE);
    });

    it('returns to Welcome even when the new account cannot be made yet', async () => {
      const { server, store, root } = await openSettings();
      server.state.devicesFail = true;
      await press(root, 'Delete all my data');
      await chooseInAlert('Delete everything');

      expect(calls(server, 'POST', '/api/devices')).toHaveLength(2); // at start-up, and the try after deleting
      expect(store.map.has('cue.deviceToken')).toBe(false); // the next request tries again
      expect(texts(root)).toContain(HEADLINE);
    });

    it('shows an error and keeps everything when the server fails', async () => {
      const { server, store, root } = await openSettings();
      store.map.set('cue.skippedCanvas', '1');
      server.state.deleteFails = true;
      await press(root, 'Delete all my data');
      await chooseInAlert('Delete everything');

      expect(root.findAll((n) => n.props.accessibilityRole === 'alert').length).toBeGreaterThan(0);
      expect(texts(root)).toContain('Delete all my data'); // still in Settings
      expect(texts(root)).not.toContain(HEADLINE);
      expect(store.map.get('cue.deviceToken')).toBe('device-1');
      expect(store.map.get('cue.skippedCanvas')).toBe('1');
    });
  });
});

describe('Study times', () => {
  async function openStudyTimes() {
    const opened = await openSettings();
    await press(opened.root, 'Study times');
    await flush();
    return opened;
  }
  const lastPut = (server: ReturnType<typeof fakeServer>) => calls(server, 'PUT', '/api/planner/settings').pop()!;

  it("saves with the phone's current time zone", async () => {
    const { server, root } = await openSettings();
    server.state.settings.timeZone = 'Antarctica/Troll'; // saved before the phone moved
    await press(root, 'Study times');
    await flush();
    expect(texts(root)).toContain(`Time zone: ${deviceTimeZone()}`);
    await press(root, 'Save');
    await flush();

    expect(lastPut(server).body.timeZone).toBe(deviceTimeZone());
  });

  it('switches Friday off and saves, then goes back', async () => {
    const { server, root } = await openStudyTimes();
    expect(texts(root)).toContain('Daily limit');

    const friday = root.find((n) => n.props.accessibilityLabel === 'Fri on' && typeof n.props.onValueChange === 'function');
    await act(async () => {
      friday.props.onValueChange(false);
    });
    expect(texts(root)).toContain('No studying');
    await press(root, 'Save');
    await flush();

    expect(lastPut(server).body.windows.find((w: { weekday: number }) => w.weekday === 5).enabled).toBe(false);
    expect(texts(root)).not.toContain('Save');
    expect(texts(root)).toContain('Delete all my data'); // back on Settings
    await press(root, 'Done');
    await flush();
    expect(texts(root)).toContain('1 suggested study block'); // and on Today
  });

  it('saves a start time picked with the time picker as HH:MM', async () => {
    const { server, root } = await openStudyTimes();
    await tap(root, 'Mon start');
    await act(async () => root.findAllByType('DateTimePicker' as never)[0].props.onChange({ type: 'set' }, new Date(2026, 10, 2, 19, 30)));
    await press(root, 'Save');
    await flush();

    const monday = lastPut(server).body.windows.find((w: { weekday: number }) => w.weekday === 1);
    expect(monday).toMatchObject({ start: '19:30', end: '22:00' });
  });

  it('steps the daily limit and saves it', async () => {
    const { server, root } = await openStudyTimes();
    await tap(root, 'Daily limit, more');
    expect(texts(root)).toContain('4 hours');
    await press(root, 'Save');
    await flush();
    expect(lastPut(server).body.dailyLimitMinutes).toBe(240);
  });

  it('refuses to save a window shorter than an hour', async () => {
    const { root } = await openStudyTimes();
    await tap(root, 'Mon end');
    await act(async () => root.findAllByType('DateTimePicker' as never)[0].props.onChange({ type: 'set' }, new Date(2026, 10, 2, 18, 30)));
    expect(texts(root)).toContain('At least 1 hour');
    expect(root.find((n) => n.props.accessibilityLabel === 'Save' && n.props.accessibilityState).props.accessibilityState.disabled).toBe(true);
  });
});
