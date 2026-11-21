import React from 'react';
import { ActivityIndicator, AppState, StyleSheet } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { ApiClient } from '../src/api/client';
import type { Course, Item, StudyBlock } from '../src/api/types';
import { lightColors, lightCourses } from '../src/ui/tokens';
import { fakeServer, memoryStore } from '../test-support/fakeServer';
import { flush, lowestOpacity, onScreen, press, tap, textColor, texts } from '../test-support/ui';

jest.useFakeTimers({ now: new Date(2026, 10, 2, 9, 0), doNotFake: ['nextTick', 'setImmediate'] });

type Node = ReactTestRenderer.ReactTestInstance;
type Server = ReturnType<typeof fakeServer>;

const SKIP = 'Skip for now · add dates by hand';
const TABS = ['Today', 'Schedule', 'Courses'];
const codeUrl = 'https://canvas.test/login/oauth2/auth?code=good-code&state=s1';

/** A local time in November 2026. */
const nov = (day: number, hour = 9, minute = 0) => new Date(2026, 10, day, hour, minute);

const courses: Course[] = [
  { id: 'c-db', source: 'canvas', name: 'Databases', code: 'DB' },
  { id: 'c-stats', source: 'canvas', name: 'Statistics', code: 'STAT' },
];

function item(fields: Partial<Item> & Pick<Item, 'id' | 'title'>): Item {
  return {
    courseId: null,
    courseName: null,
    source: 'canvas',
    kind: 'assignment',
    dueAt: null,
    endsAt: null,
    allDay: false,
    studyMinutes: null,
    status: 'not_started',
    ...fields,
  };
}

const statsExam = (): Item =>
  item({ id: 'item-stats', title: 'Stats midterm', kind: 'exam', courseName: 'Statistics', dueAt: nov(5).toISOString() });
const sqlHomework = (status: Item['status'] = 'in_progress'): Item =>
  item({ id: 'item-sql', title: 'SQL homework', courseName: 'Databases', dueAt: nov(3, 22).toISOString(), status });

const statsBlock = (fields: Partial<StudyBlock> = {}): StudyBlock => ({
  id: 'block-1',
  itemId: 'item-stats',
  itemTitle: 'Stats midterm',
  itemKind: 'exam',
  courseName: 'Statistics',
  itemDueAt: nov(5).toISOString(),
  itemStudyMinutes: 360,
  startsAt: nov(3, 19).toISOString(),
  endsAt: nov(3, 20).toISOString(),
  state: 'accepted',
  index: 1,
  total: 6,
  clash: null,
  ...fields,
});

let tree: ReactTestRenderer.ReactTestRenderer | undefined;

/** Opens the app, connected, on Today; `setup` fills the server first. */
async function openToday(setup?: (server: Server) => void, wrap?: (fetchImpl: typeof fetch) => typeof fetch) {
  const server = fakeServer();
  server.state.connected = true;
  server.state.courses = courses;
  setup?.(server);
  const client = new ApiClient('http://cue.test', memoryStore(), wrap ? wrap(server.fetchImpl) : server.fetchImpl);
  await act(async () => {
    tree = ReactTestRenderer.create(<App client={client} />);
  });
  await flush();
  return { server, root: tree!.root };
}

/** A week of work: an accepted study block, an exam, homework in progress, and two items without a date. */
function aWeekOfWork(server: Server) {
  server.state.items = [
    statsExam(),
    sqlHomework(),
    item({ id: 'item-lab', title: 'Lab report', courseName: 'Databases' }),
    item({ id: 'item-final', title: 'Final exam', kind: 'exam', courseName: 'Statistics' }),
  ];
  server.state.blocks = [statsBlock()];
}

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  tree = undefined;
});

function selectedTab(root: Node): string | undefined {
  const tab = root.findAll((n) => n.props['aria-selected'] === true && typeof n.props.onPress === 'function')[0];
  return tab ? texts(tab).find((t) => TABS.includes(t)) : undefined;
}

/** The days Schedule shows, as a screen reader reads their headers. */
function dayHeaders(root: Node): string[] {
  const labels = onScreen(
    root,
    (n) => n.props.accessibilityRole === 'header' && typeof n.props.accessibilityLabel === 'string',
  ).map((n) => n.props.accessibilityLabel as string);
  return [...new Set(labels)];
}

function selectedView(root: Node): string | undefined {
  return onScreen(
    root,
    (n) => n.props.accessibilityRole === 'tab' && n.props.accessibilityState?.selected && typeof n.props.onPress === 'function',
  )[0]?.props.accessibilityLabel;
}

/** The status changes sent for one item, oldest first. */
const statuses = (server: Server, id: string) =>
  server.state.calls.filter((c) => c.method === 'PUT' && c.path === `/api/items/${id}/status`).map((c) => c.body.status);

const overviewLoads = (server: Server) => server.state.calls.filter((c) => c.path === '/api/schedule/overview').length;

/** Picks `date` in the open date field labelled `label`, as the phone's picker would. */
async function pick(root: Node, label: string, date: Date) {
  await tap(root, label);
  await act(async () => root.findAllByType('DateTimePicker' as never)[0].props.onChange({ type: 'set' }, date));
  await tap(root, 'Done');
}

describe('Today', () => {
  it('shows the day, when Canvas was synced, Up next, Due soon and No date', async () => {
    const { root } = await openToday((server) => {
      aWeekOfWork(server);
      server.state.lastSyncedAt = new Date(2026, 10, 2, 8, 48).toISOString();
    });

    const shown = texts(root);
    expect(selectedTab(root)).toBe('Today');
    expect(shown).toEqual(expect.arrayContaining(['Today', 'Sync', 'Mon 2 Nov', 'Canvas synced 12 min ago']));
    expect(shown).toEqual(
      expect.arrayContaining(['Up next · Tomorrow, 19:00', 'Study for Stats midterm', 'Statistics · 1 h · exam Thu 5 Nov, 09:00']),
    );
    expect(shown).toEqual(expect.arrayContaining(['Due soon', 'SQL homework', 'Databases · Tomorrow, 22:00', 'Exam']));
    expect(shown).toEqual(expect.arrayContaining(['No date', 'Final exam', 'Lab report', 'Add date']));
    // Exams first under No date, and the whole list after Due soon.
    expect(shown.indexOf('Due soon')).toBeLessThan(shown.indexOf('No date'));
    expect(shown.indexOf('Final exam')).toBeLessThan(shown.indexOf('Lab report'));
    expect(shown).not.toContain('Nothing due this week');
  });

  it('puts the Up next card on the course tint, and dots the days with work in their course colours', async () => {
    const { root } = await openToday(aWeekOfWork);
    const teal = lightCourses[1]; // Statistics, the second course by name

    const card = onScreen(root, (n) => typeof n.type === 'string' && texts(n).includes('Study for Stats midterm'));
    const backgrounds = card.map((n) => StyleSheet.flatten(n.props.style)?.backgroundColor);
    expect(backgrounds).toContain(teal.tint);
    const dot = (day: string) => onScreen(root, (n) => n.props.testID === `dot-${day}` && typeof n.type === 'string')[0];
    // Tuesday has the Statistics block at 19:00 before the Databases homework at 22:00.
    expect(StyleSheet.flatten(dot('2026-11-03').props.style).backgroundColor).toBe(teal.mark);
    expect(StyleSheet.flatten(dot('2026-11-05').props.style).backgroundColor).toBe(teal.mark); // the exam
    expect(dot('2026-11-04')).toBeUndefined();
  });

  it('Start sets the study item In progress', async () => {
    const { server, root } = await openToday(aWeekOfWork);

    await press(root, 'Start');
    await flush();

    expect(statuses(server, 'item-stats')).toEqual(['in_progress']);
    expect(texts(root)).toContain('In progress');
    expect(texts(root)).not.toContain('Start');
  });

  it("Move opens the block's sheet with its time picker, and moves the block to the time picked", async () => {
    const { server, root } = await openToday(aWeekOfWork);

    await press(root, 'Move');
    expect(texts(root)).toContain('Study: Stats midterm');
    const when = nov(4, 20);
    await pick(root, 'New start', when);
    await press(root, 'Move here');
    await flush();

    const move = server.state.calls.find((c) => c.method === 'POST' && c.path === '/api/blocks/block-1/move');
    expect(move!.body).toEqual({ startsAt: when.toISOString() });
    expect(texts(root)).not.toContain('Study: Stats midterm');
    expect(texts(root)).toContain('Up next · Wed 4 Nov, 20:00');
  });

  it.each(['in_progress', 'not_started'] as const)('ticking a row marks it done, and Undo puts it back to %s', async (status) => {
    const { server, root } = await openToday((s) => {
      aWeekOfWork(s);
      s.state.items[1] = sqlHomework(status);
    });

    await tap(root, 'Mark SQL homework done');
    await flush();
    expect(statuses(server, 'item-sql')).toEqual(['done']);
    expect(texts(root)).toContain('Marked done');
    expect(texts(root)).not.toContain('SQL homework');

    await press(root, 'Undo');
    await flush();
    expect(statuses(server, 'item-sql')).toEqual(['done', status]);
    expect(texts(root)).toContain('SQL homework');
    expect(texts(root)).not.toContain('Marked done');
  });

  it('tapping a row opens it in the item sheet', async () => {
    const { root } = await openToday(aWeekOfWork);

    await press(root, 'SQL homework');
    expect(texts(root)).toContain('Edit item');
    expect(root.find((n) => n.props.accessibilityLabel === 'Title' && typeof n.props.onChangeText === 'function').props.value).toBe(
      'SQL homework',
    );
  });

  it("a No date row's Add date opens the item sheet, which saves the date", async () => {
    const { server, root } = await openToday(aWeekOfWork);

    await press(root, 'Add date');
    expect(texts(root)).toContain('Edit item');
    const title = root.find((n) => n.props.accessibilityLabel === 'Title' && typeof n.props.onChangeText === 'function');
    expect(title.props.value).toBe('Final exam');

    await pick(root, 'Due or exam date', nov(20, 10));
    await press(root, 'Save');
    await flush();
    const patch = server.state.calls.find((c) => c.method === 'PATCH' && c.path === '/api/items/item-final');
    expect(patch!.body.dueAt).toBe(nov(20, 10).toISOString());
    expect(texts(root)).not.toContain('Final exam'); // due in 18 days: no longer under No date, not yet due soon
  });

  /** The check circle on screen labelled `label`. */
  const checkCircle = (root: Node, label: string) =>
    onScreen(root, (n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];

  it('keeps a done item without a date at the end of No date, dimmed and ticked, and reopens it', async () => {
    const { server, root } = await openToday((s) => {
      aWeekOfWork(s);
      s.state.items.push(item({ id: 'item-essay', title: 'Essay', status: 'done' })); // no course
    });

    const shown = texts(root);
    expect(shown).toContain('Essay');
    expect(shown.indexOf('Lab report')).toBeLessThan(shown.indexOf('Essay'));
    expect(textColor(root, 'Essay')).toBe(lightColors.text2);
    expect(lowestOpacity(onScreen(root, (n) => n.props.children === 'Essay')[0])).toBe(1);
    expect(checkCircle(root, 'Mark Essay not done').props.accessibilityState.checked).toBe(true);

    await tap(root, 'Mark Essay not done');
    await flush();
    expect(statuses(server, 'item-essay')).toEqual(['not_started']);
    expect(textColor(root, 'Essay')).toBe(lightColors.text);
    expect(checkCircle(root, 'Mark Essay done').props.accessibilityState.checked).toBe(false);
  });

  it('opens a done item without a date in the item sheet', async () => {
    const { root } = await openToday((s) => {
      s.state.items = [item({ id: 'item-essay', title: 'Essay', status: 'done' })];
    });
    expect(texts(root)).not.toContain('Nothing due this week'); // it would hide the item
    await press(root, 'Essay');
    expect(texts(root)).toContain('Edit item');
  });

  it('ticking a No date row marks it done, and keeps it at the end of the group', async () => {
    const { server, root } = await openToday(aWeekOfWork);

    await tap(root, 'Mark Final exam done');
    await flush();
    expect(statuses(server, 'item-final')).toEqual(['done']);
    expect(texts(root)).toContain('Marked done');
    const shown = texts(root);
    expect(shown.indexOf('Lab report')).toBeLessThan(shown.indexOf('Final exam'));
    expect(checkCircle(root, 'Mark Final exam not done').props.accessibilityState.checked).toBe(true);
  });

  it('shows what the planner could not fit, above Due soon', async () => {
    const { root } = await openToday((s) => {
      aWeekOfWork(s);
      s.state.shortfalls = [
        { itemId: 'item-stats', itemTitle: 'Stats midterm', dueAt: nov(5).toISOString(), neededMinutes: 360, plannedMinutes: 120 },
      ];
    });

    const shown = texts(root);
    const warning = 'Stats midterm: 2 of 6 hours fit before Thu 5 Nov. Add study times or lower the hours.';
    expect(shown).toContain(warning);
    expect(shown.indexOf(warning)).toBeLessThan(shown.indexOf('Due soon'));
  });

  it('with only suggestions, Review opens Schedule on the first one', async () => {
    const { server, root } = await openToday((s) => {
      s.state.items = [statsExam()];
      s.state.blocks = [
        statsBlock({ id: 'b2', state: 'proposed', startsAt: nov(6, 19).toISOString(), endsAt: nov(6, 20).toISOString() }),
        statsBlock({ id: 'b1', state: 'proposed', startsAt: nov(4, 19).toISOString(), endsAt: nov(4, 20).toISOString() }),
      ];
    });
    expect(texts(root)).toContain('2 suggested study blocks');
    expect(texts(root)).not.toContain('Start');

    await press(root, 'Review');
    await flush();
    expect(selectedTab(root)).toBe('Schedule');
    expect(dayHeaders(root)[0]).toBe('Wed 4 Nov');
    const week = server.state.calls.filter((c) => c.path === '/api/schedule/week')[0];
    expect(week.query.from).toBe(new Date(2026, 10, 4).toISOString());
  });

  it('with work coming but no study blocks, Set study times opens Study times', async () => {
    const { root } = await openToday((server) => {
      server.state.items = [statsExam()];
    });
    expect(texts(root)).toContain('Plan your studying');

    await press(root, 'Set study times');
    await flush();
    expect(texts(root)).toEqual(expect.arrayContaining(['Study times', 'Save']));
  });

  it('a day in the strip opens Schedule in Day view on that day', async () => {
    const { server, root } = await openToday(aWeekOfWork);

    await tap(root, 'Thu 5 Nov');
    await flush();

    expect(selectedTab(root)).toBe('Schedule');
    expect(selectedView(root)).toBe('Day');
    expect(dayHeaders(root)).toEqual(['Thu 5 Nov']);
    expect(server.state.calls.filter((c) => c.path === '/api/schedule/week').map((c) => c.query)).toEqual([
      { from: new Date(2026, 10, 5).toISOString(), to: new Date(2026, 10, 6).toISOString() },
    ]);
  });

  it('See all opens Schedule', async () => {
    const { root } = await openToday(aWeekOfWork);
    await press(root, 'See all');
    await flush();
    expect(selectedTab(root)).toBe('Schedule');
  });

  it('the gear opens Settings', async () => {
    const { root } = await openToday();
    await tap(root, 'Settings');
    await flush();
    expect(texts(root)).toContain('Study times');
  });

  it('loads again each time Today comes back into view', async () => {
    const { server, root } = await openToday(aWeekOfWork);
    const loads = overviewLoads(server);
    server.state.items[1].status = 'done'; // done somewhere else

    await press(root, 'Schedule');
    await flush();
    await press(root, 'Today');
    await flush();
    expect(overviewLoads(server)).toBe(loads + 1);
    expect(texts(root)).not.toContain('SQL homework');
  });

  it('on coming back to the front after midnight, shows the new day and loads again', async () => {
    const { server, root } = await openToday((s) => {
      s.state.items = [
        item({ id: 'item-a', title: 'Due Wednesday', dueAt: nov(4, 10).toISOString() }),
        item({ id: 'item-b', title: 'Due next Monday', dueAt: nov(9, 10).toISOString() }),
      ];
    });
    expect(texts(root)).toContain('Mon 2 Nov');
    expect(texts(root)).toContain('Due Wednesday');
    expect(texts(root)).not.toContain('Due next Monday'); // beyond the week
    const loads = overviewLoads(server);

    // The phone was left on Today overnight; it is now 00:30 on Sunday 8 Nov, the last day of that week.
    jest.setSystemTime(new Date(2026, 10, 8, 0, 30));
    const listeners = (AppState.addEventListener as jest.Mock).mock.calls.filter(([event]) => event === 'change');
    await act(async () => {
      listeners.forEach(([, onChange]) => onChange('active'));
    });
    await flush();

    expect(overviewLoads(server)).toBe(loads + 1);
    expect(texts(root)).toContain('Sun 8 Nov');
    expect(texts(root)).not.toContain('Mon 2 Nov');
    expect(texts(root)).toContain('Due next Monday'); // now inside the Due soon window
    jest.setSystemTime(new Date(2026, 10, 2, 9, 0));
  });

  it('shows "Nothing due this week" when there is nothing to do', async () => {
    const { root } = await openToday();

    const shown = texts(root);
    expect(shown).toContain('Nothing due this week');
    expect(shown).not.toContain('Due soon');
    expect(shown).not.toContain('No date');
    expect(shown.filter((t) => t.startsWith('Up next'))).toHaveLength(0);
  });

  it('keeps the layout with a spinner while loading', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const { root } = await openToday(aWeekOfWork, (fetchImpl) =>
      (async (url: string, init?: RequestInit) => {
        if (new URL(url).pathname === '/api/schedule/overview') await held;
        return fetchImpl(url, init);
      }) as unknown as typeof fetch,
    );
    expect(texts(root)).toContain('Mon 2 Nov');
    expect(onScreen(root, (n) => n.type === ActivityIndicator)).not.toHaveLength(0);
    expect(texts(root)).not.toContain('Nothing due this week');

    await act(async () => release());
    await flush();
    expect(texts(root)).toContain('SQL homework');
  });

  it('shows a failed load with Try again, which loads again', async () => {
    let fail = true;
    const { root } = await openToday(aWeekOfWork, (fetchImpl) =>
      (async (url: string, init?: RequestInit) => {
        if (fail && new URL(url).pathname === '/api/schedule/overview') throw new TypeError('Network request failed');
        return fetchImpl(url, init);
      }) as unknown as typeof fetch,
    );
    const message = 'Cannot reach the Cue server. Check your connection and try again.';
    expect(texts(root)).toContain(message);
    expect(texts(root)).not.toContain('Nothing due this week');

    fail = false;
    await press(root, 'Try again');
    await flush();
    expect(texts(root)).not.toContain(message);
    expect(texts(root)).toContain('SQL homework');
  });

  it('lets the last rows scroll clear of the + button', async () => {
    const { root } = await openToday(aWeekOfWork);

    const add = onScreen(root, (n) => n.props.accessibilityLabel === 'Add' && typeof n.props.onPress === 'function')[0];
    const addStyle = StyleSheet.flatten(add.props.style);
    const list = onScreen(root, (n) => n.props.refreshControl !== undefined && n.props.contentContainerStyle !== undefined)[0];
    const content = StyleSheet.flatten(list.props.contentContainerStyle);
    expect(content.paddingBottom).toBeGreaterThanOrEqual(Number(addStyle.height) + Number(addStyle.bottom));
  });
});

describe('Sync on Today', () => {
  /** Opens Today without Canvas, after skipping Welcome. */
  async function openUnconnected(loginAvailable: boolean) {
    const server = fakeServer();
    server.state.loginAvailable = loginAvailable;
    const client = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);
    await act(async () => {
      tree = ReactTestRenderer.create(<App client={client} />);
    });
    await flush();
    await press(tree!.root, SKIP);
    await flush();
    return { server, root: tree!.root };
  }

  /** Pulls the list down, as a student refreshing does. */
  async function pull(root: Node) {
    const list = onScreen(root, (n) => n.props.refreshControl !== undefined && n.props.contentContainerStyle !== undefined)[0];
    await act(async () => {
      await list.props.refreshControl.props.onRefresh();
    });
    await flush();
  }

  it('Sync opens Check what Cue found', async () => {
    const { root } = await openToday();
    expect(texts(root)).not.toContain('Connect Canvas');

    await press(root, 'Sync');
    await flush();
    expect(texts(root)).toContain('Check what Cue found');
  });

  it('pulling down syncs too', async () => {
    const { root } = await openToday();
    await pull(root);
    expect(texts(root)).toContain('Check what Cue found');
  });

  it('without Canvas, the button reads Connect Canvas and starts the login, which leads to the review', async () => {
    const { root } = await openUnconnected(true);
    expect(selectedTab(root)).toBe('Today');
    expect(texts(root)).not.toContain('Sync');
    expect(texts(root)).toContain('Connect Canvas');

    await press(root, 'Connect Canvas');
    await flush();
    const web = root.findByType('WebView' as never);
    expect(web.props.source.uri).toBe('https://canvas.test/login/oauth2/auth?client_id=1&state=s1');
    await act(async () => {
      web.props.onShouldStartLoadWithRequest({ url: codeUrl });
    });
    await flush();
    expect(texts(root)).toContain('Check what Cue found');

    // Back on Today, which asks again whether Canvas is connected.
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
  });

  it('without Canvas, pulling down loads again instead of syncing', async () => {
    const { server, root } = await openUnconnected(false);
    const loads = overviewLoads(server);
    await pull(root);
    expect(overviewLoads(server)).toBe(loads + 1);
    expect(texts(root)).not.toContain('Check what Cue found');
    expect(onScreen(root, (n) => n.props.placeholder === 'Paste your token')).toHaveLength(0);
  });
});
