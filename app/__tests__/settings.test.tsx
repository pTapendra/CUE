import React from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import App from '../App';
import { ApiClient } from '../src/api/client';
import type { StudyBlock } from '../src/api/types';
import { deviceTimeZone } from '../src/timeZone';
import { lightColors } from '../src/ui/tokens';
import { studyTimesSummary } from '../src/viewmodels/useStudyTimes';
import { fakeServer, memoryStore } from '../test-support/fakeServer';
import { flush, isDisabled, onScreen, press, styleOf, tap, texts } from '../test-support/ui';

type Node = ReactTestRenderer.ReactTestInstance;

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

/** Opens Settings from the profile icon on Today. */
async function openSettings({ connected = true, loginAvailable = false, synced = true, linked = false, failLogout = false } = {}) {
  const server = fakeServer();
  server.state.linked = linked;
  server.state.connected = connected;
  server.state.loginAvailable = loginAvailable;
  server.state.blocks = [{ ...statsBlock }];
  server.state.lastSyncedAt = synced ? new Date(2026, 10, 2, 8, 48).toISOString() : null;
  const store = memoryStore();
  if (!connected) store.map.set('cue.skippedCanvas', '1');
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (failLogout && init?.method === 'DELETE' && new URL(url).pathname === '/api/device') {
      return new Response(JSON.stringify({ error: 'server_error', message: 'x' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    return server.fetchImpl(url, init);
  }) as unknown as typeof fetch;
  const client = new ApiClient('http://cue.test', store, fetchImpl);
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

  it('says Connected · read-only before the first sync', async () => {
    const { root } = await openSettings({ synced: false });
    expect(texts(root)).toContain('Connected · read-only');
    expect(texts(root).some((t) => t.includes('never'))).toBe(false);
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
    expect(shown).toContain(
      "Cue never asks who you are. When you log in with Canvas, Cue keeps a scrambled code for your Canvas account, so it can find your schedule again. It can't turn that code back into your name.",
    );
    expect(shown).toContain('encrypted on Cue');
    expect(shown).toContain('only reads Canvas');
    expect(shown).toContain('Delete all my data, in Settings, removes your account and everything Cue holds for you, on every phone.');
  });

  describe('Log out', () => {
    it('shows Log out only for an account linked to Canvas', async () => {
      const unlinked = await openSettings({ linked: false });
      expect(texts(unlinked.root)).not.toContain('Log out');
      await act(async () => {
        tree?.unmount();
      });
      const { root } = await openSettings({ linked: true });
      const all = texts(root);
      expect(all).toContain('Log out');
      expect(all.indexOf('Log out')).toBeGreaterThan(all.indexOf('Delete all my data'));
      expect(all.indexOf('Log out')).toBeLessThan(all.indexOf('About'));
    });

    it('asks first, then returns to Welcome with a new anonymous account', async () => {
      const { server, store, root } = await openSettings({ linked: true });
      store.map.set('cue.skippedCanvas', '1');
      await press(root, 'Log out');
      expect(alert).toHaveBeenCalledWith(
        'Log out of Cue?',
        'Your schedule and study plans stay saved. Log in with Canvas to get them back, on this phone or another.',
        [expect.objectContaining({ text: 'Log out' }), expect.objectContaining({ text: 'Cancel' })],
      );
      expect(calls(server, 'DELETE', '/api/device')).toHaveLength(0);

      await chooseInAlert('Log out');
      expect(calls(server, 'DELETE', '/api/device')).toHaveLength(1);
      expect(store.map.get('cue.deviceToken')).toBe('device-2');
      expect(store.map.has('cue.skippedCanvas')).toBe(false);
      expect(texts(root)).toContain(HEADLINE);
    });

    it('treats a 401 as logged out', async () => {
      const { server, store, root } = await openSettings({ linked: true });
      server.state.logoutUnauthorized = true;
      await press(root, 'Log out');
      await chooseInAlert('Log out');
      expect(store.map.get('cue.deviceToken')).toBe('device-2');
      expect(texts(root)).toContain(HEADLINE);
    });

    it('shows the error and stays when the server fails', async () => {
      const { store, root } = await openSettings({ linked: true, failLogout: true });
      await press(root, 'Log out');
      await chooseInAlert('Log out');
      expect(root.findAll((n) => n.props.accessibilityRole === 'alert').length).toBeGreaterThan(0);
      expect(texts(root)).toContain('Log out');
      expect(texts(root)).not.toContain(HEADLINE);
      expect(store.map.get('cue.deviceToken')).toBe('device-1');
      expect(isDisabled(root, 'Log out')).toBe(false);
    });

    it('Cancel keeps you logged in', async () => {
      const { server, store, root } = await openSettings({ linked: true });
      await press(root, 'Log out');
      await chooseInAlert('Cancel');
      expect(calls(server, 'DELETE', '/api/device')).toHaveLength(0);
      expect(store.map.get('cue.deviceToken')).toBe('device-1');
      expect(texts(root)).toContain('Log out');
    });
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

    it('always opens Check what Cue found, even with nothing new: skipped items are shown there', async () => {
      const { server, root } = await openSettings();
      server.state.preview.newItems = [];
      await press(root, 'Sync now');
      await flush();
      expect(texts(root)).toEqual(expect.arrayContaining(['Check what Cue found', 'Cue is up to date with Canvas.']));
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
        "Your schedule, courses and study plans are removed from Cue, on every phone. This can't be undone.",
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

  it('shows a failed load with Try again, which loads again so the student can save', async () => {
    const server = fakeServer();
    server.state.connected = true;
    let fail = false;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (fail && new URL(url).pathname === '/api/planner/settings') throw new TypeError('Network request failed');
      return server.fetchImpl(url, init);
    }) as unknown as typeof fetch;
    const client = new ApiClient('http://cue.test', memoryStore(), fetchImpl);
    await act(async () => {
      tree = ReactTestRenderer.create(<App client={client} />);
    });
    await flush();
    const root = tree!.root;
    await tap(root, 'Settings');
    await flush();
    fail = true;
    await press(root, 'Study times');
    await flush();

    const message = 'Cannot reach the Cue server. Check your connection and try again.';
    expect(texts(root)).toContain(message);
    expect(isDisabled(root, 'Save')).toBe(true);
    fail = false;
    await press(root, 'Try again');
    await flush();
    expect(texts(root)).not.toContain(message);
    expect(texts(root)).toContain('Daily limit');
    expect(isDisabled(root, 'Save')).toBe(false);

    // A failed save keeps the student's changes: no Try again, which would load over them.
    fail = true;
    await press(root, 'Save');
    await flush();
    expect(texts(root)).toContain(message);
    expect(texts(root)).not.toContain('Try again');
  });

  it("lets the day names grow with the phone's text size", async () => {
    const { root } = await openStudyTimes();
    const monday = root.find((n) => n.type === Text && n.props.children === 'Mon');
    const style = StyleSheet.flatten(monday.props.style);
    expect(style.width).toBeUndefined();
    expect(style.minWidth).toBeGreaterThan(0);
  });

  it('refuses to save a window shorter than an hour', async () => {
    const { root } = await openStudyTimes();
    await tap(root, 'Mon end');
    await act(async () => root.findAllByType('DateTimePicker' as never)[0].props.onChange({ type: 'set' }, new Date(2026, 10, 2, 18, 30)));
    expect(texts(root)).toContain('At least 1 hour');
    expect(root.find((n) => n.props.accessibilityLabel === 'Save' && n.props.accessibilityState).props.accessibilityState.disabled).toBe(true);
  });
});

describe('Safe areas', () => {
  // iOS doesn't report the status bar to SafeAreaView inside a full-screen modal, so pages pad
  // themselves from the insets the app measures at its root.
  const insets = useSafeAreaInsets as jest.Mock;
  const measured = insets.getMockImplementation();

  beforeEach(() => insets.mockImplementation(() => ({ top: 47, bottom: 34, left: 0, right: 0 })));
  afterEach(() => insets.mockImplementation(measured));

  /** The padding of the ancestor of `title` that keeps it below the status bar (none: zeros). */
  function pagePadding(title: string) {
    let node: ReactTestRenderer.ReactTestInstance | null = tree!.root.find(
      (n) => n.type === Text && n.props.accessibilityRole === 'header' && n.props.children === title,
    );
    while (node && StyleSheet.flatten(node.props.style)?.paddingTop !== 47) node = node.parent;
    const style = node ? StyleSheet.flatten(node.props.style) : {};
    return { top: style.paddingTop ?? 0, bottom: style.paddingBottom ?? 0 };
  }

  it('keeps Settings, a full-screen modal, below the status bar and above the home indicator', async () => {
    await openSettings();
    expect(pagePadding('Settings')).toEqual({ top: 47, bottom: 34 });
  });

  it('keeps the token form, a full-screen modal, below the status bar', async () => {
    await openSettings({ connected: false, loginAvailable: false });
    await tap(tree!.root, 'Connect Canvas');
    await flush();
    expect(pagePadding('Connect Canvas')).toEqual({ top: 47, bottom: 34 });
  });

  it('pads a tab page at the top but leaves the bottom to the tab bar', async () => {
    await openSettings();
    await tap(tree!.root, 'Done');
    await flush();
    expect(pagePadding('Today')).toEqual({ top: 47, bottom: 0 });
  });
});

describe('The profile icon', () => {
  const statistics = { id: 'c-stats', source: 'canvas' as const, name: 'Statistics', code: 'STAT' };

  /** The app on Today, connected, with one course. `failCourses` makes the course list fail from then on. */
  async function openApp() {
    const server = fakeServer();
    server.state.connected = true;
    server.state.lastSyncedAt = new Date(2026, 10, 2, 8, 48).toISOString();
    server.state.courses = [statistics];
    server.state.items = [
      {
        id: 'midterm',
        courseId: 'c-stats',
        courseName: 'Statistics',
        source: 'canvas',
        kind: 'exam',
        title: 'Stats midterm',
        dueAt: new Date(2026, 10, 5, 9, 0).toISOString(),
        endsAt: null,
        allDay: false,
        studyMinutes: null,
        status: 'not_started',
      },
    ];
    let coursesFail = false;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (coursesFail && new URL(url).pathname === '/api/courses') {
        return new Response(JSON.stringify({ error: 'server_error', message: 'x' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      return server.fetchImpl(url, init);
    }) as typeof fetch;
    const client = new ApiClient('http://cue.test', memoryStore(), fetchImpl);
    await act(async () => {
      tree = ReactTestRenderer.create(<App client={client} />);
    });
    await flush();
    return { root: tree!.root, failCourses: () => (coursesFail = true) };
  }

  const isSettings = (n: Node) => n.props.accessibilityLabel === 'Settings' && typeof n.props.onPress === 'function';
  const isBack = (n: Node) => n.props.accessibilityLabel === 'Back' && typeof n.props.onPress === 'function';
  const iconOf = (button: Node | undefined) => button?.findAll((n) => typeof n.props.name === 'string')[0]?.props.name;

  /** The icon of the Settings button on screen, if there is one. */
  const profileIcon = (root: Node): string | undefined => iconOf(onScreen(root, isSettings)[0]);

  /**
   * The Settings button on the same page as the Back button. The Courses page stays mounted under
   * a course's page and comes first in the tree, so its own button must not count.
   */
  function settingsBesideBack(root: Node): Node | undefined {
    let node: Node | null = onScreen(root, isBack)[0] ?? null;
    while (node) {
      const button = node.findAll(isSettings)[0];
      const coursesPage = node.findAll((n) => n.props.accessibilityRole === 'header' && texts(n).includes('Courses')).length > 0;
      if (button) return coursesPage ? undefined : button;
      node = node.parent;
    }
    return undefined;
  }

  it.each(['Today', 'Schedule', 'Courses'])('on %s opens Settings, and Done comes back', async (tab) => {
    const { root } = await openApp();
    await press(root, tab);
    await flush();
    expect(profileIcon(root)).toBe('person-circle-outline');

    await tap(root, 'Settings');
    await flush();
    expect(texts(root)).toEqual(expect.arrayContaining(['Settings', 'Done', 'Daily limit']));
    await tap(root, 'Done');
    await flush();
    expect(texts(root)).not.toContain('Daily limit');
  });

  it("on a course's page opens Settings, and Done comes back to the course", async () => {
    const { root } = await openApp();
    await press(root, 'Courses');
    await flush();
    await press(root, 'Statistics');
    await flush();
    expect(onScreen(root, isBack)).toHaveLength(1);
    const button = settingsBesideBack(root);
    expect(iconOf(button)).toBe('person-circle-outline');

    await act(async () => {
      await button!.props.onPress();
    });
    await flush();
    expect(texts(root)).toContain('Daily limit');
    await tap(root, 'Done');
    await flush();
    expect(texts(root)).not.toContain('Daily limit');
    expect(onScreen(root, isBack)).toHaveLength(1);
  });

  it("is on a course's page that failed to load", async () => {
    const { root, failCourses } = await openApp();
    await press(root, 'Courses');
    await flush();
    failCourses();
    await press(root, 'Statistics');
    await flush();
    expect(onScreen(root, isBack)).toHaveLength(1);
    expect(iconOf(settingsBesideBack(root))).toBe('person-circle-outline');
  });
});
