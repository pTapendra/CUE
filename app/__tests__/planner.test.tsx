import React from 'react';
import { AppState, TextInput } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { ApiClient } from '../src/api/client';
import type { Item, StudyBlock } from '../src/api/types';
import { deviceTimeZone } from '../src/timeZone';
import { fakeServer, memoryStore } from '../test-support/fakeServer';
import { flush, isDisabled, press, texts, type } from '../test-support/ui';

jest.useFakeTimers({ now: new Date(2026, 10, 2, 9, 0), doNotFake: ['nextTick', 'setImmediate'] });

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

let tree: ReactTestRenderer.ReactTestRenderer | undefined;

/** Opens the app on the Week screen with one suggested block and one short item. */
async function openWeek(items: Item[] = []) {
  const server = fakeServer();
  server.state.items = items;
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
  const client = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);
  await act(async () => {
    tree = ReactTestRenderer.create(<App client={client} />);
  });
  await flush();
  return { server, root: tree!.root };
}

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  tree = undefined;
});

it('shows suggested blocks and shortfalls on the grid', async () => {
  const { root } = await openWeek();

  const shown = texts(root);
  expect(shown).toContain('Stats midterm');
  expect(shown).toContain('1 of 6');
  expect(shown).toContain('1 suggested block');
  expect(shown).toContain('DB final: 5 of 6 hours fit before Mon 9 Nov. Add study times or lower the hours.');
});

it('asks for the days on screen, up to midnight after the last one', async () => {
  const { server } = await openWeek();

  const get = server.state.calls.filter((c) => c.path === '/api/schedule/week').pop();
  // Local midnights, so a page over a clock change still ends where its last day ends.
  expect(get!.query).toEqual({ from: new Date(2026, 10, 2).toISOString(), to: new Date(2026, 10, 5).toISOString() });
});

it('accepts all suggestions on screen', async () => {
  const { server, root } = await openWeek();

  await press(root, 'Accept all');
  await flush();

  const accept = server.state.calls.find((c) => c.method === 'POST' && c.path === '/api/blocks/accept');
  expect(accept!.body).toEqual({
    from: new Date(2026, 10, 2).toISOString(),
    to: new Date(2026, 10, 5).toISOString(),
  });
  // The week reloads: the block is accepted, so nothing is left to suggest.
  expect(texts(root)).toContain('Stats midterm');
  expect(texts(root)).not.toContain('1 suggested block');
});

describe('block sheet', () => {
  async function openSheet() {
    const opened = await openWeek();
    await press(opened.root, 'Stats midterm');
    return opened;
  }

  it('accepts a block from its sheet', async () => {
    const { server, root } = await openSheet();
    expect(texts(root)).toContain('Study: Stats midterm');

    await press(root, 'Accept');
    await flush();

    expect(server.state.calls.some((c) => c.method === 'POST' && c.path === '/api/blocks/block-1/accept')).toBe(true);
    expect(texts(root)).not.toContain('Study: Stats midterm');
  });

  it('rejects a block from its sheet', async () => {
    const { server, root } = await openSheet();

    await press(root, 'Not this time');
    await flush();

    expect(server.state.calls.some((c) => c.method === 'POST' && c.path === '/api/blocks/block-1/reject')).toBe(true);
  });

  it('moves a block to a typed time', async () => {
    const { server, root } = await openSheet();

    await press(root, 'Move to another time');
    await type(root, 'YYYY-MM-DD HH:mm', '2026-11-04 20:00');
    await press(root, 'Move here');
    await flush();

    const move = server.state.calls.find((c) => c.method === 'POST' && c.path === '/api/blocks/block-1/move');
    expect(move!.body).toEqual({ startsAt: new Date(2026, 10, 4, 20, 0).toISOString() });
  });

  /** The bodies of the study-time changes sent for the Stats midterm. */
  const studyPatches = (server: ReturnType<typeof fakeServer>) =>
    server.state.calls.filter((c) => c.method === 'PATCH' && c.path === '/api/items/item-stats').map((c) => c.body);

  it('changes how much study the exam needs, step by step, and still acts on the re-planned block', async () => {
    const { server, root } = await openSheet();
    expect(texts(root)).toContain('Study time for this exam');
    expect(texts(root)).toContain('6 h');

    await press(root, '+');
    await flush();
    await press(root, '+');
    await flush();

    expect(studyPatches(server)).toEqual([{ studyMinutes: 420 }, { studyMinutes: 480 }]);
    expect(texts(root)).toContain('8 h');

    // Each change re-planned, so the suggestion has a new id; the sheet acts on that one.
    const replanned = server.state.blocks[0].id;
    expect(replanned).not.toBe('block-1');
    await press(root, 'Accept');
    await flush();

    expect(server.state.calls.some((c) => c.method === 'POST' && c.path === `/api/blocks/${replanned}/accept`)).toBe(true);
    expect(texts(root)).not.toContain('Study: Stats midterm');
  });

  it('keeps counting study time when the re-plan moves the block elsewhere', async () => {
    const { server, root } = await openSheet();
    // The next re-plan puts the suggestion on Wednesday instead.
    Object.assign(server.state.blocks[0], {
      startsAt: new Date(2026, 10, 4, 19, 0).toISOString(),
      endsAt: new Date(2026, 10, 4, 20, 0).toISOString(),
    });

    await press(root, '+');
    await flush();
    expect(texts(root)).toContain('7 h');
    await press(root, '+');
    await flush();

    expect(studyPatches(server)).toEqual([{ studyMinutes: 420 }, { studyMinutes: 480 }]);
    expect(texts(root)).toContain('8 h');
  });

  it('shows a message and refreshes when the block is already gone', async () => {
    const { server, root } = await openSheet();
    server.state.blocks = [];

    await press(root, 'Not this time');
    await flush();

    expect(texts(root)).toContain('nope');
    expect(texts(root)).not.toContain('Stats midterm');
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

  it('sends a changed time zone when the app comes back to the front, then reloads the week', async () => {
    const { server } = await openWeek();
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

describe('study times', () => {
  it("saves with the phone's current time zone", async () => {
    const { server, root } = await openWeek();
    server.state.settings.timeZone = 'Antarctica/Troll'; // saved before the phone moved

    await press(root, '⚙');
    await press(root, 'Study times');
    await flush();
    expect(texts(root)).toContain(`Time zone: ${deviceTimeZone()}`);
    await press(root, 'Save and plan');
    await flush();

    const put = server.state.calls.filter((c) => c.method === 'PUT' && c.path === '/api/planner/settings').pop();
    expect(put!.body.timeZone).toBe(deviceTimeZone());
  });

  it('switches Friday off and saves', async () => {
    const { server, root } = await openWeek();

    await press(root, '⚙');
    await press(root, 'Study times');
    await flush();
    expect(texts(root)).toContain('Most study in one day');

    const friday = root.find((n) => n.props.accessibilityLabel === 'Fri on' && typeof n.props.onValueChange === 'function');
    await act(async () => {
      friday.props.onValueChange(false);
    });
    await press(root, 'Save and plan');
    await flush();

    const put = server.state.calls.filter((c) => c.method === 'PUT' && c.path === '/api/planner/settings').pop();
    expect(put!.body.windows.find((w: { weekday: number }) => w.weekday === 5).enabled).toBe(false);
    expect(texts(root)).toContain('Add');
    expect(texts(root)).not.toContain('Save and plan');
  });
});

describe('item editor', () => {
  it('edits how much study an exam needs', async () => {
    const exam: Item = {
      id: 'item-chem',
      courseId: null,
      courseName: null,
      source: 'manual',
      kind: 'exam',
      title: 'Chem exam',
      dueAt: new Date(2026, 10, 4, 10, 0).toISOString(),
      endsAt: null,
      allDay: false,
      studyMinutes: 360,
      status: 'not_started',
    };
    const { server, root } = await openWeek([exam]);
    await press(root, 'Exam: Chem exam');
    expect(texts(root)).toContain('Study time');
    expect(texts(root)).toContain('6 h');

    await press(root, '+');
    await press(root, '+');
    await press(root, 'Save');
    await flush();

    const patch = server.state.calls.find((c) => c.method === 'PATCH' && c.path === '/api/items/item-chem');
    expect(patch!.body).toMatchObject({ studyMinutes: 480 });
  });

  it('shows an event whose end is not after its start as one hour, and refuses such an end', async () => {
    const at18 = new Date(2026, 10, 3, 18, 0).toISOString();
    const review: Item = {
      id: 'item-review',
      courseId: null,
      courseName: null,
      source: 'canvas',
      kind: 'event',
      title: 'Review session',
      dueAt: at18,
      endsAt: at18, // saved before such ends were refused
      allDay: false,
      studyMinutes: null,
      status: 'not_started',
    };
    const { server, root } = await openWeek([review]);
    await press(root, 'Review session'); // it is on the grid

    const ends = () => root.findAllByType(TextInput).filter((n) => n.props.placeholder === 'YYYY-MM-DD HH:mm')[1];
    expect(texts(root)).toContain('Ends must be after the start');
    expect(isDisabled(root, 'Save')).toBe(true);
    await act(async () => {
      ends().props.onChangeText('2026-11-03 17:00');
    });
    expect(texts(root)).toContain('Ends must be after the start');
    expect(isDisabled(root, 'Save')).toBe(true);

    // An empty end means it has no set end.
    await act(async () => {
      ends().props.onChangeText('');
    });
    expect(texts(root)).not.toContain('Ends must be after the start');
    await press(root, 'Save');
    await flush();
    const patch = server.state.calls.find((c) => c.method === 'PATCH' && c.path === '/api/items/item-review');
    expect(patch!.body).toMatchObject({ endsAt: null });
  });

  it('adds an event with an end time', async () => {
    const { server, root } = await openWeek();
    await press(root, 'Add');
    await type(root, 'e.g. Statistics midterm', 'Club meeting');
    await press(root, 'Other');
    expect(texts(root)).not.toContain('Study time');
    const fields = root.findAllByType(TextInput).filter((n) => n.props.placeholder === 'YYYY-MM-DD HH:mm');
    expect(fields).toHaveLength(2);
    await act(async () => {
      fields[0].props.onChangeText('2026-11-03 15:00');
    });
    await act(async () => {
      fields[1].props.onChangeText('2026-11-03 17:00');
    });
    await press(root, 'Save');
    await flush();

    const post = server.state.calls.find((c) => c.method === 'POST' && c.path === '/api/items');
    expect(post!.body).toMatchObject({ kind: 'event', endsAt: new Date(2026, 10, 3, 17, 0).toISOString() });
    expect(post!.body).not.toHaveProperty('studyMinutes');
  });
});
