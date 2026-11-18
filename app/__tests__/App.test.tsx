/**
 * @format
 */

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import * as WebBrowser from 'expo-web-browser';
import App from '../App';
import { ApiClient } from '../src/api/client';
import { deviceTimeZone } from '../src/timeZone';
import { fakeServer, memoryStore } from '../test-support/fakeServer';
import { flush, isDisabled, press, texts, type } from '../test-support/ui';

jest.useFakeTimers({ now: new Date(2026, 10, 2, 9, 0), doNotFake: ['nextTick', 'setImmediate'] });

// Opening a real browser is not possible in tests; record where the app tries to go.
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'dismiss' })) }));

it('connects Canvas, confirms items with a missing exam date, and shows the week', async () => {
  const server = fakeServer();
  const client = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);

  let tree: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<App client={client} />);
  });
  await flush();
  const root = tree!.root;
  expect(texts(root)).toContain('Connect Canvas');

  await type(root, 'yourschool.instructure.com', 's.instructure.com');
  await type(root, 'Paste your token', 'good-token-123');
  await press(root, 'Connect and sync');
  await flush();
  expect(server.state.calls.find((c) => c.method === 'PUT' && c.path !== '/api/planner/settings')!.body).toEqual({
    baseUrl: 'https://s.instructure.com',
    token: 'good-token-123',
  });

  // The phone's time zone was sent to the Planner at startup.
  const zonePut = server.state.calls.find((c) => c.method === 'PUT' && c.path === '/api/planner/settings');
  expect((zonePut!.body as { timeZone: string }).timeZone).toBe(deviceTimeZone());

  // Review screen: the exam has no date, so the student types one.
  expect(texts(root)).toContain('Check what Cue found');
  expect(texts(root)).toContain('Canvas has no date for this exam.');
  await type(root, 'YYYY-MM-DD HH:mm', '2026-11-06 10:00');
  await press(root, 'Save 2 items');
  await flush();

  // The grid opens on today and the next two days; the homework is due on Tuesday.
  const shown = texts(root);
  expect(shown).toContain('Mon 2 Nov – Wed 4 Nov');
  expect(shown).toContain('Tue 3 Nov');
  expect(shown).toContain('SQL homework');
  expect(shown).not.toContain('Exam: Midterm Exam');
  expect(shown).not.toContain('Needs a date');

  // The exam on Friday is on the next page.
  await press(root, '›');
  await flush();
  expect(texts(root)).toContain('Thu 5 Nov – Sat 7 Nov');
  expect(texts(root)).toContain('Exam: Midterm Exam');

  await act(async () => {
    tree!.unmount();
  });
});

it('opens the school Canvas settings page in the app so the student can make a token on the phone', async () => {
  const server = fakeServer();
  const client = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);

  let tree: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<App client={client} />);
  });
  await flush();
  const root = tree!.root;

  expect(isDisabled(root, 'Open Canvas to create a token')).toBe(true);
  await type(root, 'yourschool.instructure.com', 's.instructure.com');
  expect(isDisabled(root, 'Open Canvas to create a token')).toBe(false);
  await press(root, 'Open Canvas to create a token');
  expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://s.instructure.com/profile/settings');

  await act(async () => {
    tree!.unmount();
  });
});

it('lets a student skip Canvas and add an exam by hand', async () => {
  const server = fakeServer();
  const client = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);

  let tree: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<App client={client} />);
  });
  await flush();
  const root = tree!.root;

  await press(root, "Skip – I'll add dates by hand");
  await flush();
  await press(root, 'Add');
  await type(root, 'e.g. Statistics midterm', 'Stats quiz');
  await press(root, 'Exam');
  await type(root, 'YYYY-MM-DD HH:mm', '2026-11-04 14:00');
  await press(root, 'Save');
  await flush();

  expect(server.state.items[0]).toMatchObject({ title: 'Stats quiz', kind: 'exam' });
  expect(texts(root)).toContain('Exam: Stats quiz');

  await act(async () => {
    tree!.unmount();
  });
});
