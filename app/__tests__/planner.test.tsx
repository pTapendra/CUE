import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { ApiClient } from '../src/api/client';
import type { StudyBlock } from '../src/api/types';
import { deviceTimeZone } from '../src/timeZone';
import { fakeServer, memoryStore } from '../test-support/fakeServer';
import { flush, press, tap, texts } from '../test-support/ui';

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

/** Opens the app on the Schedule tab with one suggested block. */
async function openSchedule() {
  const server = fakeServer();
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

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  tree = undefined;
});

describe('study times', () => {
  it("saves with the phone's current time zone", async () => {
    const { server, root } = await openSchedule();
    server.state.settings.timeZone = 'Antarctica/Troll'; // saved before the phone moved

    // Settings opens from the gear on Schedule.
    await tap(root, 'Settings');
    await press(root, 'Study times');
    await flush();
    expect(texts(root)).toContain(`Time zone: ${deviceTimeZone()}`);
    await press(root, 'Save and plan');
    await flush();

    const put = server.state.calls.filter((c) => c.method === 'PUT' && c.path === '/api/planner/settings').pop();
    expect(put!.body.timeZone).toBe(deviceTimeZone());
  });

  it('switches Friday off and saves', async () => {
    const { server, root } = await openSchedule();

    // Settings opens from the gear on Schedule.
    await tap(root, 'Settings');
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
    expect(texts(root)).toContain('3 days'); // back on Schedule
    expect(texts(root)).not.toContain('Save and plan');
  });
});
