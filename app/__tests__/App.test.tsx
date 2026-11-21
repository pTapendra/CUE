/**
 * @format
 */

import React from 'react';
import { ActivityIndicator } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import * as WebBrowser from 'expo-web-browser';
import App from '../App';
import { ApiClient, type TokenStore } from '../src/api/client';
import { deviceTimeZone } from '../src/timeZone';
import { fakeServer, memoryStore } from '../test-support/fakeServer';
import { flush, isDisabled, press, tap, texts, type } from '../test-support/ui';

jest.useFakeTimers({ now: new Date(2026, 10, 2, 9, 0), doNotFake: ['nextTick', 'setImmediate'] });

// Opening a real browser is not possible in tests; record where the app tries to go.
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'dismiss' })) }));

type Node = ReactTestRenderer.ReactTestInstance;

const HEADLINE = 'Know what to study, and when.';
const SKIP = 'Skip for now · add dates by hand';
const TABS = ['Today', 'Schedule', 'Courses'];

let tree: ReactTestRenderer.ReactTestRenderer | undefined;

/** Starts the app against `server`. A restart passes the same `store`, as the phone keeps it. */
async function launch(server = fakeServer(), store: TokenStore = memoryStore(), fetchImpl = server.fetchImpl) {
  const client = new ApiClient('http://cue.test', store, fetchImpl);
  await act(async () => {
    tree = ReactTestRenderer.create(<App client={client} />);
  });
  await flush();
  return { server, store, root: tree!.root };
}

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  tree = undefined;
});

/** The label of the tab on screen, or undefined when the tabs are not showing. */
function selectedTab(root: Node): string | undefined {
  const tab = root.findAll((n) => n.props['aria-selected'] === true && typeof n.props.onPress === 'function')[0];
  return tab ? texts(tab).find((t) => TABS.includes(t)) : undefined;
}

function tokenForms(root: Node): number {
  return root.findAll((n) => n.props.placeholder === 'Paste your token').length;
}

describe('first launch', () => {
  it('shows Welcome, outside the tabs', async () => {
    const server = fakeServer();
    server.state.loginAvailable = true;
    const { root } = await launch(server);

    const shown = texts(root);
    expect(shown).toContain(HEADLINE);
    expect(shown).toContain('Log in with Canvas');
    expect(shown).toContain(SKIP);
    expect(shown).toContain("No name or email needed. Your Canvas access stays on Cue's server, not this phone.");
    expect(shown).not.toContain('Connect Canvas');
    expect(selectedTab(root)).toBeUndefined();
  });

  it('Skip goes to the tabs, and the next launch skips Welcome', async () => {
    const server = fakeServer();
    const { root, store } = await launch(server);

    await press(root, SKIP);
    await flush();
    expect(texts(root)).toEqual(expect.arrayContaining(TABS));
    expect(selectedTab(root)).toBe('Today');
    expect(texts(root)).not.toContain(HEADLINE);

    await act(async () => {
      tree!.unmount();
    });
    const restarted = await launch(server, store);
    expect(selectedTab(restarted.root)).toBe('Today');
    expect(texts(restarted.root)).not.toContain(HEADLINE);
  });

  it('a connected student starts on the tabs', async () => {
    const server = fakeServer();
    server.state.connected = true;
    const { root } = await launch(server);

    expect(texts(root)).toEqual(expect.arrayContaining(TABS));
    expect(selectedTab(root)).toBe('Today');
    expect(texts(root)).not.toContain(HEADLINE);
  });

  it('in token mode, Connect Canvas opens the token form, and Cancel goes back to Welcome', async () => {
    const { root } = await launch();
    expect(texts(root)).toContain('Connect Canvas');
    expect(texts(root)).not.toContain('Log in with Canvas');
    expect(tokenForms(root)).toBe(0);

    await press(root, 'Connect Canvas');
    await flush();
    expect(tokenForms(root)).toBeGreaterThan(0);

    await press(root, 'Cancel');
    await flush();
    expect(tokenForms(root)).toBe(0);
    expect(texts(root)).toContain(HEADLINE);
  });

  it('shows a spinner while starting, then the error with Try again, which starts again', async () => {
    const server = fakeServer();
    let release!: (ok: boolean) => void;
    let reply = new Promise<boolean>((resolve) => (release = resolve));
    const gated = (async (url: string, init?: RequestInit) => {
      if (!(await reply)) throw new TypeError('Network request failed');
      return server.fetchImpl(url, init);
    }) as unknown as typeof fetch;
    const { root } = await launch(server, memoryStore(), gated);
    expect(root.findAllByType(ActivityIndicator)).toHaveLength(1);
    expect(texts(root)).not.toContain(HEADLINE);

    await act(async () => release(false));
    await flush();
    expect(texts(root)).toContain('Cannot reach the Cue server. Check your connection and try again.');

    reply = Promise.resolve(true);
    await press(root, 'Try again');
    await flush();
    expect(texts(root)).toContain(HEADLINE);
  });

  it("sends the phone's time zone to the Planner at startup", async () => {
    const { server } = await launch();
    const zonePut = server.state.calls.find((c) => c.method === 'PUT' && c.path === '/api/planner/settings');
    expect((zonePut!.body as { timeZone: string }).timeZone).toBe(deviceTimeZone());
  });

  it('starts without waiting for the time zone to be sent', async () => {
    const server = fakeServer();
    // The Planner settings never answer; everything else does.
    const slowSettings = ((url: string, init?: RequestInit) =>
      new URL(url).pathname === '/api/planner/settings' ? new Promise(() => {}) : server.fetchImpl(url, init)) as unknown as typeof fetch;
    const { root } = await launch(server, memoryStore(), slowSettings);
    expect(texts(root)).toContain(HEADLINE);
    expect(texts(root)).toContain('Connect Canvas');
  });
});

it('opens the school Canvas settings page in the app so the student can make a token on the phone', async () => {
  const { root } = await launch();
  await press(root, 'Connect Canvas');
  await flush();

  expect(isDisabled(root, 'Open Canvas to create a token')).toBe(true);
  await type(root, 'yourschool.instructure.com', 's.instructure.com');
  expect(isDisabled(root, 'Open Canvas to create a token')).toBe(false);
  await press(root, 'Open Canvas to create a token');
  expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://s.instructure.com/profile/settings');
});

it('lets a student skip Canvas and add an exam by hand', async () => {
  const { server, root } = await launch();

  await press(root, SKIP);
  await flush();
  expect(selectedTab(root)).toBe('Today');
  await tap(root, 'Add');
  await type(root, 'e.g. Statistics midterm', 'Stats quiz');
  await press(root, 'Exam');
  // The date comes from the picker, not from typing.
  await act(async () => {
    root.findAll((n) => n.props.accessibilityLabel === 'Due or exam date' && typeof n.props.onPress === 'function')[0].props.onPress();
  });
  await act(async () => {
    root.findAllByType('DateTimePicker' as never)[0].props.onChange({ type: 'set' }, new Date(2026, 10, 4, 14, 0));
  });
  await press(root, 'Done');
  await press(root, 'Save');
  await flush();

  expect(server.state.items[0]).toMatchObject({ title: 'Stats quiz', kind: 'exam' });
  // Due on Wednesday: Today lists it as due soon, and Schedule shows it on its day.
  expect(texts(root)).toEqual(expect.arrayContaining(['Due soon', 'Stats quiz', 'Exam', 'Wed 4 Nov, 14:00']));
  await press(root, 'Schedule');
  await flush();
  expect(texts(root)).toContain('Exam: Stats quiz');
});

describe('Log in with Canvas', () => {
  const authorizeUrl = 'https://canvas.test/login/oauth2/auth?client_id=1&state=s1';
  const codeUrl = 'https://canvas.test/login/oauth2/auth?code=good-code&state=s1';

  async function openLogin() {
    const server = fakeServer();
    server.state.loginAvailable = true;
    const { root } = await launch(server);
    await press(root, 'Log in with Canvas');
    await flush();
    const webView = () => root.findByType('WebView' as any);
    return { server, root, webView };
  }

  it("shows a spinner while Canvas's pages load", async () => {
    const { root, webView } = await openLogin();
    expect(texts(root)).toContain('Loading Canvas…');
    await act(async () => {
      webView().props.onLoadEnd({ nativeEvent: {} });
    });
    expect(texts(root)).not.toContain('Loading Canvas…');
    await act(async () => {
      webView().props.onLoadStart({ nativeEvent: {} });
    });
    expect(texts(root)).toContain('Loading Canvas…');
  });

  it('shows the Canvas address with a lock under the header', async () => {
    const { root } = await openLogin();
    expect(texts(root)).toContain('Log in to Canvas');
    expect(texts(root)).toContain('canvas.test');
    expect(root.findAll((n) => n.props.name === 'lock-closed').length).toBeGreaterThan(0);
  });

  it('logs in with Canvas and goes to the review screen', async () => {
    const server = fakeServer();
    server.state.loginAvailable = true;
    const { root } = await launch(server);
    expect(texts(root)).toContain('Log in with Canvas');
    expect(tokenForms(root)).toBe(0);
    expect(root.findAll((n) => n.props.placeholder === 'yourschool.instructure.com')).toHaveLength(0);

    await press(root, 'Log in with Canvas');
    await flush();
    const web = root.findByType('WebView' as any);
    expect(web.props.source.uri).toBe(authorizeUrl);
    expect(web.props.incognito).toBe(true);
    expect(web.props.onShouldStartLoadWithRequest({ url: authorizeUrl })).toBe(true);
    let allowed = true;
    await act(async () => {
      allowed = web.props.onShouldStartLoadWithRequest({ url: codeUrl });
    });
    expect(allowed).toBe(false);
    await flush();
    expect(texts(root)).toContain('Check what Cue found');
    const finish = server.state.calls.filter((c) => c.method === 'POST' && c.path === '/api/canvas/login/finish');
    expect(finish).toHaveLength(1);
    expect(finish[0].body).toEqual({ code: 'good-code', state: 's1' });
  });

  it('finishes once when both web view callbacks report the return address', async () => {
    const { server, webView } = await openLogin();
    await act(async () => {
      webView().props.onNavigationStateChange({ url: codeUrl });
      webView().props.onShouldStartLoadWithRequest({ url: codeUrl });
    });
    await flush();
    const finish = server.state.calls.filter((c) => c.method === 'POST' && c.path === '/api/canvas/login/finish');
    expect(finish).toHaveLength(1);
  });

  it('finishes from onNavigationStateChange alone', async () => {
    const { server, root, webView } = await openLogin();
    await act(async () => {
      webView().props.onNavigationStateChange({ url: codeUrl });
    });
    await flush();
    expect(texts(root)).toContain('Check what Cue found');
    const finish = server.state.calls.filter((c) => c.method === 'POST' && c.path === '/api/canvas/login/finish');
    expect(finish).toHaveLength(1);
  });

  it('denying Cue returns to Welcome with a message', async () => {
    const { root } = await openLogin();
    await act(async () => {
      root.findByType('WebView' as any).props.onShouldStartLoadWithRequest({
        url: 'https://canvas.test/login/oauth2/auth?error=access_denied&state=s1',
      });
    });
    await flush();
    expect(texts(root)).toContain("You didn't allow Cue to read Canvas.");
    expect(texts(root)).toContain(HEADLINE);
    expect(root.findAllByType('WebView' as any)).toHaveLength(0);
  });

  it('Cancel closes the login without a message', async () => {
    const { root } = await openLogin();
    expect(isDisabled(root, 'Cancel')).toBe(false);
    await press(root, 'Cancel');
    await flush();
    expect(root.findAllByType('WebView' as any)).toHaveLength(0);
    expect(texts(root)).toContain('Log in with Canvas');
    expect(texts(root)).not.toContain("You didn't allow Cue to read Canvas.");
  });

  it('disables Cancel while the login is being finished', async () => {
    const { root, webView } = await openLogin();
    act(() => {
      webView().props.onShouldStartLoadWithRequest({ url: codeUrl });
    });
    // The finish call has started but not settled yet.
    expect(isDisabled(root, 'Cancel')).toBe(true);
    await flush();
  });
});

it('the login screen gets the Cue user agent for an ngrok Canvas address', async () => {
  const server = fakeServer();
  server.state.loginAvailable = true;
  server.state.loginUrl = 'https://demo.ngrok-free.dev';
  const { root } = await launch(server);
  await press(root, 'Log in with Canvas');
  await flush();
  const web = root.findByType('WebView' as any);
  expect(web.props.source.uri).toBe('https://demo.ngrok-free.dev/login/oauth2/auth?client_id=1&state=s1');
  expect(web.props.userAgent).toMatch(/^CueApp\//);
  expect(texts(root)).toContain('demo.ngrok-free.dev');
});

describe('Settings, from the gear on Today', () => {
  it('loads Today and the schedule again after study times are saved', async () => {
    const server = fakeServer();
    server.state.connected = true;
    const { root } = await launch(server);
    const loads = (path: string) => server.state.calls.filter((c) => c.path === path).length;
    await press(root, 'Schedule');
    await flush();
    await press(root, 'Today');
    await flush();
    const overviewLoads = loads('/api/schedule/overview');
    const weekLoads = loads('/api/schedule/week');

    await tap(root, 'Settings');
    await press(root, 'Study times');
    await flush();
    await press(root, 'Save');
    await flush();
    await press(root, 'Done');
    await flush();
    expect(texts(root)).not.toContain('Save');
    expect(selectedTab(root)).toBe('Today');
    expect(loads('/api/schedule/overview')).toBe(overviewLoads + 1);

    await press(root, 'Schedule');
    await flush();
    expect(loads('/api/schedule/week')).toBe(weekLoads + 1);
  });
});

describe('the Schedule tab', () => {
  async function openSchedule(loginAvailable = false) {
    const server = fakeServer();
    server.state.connected = true;
    server.state.loginAvailable = loginAvailable;
    const { root } = await launch(server);
    await press(root, 'Schedule');
    await flush();
    return { server, root };
  }

  it.each([
    ['Save 2 items', 'Today'],
    ['Cancel', 'Schedule'],
  ])('a sync from Schedule: %s goes to %s', async (button, tab) => {
    const { root } = await openSchedule();
    await press(root, 'Sync');
    await flush();
    expect(texts(root)).toContain('Check what Cue found');

    await press(root, button);
    await flush();
    expect(texts(root)).not.toContain('Check what Cue found');
    expect(selectedTab(root)).toBe(tab);
  });
});
