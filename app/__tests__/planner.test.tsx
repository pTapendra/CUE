import React from 'react';
import { AppState } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { ApiClient } from '../src/api/client';
import type { Item, StudyBlock } from '../src/api/types';
import { deviceTimeZone } from '../src/timeZone';
import { fakeServer, memoryStore } from '../test-support/fakeServer';
import { flush, press, texts } from '../test-support/ui';

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

/** Opens the app on the week (in the Schedule tab) with one suggested block and one short item. */
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
  // The week is in the Schedule tab.
  await press(tree!.root, 'Schedule');
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
