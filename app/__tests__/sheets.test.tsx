import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { ApiClient } from '../src/api/client';
import type { Item, StudyBlock } from '../src/api/types';
import { fakeServer, memoryStore } from '../test-support/fakeServer';
import { flush, isDisabled, press, texts } from '../test-support/ui';

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

/** Opens the app on the Schedule tab with one suggested study block. */
async function openWeek(items: Item[] = []) {
  const server = fakeServer();
  server.state.items = items;
  server.state.connected = true;
  server.state.blocks = [{ ...statsBlock }];
  const client = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);
  await act(async () => {
    tree = ReactTestRenderer.create(<App client={client} />);
  });
  await flush();
  await press(tree!.root, 'Schedule');
  await flush();
  return { server, root: tree!.root };
}

type Node = ReactTestRenderer.ReactTestInstance;

/** Presses the control with this accessibility label. */
function tap(root: Node, label: string) {
  const target = root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
  if (!target) throw new Error(`No control "${label}"`);
  return act(async () => {
    await target.props.onPress();
  });
}

/** Opens the date field with this label and picks `date` in its picker. */
async function pick(root: Node, label: string, date: Date) {
  await tap(root, label);
  const pickers = root.findAllByType('DateTimePicker' as never);
  expect(pickers).toHaveLength(1);
  await act(async () => pickers[0].props.onChange({ type: 'set' }, date));
  await tap(root, 'Done');
}

/** Types into the title field. */
function typeTitle(root: Node, value: string) {
  const input = root.find((n) => n.props.placeholder === 'e.g. Statistics midterm' && typeof n.props.onChangeText === 'function');
  return act(async () => {
    input.props.onChangeText(value);
  });
}

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  tree = undefined;
  jest.restoreAllMocks();
});

const exam = (studyMinutes: number): Item => ({
  id: 'item-chem',
  courseId: null,
  courseName: null,
  source: 'manual',
  kind: 'exam',
  title: 'Chem exam',
  dueAt: new Date(2026, 10, 4, 10, 0).toISOString(),
  endsAt: null,
  allDay: false,
  studyMinutes,
  status: 'not_started',
});

describe('block sheet', () => {
  async function openSheet() {
    const opened = await openWeek();
    await press(opened.root, 'Stats midterm');
    return opened;
  }

  it('shows what the block is and that it is suggested', async () => {
    const { root } = await openSheet();
    const shown = texts(root);
    expect(shown).toContain('Study: Stats midterm');
    expect(shown).toContain('Statistics');
    expect(shown).toContain('Suggested');
  });

  it('accepts a block from its sheet', async () => {
    const { server, root } = await openSheet();

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

  it('moves a block to the time picked in the date picker', async () => {
    const { server, root } = await openSheet();

    await press(root, 'Move');
    const when = new Date(2026, 10, 4, 20, 0);
    await tap(root, 'New start');
    await act(async () => root.findAllByType('DateTimePicker' as never)[0].props.onChange({ type: 'set' }, when));
    await tap(root, 'Done');
    await press(root, 'Move here');
    await flush();

    const move = server.state.calls.find((c) => c.method === 'POST' && c.path === '/api/blocks/block-1/move');
    expect(move!.body).toEqual({ startsAt: when.toISOString() });
  });

  /** The bodies of the study-time changes sent for the Stats midterm. */
  const studyPatches = (server: ReturnType<typeof fakeServer>) =>
    server.state.calls.filter((c) => c.method === 'PATCH' && c.path === '/api/items/item-stats').map((c) => c.body);

  it('changes how much study the exam needs, step by step, and still acts on the re-planned block', async () => {
    const { server, root } = await openSheet();
    expect(texts(root).join(' ')).toContain('This needs');
    expect(texts(root)).toContain('6 h');

    await tap(root, 'Study time, more');
    await flush();
    await tap(root, 'Study time, more');
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

    await tap(root, 'Study time, more');
    await flush();
    expect(texts(root)).toContain('7 h');
    await tap(root, 'Study time, more');
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

describe('item sheet', () => {
  it('edits how much study an exam needs', async () => {
    const { server, root } = await openWeek([exam(360)]);
    await press(root, 'Exam: Chem exam');
    expect(texts(root)).toContain('Study time');
    expect(texts(root)).toContain('6 h');

    await tap(root, 'Study time, more');
    await tap(root, 'Study time, more');
    await press(root, 'Save');
    await flush();

    const patch = server.state.calls.find((c) => c.method === 'PATCH' && c.path === '/api/items/item-chem');
    expect(patch!.body).toMatchObject({ studyMinutes: 480 });
  });

  it("shows the new type's default study time after switching type, and does not send one", async () => {
    const { server, root } = await openWeek([exam(480)]);
    await press(root, 'Exam: Chem exam');
    expect(texts(root)).toContain('8 h');

    await tap(root, 'Assignment');
    expect(texts(root)).toContain('2 h');
    expect(texts(root)).not.toContain('8 h');
    await press(root, 'Save');
    await flush();

    const patch = server.state.calls.find((c) => c.method === 'PATCH' && c.path === '/api/items/item-chem');
    expect(patch!.body).toMatchObject({ kind: 'assignment' });
    expect(patch!.body).not.toHaveProperty('studyMinutes');
  });

  it('refuses an event end that is not after its start, until it is changed or cleared', async () => {
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

    expect(texts(root)).toContain('Ends must be after the start');
    expect(isDisabled(root, 'Save')).toBe(true);
    await pick(root, 'Ends', new Date(2026, 10, 3, 17, 0));
    expect(texts(root)).toContain('Ends must be after the start');
    expect(isDisabled(root, 'Save')).toBe(true);

    // Clearing the end means it has no set end.
    await tap(root, 'No end');
    expect(texts(root)).not.toContain('Ends must be after the start');
    await press(root, 'Save');
    await flush();
    const patch = server.state.calls.find((c) => c.method === 'PATCH' && c.path === '/api/items/item-review');
    expect(patch!.body).toMatchObject({ endsAt: null });
  });

  it('adds an event with an end time', async () => {
    const { server, root } = await openWeek();
    await press(root, 'Add');
    await typeTitle(root, 'Club meeting');
    await tap(root, 'Event');
    expect(texts(root)).not.toContain('Study time');
    await pick(root, 'Due or exam date', new Date(2026, 10, 3, 15, 0));
    await pick(root, 'Ends', new Date(2026, 10, 3, 17, 0));
    await press(root, 'Save');
    await flush();

    const post = server.state.calls.find((c) => c.method === 'POST' && c.path === '/api/items');
    expect(post!.body).toMatchObject({
      kind: 'event',
      dueAt: new Date(2026, 10, 3, 15, 0).toISOString(),
      endsAt: new Date(2026, 10, 3, 17, 0).toISOString(),
    });
    expect(post!.body).not.toHaveProperty('studyMinutes');
  });

  it('clears the due date with No date and sends null', async () => {
    const { server, root } = await openWeek([exam(360)]);
    await press(root, 'Exam: Chem exam');

    await tap(root, 'No date');
    await press(root, 'Save');
    await flush();

    const patch = server.state.calls.find((c) => c.method === 'PATCH' && c.path === '/api/items/item-chem');
    expect(patch!.body).toMatchObject({ dueAt: null });
  });

  it('asks before deleting, and deletes only when confirmed', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { server, root } = await openWeek([exam(360)]);
    await press(root, 'Exam: Chem exam');

    await press(root, 'Delete');
    await flush();

    expect(alert).toHaveBeenCalledTimes(1);
    expect(server.state.calls.some((c) => c.method === 'DELETE')).toBe(false);

    const buttons = alert.mock.calls[0][2]!;
    await act(async () => {
      await buttons.find((b) => b.style === 'destructive')!.onPress!();
    });
    await flush();
    expect(server.state.calls.some((c) => c.method === 'DELETE' && c.path === '/api/items/item-chem')).toBe(true);
  });
});
