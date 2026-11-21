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
import { flush, isDisabled, press, texts, type } from '../test-support/ui';

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

it('connects Canvas with a token, confirms items with a missing exam date, lands on Today, and the week shows them', async () => {
  const { server, root } = await launch();
  expect(texts(root)).toContain('Connect Canvas');
  await press(root, 'Connect Canvas');
  await flush();

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
  expect(selectedTab(root)).toBe('Today');
  expect(texts(root)).not.toContain('Check what Cue found');
  expect(tokenForms(root)).toBe(0);

  // The grid opens on today and the next two days; the homework is due on Tuesday.
  await press(root, 'Schedule');
  await flush();
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
  await press(root, 'Schedule');
  await flush();
  await press(root, 'Add');
  await type(root, 'e.g. Statistics midterm', 'Stats quiz');
  await press(root, 'Exam');
  await type(root, 'YYYY-MM-DD HH:mm', '2026-11-04 14:00');
  await press(root, 'Save');
  await flush();

  expect(server.state.items[0]).toMatchObject({ title: 'Stats quiz', kind: 'exam' });
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

  it.each(['Save 2 items', 'Cancel'])('after logging in, %s on the review lands on Today, not Welcome', async (button) => {
    const { root, webView } = await openLogin();
    await act(async () => {
      webView().props.onShouldStartLoadWithRequest({ url: codeUrl });
    });
    await flush();
    expect(texts(root)).toContain('Check what Cue found');

    await press(root, button);
    await flush();
    expect(selectedTab(root)).toBe('Today');
    expect(texts(root)).not.toContain('Check what Cue found');
    expect(texts(root)).not.toContain(HEADLINE);
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

describe('Logging in again from the sync screen', () => {
  const codeUrl = 'https://canvas.test/login/oauth2/auth?code=good-code&state=s1';
  const refused = "Canvas no longer accepts Cue's access. Connect again.";

  // Opens the app already connected, goes to the week in the Schedule tab, with the
  // next sync failing as given, and presses Sync Canvas.
  async function syncFailing(syncError: { status: number; error: string }, loginAvailable: boolean) {
    const server = fakeServer();
    server.state.connected = true;
    server.state.loginAvailable = loginAvailable;
    server.state.syncError = syncError;
    const { root } = await launch(server);
    await press(root, 'Schedule');
    await flush();
    await press(root, 'Sync Canvas');
    await flush();
    return { server, root };
  }

  it('a sync Canvas refuses offers Log in with Canvas, then shows the items', async () => {
    const { root } = await syncFailing({ status: 409, error: 'canvas_token_rejected' }, true);
    expect(texts(root)).toContain(refused);
    expect(texts(root)).toContain('Log in with Canvas');

    await press(root, 'Log in with Canvas');
    await flush();
    let load = true;
    await act(async () => {
      load = root.findByType('WebView' as any).props.onShouldStartLoadWithRequest({ url: codeUrl });
    });
    expect(load).toBe(false);
    await flush();

    expect(texts(root)).toContain('SQL homework');
    expect(texts(root)).not.toContain(refused);
  });

  it('without login settings the button opens the token form', async () => {
    const { root } = await syncFailing({ status: 409, error: 'canvas_token_rejected' }, false);
    await press(root, 'Connect Canvas');
    await flush();
    expect(tokenForms(root)).toBeGreaterThan(0);
  });

  it("other sync failures don't offer a login", async () => {
    const { root } = await syncFailing({ status: 502, error: 'canvas_unavailable' }, true);
    expect(texts(root)).toContain('Canvas is not responding right now. Your saved schedule is still here.');
    expect(texts(root)).not.toContain('Log in with Canvas');
    expect(texts(root)).not.toContain('Connect Canvas');
  });
});

describe('the week in the Schedule tab', () => {
  async function openWeek(loginAvailable = false) {
    const server = fakeServer();
    server.state.connected = true;
    server.state.loginAvailable = loginAvailable;
    const { root } = await launch(server);
    await press(root, 'Schedule');
    await flush();
    return { server, root };
  }

  it("the ⚙ menu's Canvas connection opens Welcome, and the token form has the school's address", async () => {
    const { root } = await openWeek();
    await press(root, '⚙');
    await press(root, 'Canvas connection');
    await flush();
    expect(texts(root)).toContain(HEADLINE);

    await press(root, 'Connect Canvas');
    await flush();
    const address = root.find(
      (n) => n.props.placeholder === 'yourschool.instructure.com' && typeof n.props.onChangeText === 'function',
    );
    expect(address.props.value).toBe('https://s.instructure.com');
  });

  it.each([
    ['Save 2 items', 'Today'],
    ['Cancel', 'Schedule'],
  ])('a sync from the week: %s goes to %s', async (button, tab) => {
    const { root } = await openWeek();
    await press(root, 'Sync Canvas');
    await flush();
    expect(texts(root)).toContain('Check what Cue found');

    await press(root, button);
    await flush();
    expect(texts(root)).not.toContain('Check what Cue found');
    expect(selectedTab(root)).toBe(tab);
  });

  it('loads the week again after study times are saved', async () => {
    const { server, root } = await openWeek();
    const weekLoads = () => server.state.calls.filter((c) => c.path === '/api/schedule/week').length;
    const loads = weekLoads();

    await press(root, '⚙');
    await press(root, 'Study times');
    await flush();
    await press(root, 'Save and plan');
    await flush();
    expect(texts(root)).not.toContain('Save and plan');
    expect(selectedTab(root)).toBe('Schedule');
    expect(weekLoads()).toBe(loads + 1);
  });
});
