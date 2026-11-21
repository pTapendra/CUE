import React from 'react';
import { AppState, StyleSheet, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import App from '../App';
import { ApiProvider } from '../src/api/ApiContext';
import { ApiClient } from '../src/api/client';
import type { Course, Item, StudyBlock } from '../src/api/types';
import type { TabParamList } from '../src/navigation/types';
import { ScheduleScreen } from '../src/screens/schedule/ScheduleScreen';
import { deviceTimeZone } from '../src/timeZone';
import { lightColors, lightCourses, lightUnknown } from '../src/ui/tokens';
import { HOUR_HEIGHT } from '../src/viewmodels/grid';
import { fakeServer, memoryStore } from '../test-support/fakeServer';
import { flush, onScreen, press, tap, texts, type } from '../test-support/ui';

jest.useFakeTimers({ now: new Date(2026, 10, 2, 9, 0), doNotFake: ['nextTick', 'setImmediate'] });

type Node = ReactTestRenderer.ReactTestInstance;
type Server = ReturnType<typeof fakeServer>;

const SKIP = 'Skip for now · add dates by hand';
const VIEWS = ['Day', '3 days', 'Week'];

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

function item(fields: Partial<Item> & Pick<Item, 'id' | 'title'>): Item {
  return {
    courseId: null,
    courseName: null,
    source: 'manual',
    kind: 'assignment',
    dueAt: null,
    endsAt: null,
    allDay: false,
    studyMinutes: null,
    status: 'not_started',
    ...fields,
  };
}

let tree: ReactTestRenderer.ReactTestRenderer | undefined;

async function render(element: React.ReactElement): Promise<Node> {
  await act(async () => {
    tree = ReactTestRenderer.create(element);
  });
  await flush();
  return tree!.root;
}

/** Opens the app on the Schedule tab, connected, with one suggested block and one shortfall. */
async function openSchedule(setup?: (server: Server) => void, wrap?: (fetchImpl: typeof fetch) => typeof fetch) {
  const server = fakeServer();
  server.state.connected = true;
  server.state.blocks = [{ ...statsBlock }];
  server.state.shortfalls = [
    {
      itemId: 'item-db',
      itemTitle: 'DB final',
      dueAt: new Date(2026, 10, 9, 9, 0).toISOString(),
      neededMinutes: 360,
      plannedMinutes: 300,
    },
  ];
  setup?.(server);
  const client = new ApiClient('http://cue.test', memoryStore(), wrap ? wrap(server.fetchImpl) : server.fetchImpl);
  const root = await render(<App client={client} />);
  await press(root, 'Schedule');
  await flush();
  return { server, root };
}

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  tree = undefined;
});

/** Local midnight at the start of a day in November 2026, as the server is sent it. */
const nov = (day: number) => new Date(2026, 10, day).toISOString();

/** The range of the latest week request. */
function lastRange(server: Server) {
  return server.state.calls.filter((c) => c.path === '/api/schedule/week').pop()!.query;
}

/** The days the grid shows, as a screen reader reads their headers. */
function dayHeaders(root: Node): string[] {
  const labels = onScreen(
    root,
    (n) => n.props.accessibilityRole === 'header' && typeof n.props.accessibilityLabel === 'string',
  ).map((n) => n.props.accessibilityLabel as string);
  return [...new Set(labels)];
}

/** The selected view in the segmented control. */
function selectedView(root: Node): string | undefined {
  return onScreen(
    root,
    (n) => n.props.accessibilityRole === 'tab' && n.props.accessibilityState?.selected && VIEWS.includes(n.props.accessibilityLabel),
  )[0]?.props.accessibilityLabel;
}

/** The style of the pressable whose accessibility label starts with `label`. */
function boxStyle(root: Node, label: string) {
  const box = onScreen(
    root,
    (n) => typeof n.props.onPress === 'function' && String(n.props.accessibilityLabel ?? '').startsWith(label),
  )[0];
  if (!box) throw new Error(`No box "${label}"`);
  return StyleSheet.flatten(box.props.style);
}

/** The style of the pressable that shows `text`. */
function pressableWith(root: Node, text: string) {
  const found = onScreen(
    root,
    (n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && texts(n).includes(text),
  )[0];
  if (!found) throw new Error(`No pressable with "${text}"`);
  return StyleSheet.flatten(found.props.style);
}

/** The colour of the text that reads exactly `text`. */
function textColor(root: Node, text: string) {
  const found = onScreen(root, (n) => n.type === Text).find((t) => texts(t).includes(text) && texts(t).length === 1);
  if (!found) throw new Error(`No text "${text}"`);
  return StyleSheet.flatten(found.props.style).color;
}

function nowLines(root: Node) {
  return onScreen(root, (n) => n.props.testID === 'now' && typeof n.type === 'string');
}

describe('the grid', () => {
  it('shows suggested blocks and shortfalls', async () => {
    const { root } = await openSchedule();

    const shown = texts(root);
    expect(shown).toContain('Stats midterm');
    expect(shown).toContain('1 of 6');
    expect(shown).toContain('1 suggested block');
    expect(shown).toContain('Accept all');
    expect(shown).toContain('DB final: 5 of 6 hours fit before Mon 9 Nov. Add study times or lower the hours.');
  });

  it('opens on today and the next two days under the month, and pages by three days', async () => {
    const { root } = await openSchedule((server) => {
      server.state.items = [
        item({ id: 'hw', title: 'SQL homework', dueAt: new Date(2026, 10, 3, 22, 0).toISOString() }),
        item({ id: 'mid', title: 'Midterm Exam', kind: 'exam', dueAt: new Date(2026, 10, 6, 10, 0).toISOString() }),
        item({ id: 'lab', title: 'Lab report' }),
      ];
    });

    const shown = texts(root);
    expect(shown).toContain('November');
    expect(shown).toContain('Mon 2 Nov – Wed 4 Nov');
    expect(dayHeaders(root)).toEqual(['Mon 2 Nov, today', 'Tue 3 Nov', 'Wed 4 Nov']);
    expect(shown).toContain('SQL homework');
    expect(shown).not.toContain('Exam: Midterm Exam');
    // Items without a date are listed on Today, not here.
    expect(shown).not.toContain('Needs a date');
    expect(shown).not.toContain('Lab report');

    await tap(root, 'Next days');
    await flush();
    expect(texts(root)).toContain('Thu 5 Nov – Sat 7 Nov');
    expect(dayHeaders(root)).toEqual(['Thu 5 Nov', 'Fri 6 Nov', 'Sat 7 Nov']);
    expect(texts(root)).toContain('Exam: Midterm Exam');

    await tap(root, 'Previous days');
    await flush();
    expect(texts(root)).toContain('Mon 2 Nov – Wed 4 Nov');
  });

  it('asks for the days on screen, up to midnight after the last one', async () => {
    const { server } = await openSchedule();

    // Local midnights, so a page over a clock change still ends where its last day ends.
    expect(lastRange(server)).toEqual({ from: nov(2), to: nov(5) });
  });

  it("keeps the page on screen when an earlier page's answer comes in late", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const { root } = await openSchedule(undefined, (fetchImpl) =>
      (async (url: string, init?: RequestInit) => {
        // The first page (with the suggestion on Tuesday) answers only when released.
        if (new URL(url).searchParams.get('from') === nov(2)) await held;
        return fetchImpl(url, init);
      }) as unknown as typeof fetch,
    );
    await tap(root, 'Next days');
    await flush();
    expect(texts(root)).toContain('Thu 5 Nov – Sat 7 Nov');

    await act(async () => release());
    await flush();
    expect(texts(root)).not.toContain('1 suggested block');
  });

  it('shows a failed load with Try again, which loads again', async () => {
    let fail = true;
    const { root } = await openSchedule(undefined, (fetchImpl) =>
      (async (url: string, init?: RequestInit) => {
        if (fail && new URL(url).pathname === '/api/schedule/week') throw new TypeError('Network request failed');
        return fetchImpl(url, init);
      }) as unknown as typeof fetch,
    );
    const message = 'Cannot reach the Cue server. Check your connection and try again.';
    expect(texts(root)).toContain(message);

    fail = false;
    await press(root, 'Try again');
    await flush();
    expect(texts(root)).not.toContain(message);
    expect(texts(root)).toContain('Stats midterm');
  });
});

describe('views', () => {
  it('Week asks for seven days from Monday, and pages by a week', async () => {
    const { server, root } = await openSchedule();
    expect(texts(root)).toEqual(expect.arrayContaining(VIEWS));
    expect(selectedView(root)).toBe('3 days');
    await tap(root, 'Next days'); // Thu 5 to Sat 7
    await flush();

    await tap(root, 'Week');
    await flush();
    expect(selectedView(root)).toBe('Week');
    expect(lastRange(server)).toEqual({ from: nov(2), to: nov(9) });
    expect(texts(root)).toContain('Mon 2 Nov – Sun 8 Nov');
    expect(dayHeaders(root)).toHaveLength(7);

    await tap(root, 'Next days');
    await flush();
    expect(lastRange(server)).toEqual({ from: nov(9), to: nov(16) });

    // Back over the clock change on Sunday 1 November (where there is one): still local midnights.
    await tap(root, 'Previous days');
    await flush();
    await tap(root, 'Previous days');
    await flush();
    expect(lastRange(server)).toEqual({ from: new Date(2026, 9, 26).toISOString(), to: nov(2) });
    expect(texts(root)).toContain('Oct – Nov');
  });

  it('Day asks for one day, and Today comes back to today', async () => {
    const { server, root } = await openSchedule();
    await tap(root, 'Next days'); // Thu 5 to Sat 7: today is not on screen
    await flush();

    await tap(root, 'Day');
    await flush();
    expect(lastRange(server)).toEqual({ from: nov(5), to: nov(6) });
    expect(texts(root)).toContain('Thu 5 Nov');
    await tap(root, 'Next days');
    await flush();
    expect(lastRange(server)).toEqual({ from: nov(6), to: nov(7) });

    await tap(root, 'Today');
    await flush();
    expect(lastRange(server)).toEqual({ from: nov(2), to: nov(3) });
    expect(dayHeaders(root)).toEqual(['Mon 2 Nov, today']);
  });

  it('on a Sunday night, Week shows the week that ends that day', async () => {
    jest.setSystemTime(new Date(2026, 10, 8, 23, 30));
    try {
      const { server, root } = await openSchedule();
      expect(lastRange(server)).toEqual({ from: nov(8), to: nov(11) });

      await tap(root, 'Week');
      await flush();
      expect(lastRange(server)).toEqual({ from: nov(2), to: nov(9) });
    } finally {
      jest.setSystemTime(new Date(2026, 10, 2, 9, 0));
    }
  });
});

describe('route params', () => {
  const Tab = createBottomTabNavigator<TabParamList>();
  const Blank = () => null;

  /** Schedule in a tab bar of its own, so the test can send it route params. */
  async function openWithParams(params?: TabParamList['Schedule']) {
    const server = fakeServer();
    server.state.connected = true;
    const client = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);
    const nav = createNavigationContainerRef<TabParamList>();
    const root = await render(
      <ApiProvider client={client}>
        <NavigationContainer ref={nav}>
          <Tab.Navigator initialRouteName="Schedule" screenOptions={{ headerShown: false }}>
            <Tab.Screen name="Today" component={Blank} />
            <Tab.Screen name="Schedule" component={ScheduleScreen as never} initialParams={params} />
          </Tab.Navigator>
        </NavigationContainer>
      </ApiProvider>,
    );
    return { server, root, nav };
  }

  it('open Day on the given date', async () => {
    const { server, root } = await openWithParams({ date: new Date(2026, 10, 12, 14, 0).toISOString(), view: 'day' });

    expect(selectedView(root)).toBe('Day');
    expect(dayHeaders(root)).toEqual(['Thu 12 Nov']);
    // The page in the params is the first one asked for.
    expect(server.state.calls.filter((c) => c.path === '/api/schedule/week').map((c) => c.query)).toEqual([
      { from: nov(12), to: nov(13) },
    ]);
  });

  it('open the day each time they are sent, also when Schedule is already open', async () => {
    const { server, root, nav } = await openWithParams();
    expect(selectedView(root)).toBe('3 days');

    for (let i = 0; i < 2; i++) {
      await tap(root, 'Week');
      await flush();
      expect(selectedView(root)).toBe('Week');
      await act(async () => nav.navigate('Today'));
      await act(async () => nav.navigate('Schedule', { date: '2026-11-04', view: 'day' }));
      await flush();

      expect(selectedView(root)).toBe('Day');
      expect(dayHeaders(root)).toEqual(['Wed 4 Nov']);
      expect(lastRange(server)).toEqual({ from: nov(4), to: nov(5) });
    }
  });
});

describe('accept all', () => {
  it('accepts all suggestions on screen', async () => {
    const { server, root } = await openSchedule();

    await press(root, 'Accept all');
    await flush();

    const accept = server.state.calls.find((c) => c.method === 'POST' && c.path === '/api/blocks/accept');
    expect(accept!.body).toEqual({ from: nov(2), to: nov(5) });
    // The page reloads: the block is accepted, so nothing is left to suggest.
    expect(texts(root)).toContain('Stats midterm');
    expect(texts(root)).not.toContain('1 suggested block');
    expect(texts(root)).not.toContain('Accept all');
  });

  it('in Week view, accepts the seven days on screen', async () => {
    const { server, root } = await openSchedule();
    await tap(root, 'Week');
    await flush();

    await press(root, 'Accept all');
    await flush();

    const accept = server.state.calls.find((c) => c.method === 'POST' && c.path === '/api/blocks/accept');
    expect(accept!.body).toEqual({ from: nov(2), to: nov(9) });
  });
});

describe('drawing', () => {
  const courses: Course[] = [
    { id: 'c-db', source: 'canvas', name: 'Databases', code: 'DB' },
    { id: 'c-stats', source: 'canvas', name: 'Statistics', code: 'STAT' },
  ];
  const [violet, teal] = lightCourses;

  it('draws study blocks in their course colours: accepted on the tint with an edge, suggested dashed', async () => {
    const { root } = await openSchedule((server) => {
      server.state.courses = courses;
      server.state.blocks.push({
        ...statsBlock,
        id: 'block-2',
        itemId: 'item-db',
        itemTitle: 'DB final',
        courseName: 'Databases',
        state: 'accepted',
        startsAt: new Date(2026, 10, 4, 19, 0).toISOString(),
        endsAt: new Date(2026, 10, 4, 20, 0).toISOString(),
      });
    });

    expect(boxStyle(root, 'Study: Stats midterm')).toMatchObject({ borderStyle: 'dashed', borderColor: teal.mark });
    const accepted = boxStyle(root, 'Study: DB final');
    expect(accepted).toMatchObject({ backgroundColor: violet.tint, borderLeftColor: violet.mark, borderLeftWidth: 3 });
    expect(accepted.borderStyle).not.toBe('dashed');
    // The course's darker text shade, which reads on its tint.
    expect(textColor(root, 'DB final')).toBe(violet.text);
    expect(textColor(root, 'Stats midterm')).toBe(teal.text);
  });

  it('puts deadlines in a lane in their course tint, grey without a course', async () => {
    const { root } = await openSchedule((server) => {
      server.state.courses = courses;
      server.state.items = [
        item({ id: 'hw', title: 'SQL homework', courseName: 'Databases', dueAt: new Date(2026, 10, 3, 22, 0).toISOString() }),
        item({ id: 'own', title: 'Own task', dueAt: new Date(2026, 10, 4, 12, 0).toISOString() }),
      ];
    });

    expect(pressableWith(root, 'SQL homework').backgroundColor).toBe(violet.tint);
    expect(textColor(root, 'SQL homework')).toBe(violet.text);
    expect(pressableWith(root, 'Own task').backgroundColor).toBe(lightUnknown.tint);
  });

  it('lets the last hours scroll clear of the + button', async () => {
    const { root } = await openSchedule();

    const add = boxStyle(root, 'Add');
    // The grid's scroll view is the one with pull to refresh.
    const grid = onScreen(root, (n) => n.props.refreshControl !== undefined && n.props.contentContainerStyle !== undefined)[0];
    const content = StyleSheet.flatten(grid.props.contentContainerStyle);
    expect(content.paddingBottom).toBeGreaterThanOrEqual(Number(add.height) + Number(add.bottom));
  });

  it('draws a red line at the current time, on today only', async () => {
    const { root } = await openSchedule((server) => {
      // An event from 08:00, so the grid starts at 08:00 and 09:00 is on it.
      server.state.items = [
        item({
          id: 'club',
          title: 'Club breakfast',
          kind: 'event',
          dueAt: new Date(2026, 10, 2, 8, 0).toISOString(),
          endsAt: new Date(2026, 10, 2, 8, 30).toISOString(),
        }),
      ];
    });

    const lines = nowLines(root);
    expect(lines).toHaveLength(1);
    expect(StyleSheet.flatten(lines[0].props.style)).toMatchObject({ top: HOUR_HEIGHT, backgroundColor: lightColors.now });

    await tap(root, 'Next days');
    await flush();
    expect(nowLines(root)).toHaveLength(0);
  });
});

describe('Sync', () => {
  const codeUrl = 'https://canvas.test/login/oauth2/auth?code=good-code&state=s1';

  /** Opens Schedule without Canvas, after skipping Welcome as a student who adds dates by hand does. */
  async function openUnconnected(loginAvailable: boolean) {
    const server = fakeServer();
    server.state.loginAvailable = loginAvailable;
    const root = await render(<App client={new ApiClient('http://cue.test', memoryStore(), server.fetchImpl)} />);
    await press(root, SKIP);
    await flush();
    await press(root, 'Schedule');
    await flush();
    return { server, root };
  }

  it('Sync opens Check what Cue found', async () => {
    const { root } = await openSchedule();
    expect(texts(root)).not.toContain('Connect Canvas');

    await press(root, 'Sync');
    await flush();
    expect(texts(root)).toContain('Check what Cue found');
  });

  it('without Canvas, the button reads Connect Canvas and starts the login, which leads to the review', async () => {
    const { root } = await openUnconnected(true);
    expect(texts(root)).not.toContain('Sync');

    await press(root, 'Connect Canvas');
    await flush();
    const web = root.findByType('WebView' as never);
    expect(web.props.source.uri).toBe('https://canvas.test/login/oauth2/auth?client_id=1&state=s1');
    await act(async () => {
      web.props.onShouldStartLoadWithRequest({ url: codeUrl });
    });
    await flush();
    expect(root.findAllByType('WebView' as never)).toHaveLength(0);
    expect(texts(root)).toContain('Check what Cue found');

    // Back on Schedule, which asks again whether Canvas is connected.
    await press(root, 'Cancel');
    await flush();
    expect(texts(root)).toContain('Sync');
    expect(texts(root)).not.toContain('Connect Canvas');
  });

  it('in token mode, Connect Canvas opens the token form', async () => {
    const { root } = await openUnconnected(false);

    await press(root, 'Connect Canvas');
    await flush();
    expect(onScreen(root, (n) => n.props.placeholder === 'Paste your token').length).toBeGreaterThan(0);
    await type(root, 'yourschool.instructure.com', 's.instructure.com');
    await type(root, 'Paste your token', 'good-token-123');
    await press(root, 'Connect and sync');
    await flush();
    expect(texts(root)).toContain('Check what Cue found');
  });
});

describe('time zone', () => {
  /** What React Native does when the student leaves the app and comes back to it. */
  async function leaveAndComeBack() {
    const listeners = (AppState.addEventListener as jest.Mock).mock.calls.filter(([event]) => event === 'change');
    const onChange = listeners.at(-1)![1];
    await act(async () => {
      onChange('background');
      onChange('active');
    });
    await flush();
  }

  it('sends a changed time zone when the app comes back to the front, then reloads the page', async () => {
    const { server } = await openSchedule();
    const weekLoads = () => server.state.calls.filter((c) => c.path === '/api/schedule/week').length;
    const zoneSaves = () => server.state.calls.filter((c) => c.method === 'PUT' && c.path === '/api/planner/settings');
    const loads = weekLoads();
    const saves = zoneSaves().length;

    await leaveAndComeBack();
    expect(zoneSaves()).toHaveLength(saves); // the server already has the phone's zone
    expect(weekLoads()).toBe(loads);

    server.state.settings.timeZone = 'Antarctica/Troll'; // saved before the phone moved
    await leaveAndComeBack();
    expect(zoneSaves()).toHaveLength(saves + 1);
    expect(zoneSaves().at(-1)!.body.timeZone).toBe(deviceTimeZone());
    expect(weekLoads()).toBe(loads + 1);

    const subscription = (AppState.addEventListener as jest.Mock).mock.results.at(-1)!.value;
    await act(async () => {
      tree!.unmount();
    });
    tree = undefined;
    expect(subscription.remove).toHaveBeenCalled();
  });
});
