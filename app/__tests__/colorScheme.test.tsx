import React from 'react';
import { StyleSheet, Text, useColorScheme } from 'react-native';
import * as ReactNative from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { ApiClient } from '../src/api/client';
import { darkColors, lightColors } from '../src/ui/tokens';
import { fakeServer, memoryStore } from '../test-support/fakeServer';
import { flush, onScreen, press, tap, texts } from '../test-support/ui';

jest.useFakeTimers({ now: new Date(2026, 10, 2, 9, 0), doNotFake: ['nextTick', 'setImmediate'] });

let tree: ReactTestRenderer.ReactTestRenderer | undefined;

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  tree = undefined;
  jest.restoreAllMocks();
});

const at = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString();

async function open(connected: boolean) {
  const server = fakeServer();
  server.state.connected = connected;
  server.state.courses = [{ id: 'c-stats', source: 'canvas', name: 'Statistics', code: 'STAT' }];
  server.state.items = [
    {
      id: 'midterm',
      title: 'Stats midterm',
      courseId: 'c-stats',
      courseName: 'Statistics',
      source: 'canvas',
      kind: 'exam',
      dueAt: at(5, 9),
      endsAt: null,
      allDay: false,
      studyMinutes: 360,
      status: 'in_progress',
    },
  ];
  server.state.items.push({ ...server.state.items[0], id: 'hw', title: 'Stats homework', kind: 'assignment', status: 'done' });
  server.state.blocks = [
    {
      id: 'b1',
      itemId: 'midterm',
      itemTitle: 'Stats midterm',
      itemKind: 'exam',
      courseName: 'Statistics',
      itemDueAt: at(5, 9),
      itemStudyMinutes: 360,
      startsAt: at(3, 19),
      endsAt: at(3, 20),
      state: 'accepted',
      index: 1,
      total: 6,
      clash: null,
    },
  ];
  const client = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);
  await act(async () => {
    tree = ReactTestRenderer.create(<App client={client} />);
  });
  await flush();
  return tree!.root;
}

/** Every Text on screen uses the colours of the scheme in force, so a dark phone is not drawn in light colours. */
function usesTextColour(root: ReactTestRenderer.ReactTestInstance, colour: string) {
  return onScreen(root, (n) => n.type === Text && StyleSheet.flatten(n.props.style)?.color === colour).length > 0;
}

describe.each(['light', 'dark'] as const)('every screen in %s mode', (scheme) => {
  const palette = scheme === 'dark' ? darkColors : lightColors;

  beforeEach(() => {
    jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(scheme);
    expect(useColorScheme()).toBe(scheme);
  });

  it('draws Welcome', async () => {
    const root = await open(false);
    expect(texts(root)).toContain('Know what to study, and when.');
    expect(usesTextColour(root, palette.text)).toBe(true);
  });

  it('draws Today, Schedule, Courses, a course and its sheets', async () => {
    const root = await open(true);
    expect(texts(root)).toContain('Up next · Tomorrow, 19:00');
    expect(usesTextColour(root, palette.text)).toBe(true);

    await press(root, 'Schedule');
    await flush();
    expect(texts(root)).toContain('Stats midterm');

    await press(root, 'Courses');
    await flush();
    await press(root, 'Statistics');
    await flush();
    expect(texts(root)).toContain('Stats midterm');
    await press(root, 'Work');
    await press(root, 'Stats homework');
    await flush();
    expect(texts(root)).toContain('Edit item');
  });

  it('draws Settings, Study times, What Cue keeps and Review', async () => {
    const root = await open(true);
    await tap(root, 'Settings');
    await flush();
    expect(texts(root)).toContain('Disconnect Canvas');
    expect(usesTextColour(root, palette.text)).toBe(true);

    await press(root, 'Study times');
    await flush();
    await tap(root, 'Back');
    await flush();
    await press(root, 'What Cue keeps');
    await flush();
    expect(texts(root).join(' ')).toContain('No name or email');
    await tap(root, 'Back');
    await flush();
    await press(root, 'Done');
    await flush();

    await press(root, 'Sync');
    await flush();
    expect(texts(root)).toContain('Check what Cue found');
  });
});
