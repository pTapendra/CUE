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

it('starts without waiting for the time zone to be sent', async () => {
  const server = fakeServer();
  // The Planner settings never answer; everything else does.
  const slowSettings = ((url: string, init?: RequestInit) =>
    new URL(url).pathname === '/api/planner/settings' ? new Promise(() => {}) : server.fetchImpl(url, init)) as unknown as typeof fetch;
  const client = new ApiClient('http://cue.test', memoryStore(), slowSettings);

  let tree: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<App client={client} />);
  });
  await flush();
  expect(texts(tree!.root)).toContain('Connect Canvas');

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

describe('Log in with Canvas', () => {
  const authorizeUrl = 'https://canvas.test/login/oauth2/auth?client_id=1&state=s1';
  const codeUrl = 'https://canvas.test/login/oauth2/auth?code=good-code&state=s1';

  async function openLogin() {
    const server = fakeServer();
    server.state.loginAvailable = true;
    const client = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);
    let tree: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(<App client={client} />);
    });
    await flush();
    const root = tree!.root;
    await press(root, 'Log in with Canvas');
    await flush();
    const webView = () => root.findByType('WebView' as any);
    return { server, tree: tree!, root, webView };
  }

  it('logs in with Canvas and goes to the review screen', async () => {
    const server = fakeServer();
    server.state.loginAvailable = true;
    const client = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);
    let tree: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(<App client={client} />);
    });
    await flush();
    const root = tree!.root;
    expect(texts(root)).toContain('Log in with Canvas');
    expect(root.findAll((n) => n.props.placeholder === 'Paste your token')).toHaveLength(0);
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
    await act(async () => {
      tree!.unmount();
    });
  });

  it('finishes once when both web view callbacks report the return address', async () => {
    const { server, tree, webView } = await openLogin();
    await act(async () => {
      webView().props.onNavigationStateChange({ url: codeUrl });
      webView().props.onShouldStartLoadWithRequest({ url: codeUrl });
    });
    await flush();
    const finish = server.state.calls.filter((c) => c.method === 'POST' && c.path === '/api/canvas/login/finish');
    expect(finish).toHaveLength(1);
    await act(async () => {
      tree.unmount();
    });
  });

  it('finishes from onNavigationStateChange alone', async () => {
    const { server, root, tree, webView } = await openLogin();
    await act(async () => {
      webView().props.onNavigationStateChange({ url: codeUrl });
    });
    await flush();
    expect(texts(root)).toContain('Check what Cue found');
    const finish = server.state.calls.filter((c) => c.method === 'POST' && c.path === '/api/canvas/login/finish');
    expect(finish).toHaveLength(1);
    await act(async () => {
      tree.unmount();
    });
  });

  it('denying Cue returns to Connect with a message', async () => {
    const { root, tree } = await openLogin();
    await act(async () => {
      root.findByType('WebView' as any).props.onShouldStartLoadWithRequest({
        url: 'https://canvas.test/login/oauth2/auth?error=access_denied&state=s1',
      });
    });
    await flush();
    expect(texts(root)).toContain("You didn't allow Cue to read Canvas.");
    expect(root.findAllByType('WebView' as any)).toHaveLength(0);
    await act(async () => {
      tree.unmount();
    });
  });

  it('Cancel closes the login without a message', async () => {
    const { root, tree } = await openLogin();
    expect(isDisabled(root, 'Cancel')).toBe(false);
    await press(root, 'Cancel');
    await flush();
    expect(root.findAllByType('WebView' as any)).toHaveLength(0);
    expect(texts(root)).toContain('Log in with Canvas');
    expect(texts(root)).not.toContain("You didn't allow Cue to read Canvas.");
    await act(async () => {
      tree.unmount();
    });
  });

  it('disables Cancel while the login is being finished', async () => {
    const { root, tree, webView } = await openLogin();
    act(() => {
      webView().props.onShouldStartLoadWithRequest({ url: codeUrl });
    });
    // The finish call has started but not settled yet.
    expect(isDisabled(root, 'Cancel')).toBe(true);
    await flush();
    await act(async () => {
      tree.unmount();
    });
  });
});

describe('Logging in again from the sync screen', () => {
  const codeUrl = 'https://canvas.test/login/oauth2/auth?code=good-code&state=s1';
  const refused = "Canvas no longer accepts Cue's access. Connect again.";

  // Opens the app already connected (on the Week screen), with the next sync
  // failing as given, and presses Sync Canvas.
  async function syncFailing(syncError: { status: number; error: string }, loginAvailable: boolean) {
    const server = fakeServer();
    server.state.connected = true;
    server.state.loginAvailable = loginAvailable;
    server.state.syncError = syncError;
    const client = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);
    let tree: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(<App client={client} />);
    });
    await flush();
    const root = tree!.root;
    await press(root, 'Sync Canvas');
    await flush();
    return { server, tree: tree!, root };
  }

  it('a sync Canvas refuses offers Log in with Canvas, then shows the items', async () => {
    const { root, tree } = await syncFailing({ status: 409, error: 'canvas_token_rejected' }, true);
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
    await act(async () => {
      tree.unmount();
    });
  });

  it('without login settings the button opens the token form', async () => {
    const { root, tree } = await syncFailing({ status: 409, error: 'canvas_token_rejected' }, false);
    await press(root, 'Connect Canvas');
    await flush();
    expect(root.findAll((n) => n.props.placeholder === 'Paste your token').length).toBeGreaterThan(0);
    await act(async () => {
      tree.unmount();
    });
  });

  it("other sync failures don't offer a login", async () => {
    const { root, tree } = await syncFailing({ status: 502, error: 'canvas_unavailable' }, true);
    expect(texts(root)).toContain('Canvas is not responding right now. Your saved schedule is still here.');
    expect(texts(root)).not.toContain('Log in with Canvas');
    expect(texts(root)).not.toContain('Connect Canvas');
    await act(async () => {
      tree.unmount();
    });
  });
});
