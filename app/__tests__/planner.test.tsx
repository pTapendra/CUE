import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { ApiClient } from '../src/api/client';
import type { StudyBlock } from '../src/api/types';
import { fakeServer, memoryStore } from '../test-support/fakeServer';
import { flush, press, texts, type } from '../test-support/ui';

jest.useFakeTimers({ now: new Date(2026, 10, 2, 9, 0), doNotFake: ['nextTick', 'setImmediate'] });

const statsBlock: StudyBlock = {
  id: 'block-1',
  itemId: 'item-stats',
  itemTitle: 'Stats midterm',
  itemKind: 'exam',
  courseName: 'Statistics',
  itemDueAt: new Date(2026, 10, 5, 9, 0).toISOString(),
  startsAt: new Date(2026, 10, 3, 19, 0).toISOString(),
  endsAt: new Date(2026, 10, 3, 20, 0).toISOString(),
  state: 'proposed',
  index: 1,
  total: 6,
  clash: null,
};

let tree: ReactTestRenderer.ReactTestRenderer | undefined;

/** Opens the app on the Week screen with one suggested block and one short item. */
async function openWeek() {
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

  it('changes how much study the exam needs', async () => {
    const { server, root } = await openSheet();
    expect(texts(root)).toContain('Study time for this exam');

    await press(root, '+');
    await flush();

    const patch = server.state.calls.find((c) => c.method === 'PATCH' && c.path === '/api/items/item-stats');
    expect(patch!.body).toEqual({ studyMinutes: 420 });
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
