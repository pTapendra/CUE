/**
 * @format
 */

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import type { ProposedItem } from '../src/api/types';
import { ApiClient, type TokenStore } from '../src/api/client';
import { groupByCourse } from '../src/viewmodels/useSyncReview';
import { fakeServer, memoryStore } from '../test-support/fakeServer';
import { flush, isDisabled, press, tap, texts } from '../test-support/ui';

jest.useFakeTimers({ now: new Date(2026, 10, 2, 9, 0), doNotFake: ['nextTick', 'setImmediate'] });

type Node = ReactTestRenderer.ReactTestInstance;

const HEADLINE = 'Know what to study, and when.';
const TABS = ['Today', 'Schedule', 'Courses'];
const codeUrl = 'https://canvas.test/login/oauth2/auth?code=good-code&state=s1';

let tree: ReactTestRenderer.ReactTestRenderer | undefined;

async function launch(server = fakeServer(), store: TokenStore = memoryStore()) {
  const client = new ApiClient('http://cue.test', store, server.fetchImpl);
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

function selectedTab(root: Node): string | undefined {
  const tab = root.findAll((n) => n.props['aria-selected'] === true && typeof n.props.onPress === 'function')[0];
  return tab ? texts(tab).find((t) => TABS.includes(t)) : undefined;
}

function tokenForms(root: Node): number {
  return root.findAll((n) => n.props.placeholder === 'Paste your token').length;
}

/** Opens the app already connected, and starts a sync from the Schedule tab. */
async function openReview(setup?: (server: ReturnType<typeof fakeServer>) => void) {
  const server = fakeServer();
  server.state.connected = true;
  setup?.(server);
  const { root } = await launch(server);
  await press(root, 'Schedule');
  await flush();
  await press(root, 'Sync');
  await flush();
  return { server, root };
}

/** Picks a date in the DateTimeField labelled `label`, as the phone's picker would. */
async function pickDate(root: Node, label: string, date: Date) {
  await act(async () => root.findAll((n) => n.props.accessibilityLabel === label)[0].props.onPress());
  const picker = root.findAllByType('DateTimePicker' as never)[0];
  await act(async () => picker.props.onChange({ type: 'set' }, date));
}

function item(key: string, courseName: string): ProposedItem {
  return { key, courseName, kind: 'assignment', title: key, dueAt: null, needsDate: false, alreadyImported: false };
}

describe('groupByCourse', () => {
  it('groups by course in the order each course first appears', () => {
    const groups = groupByCourse([item('a', 'Databases'), item('b', 'Networks'), item('c', 'Databases')]);
    expect(groups.map((g) => g.courseName)).toEqual(['Databases', 'Networks']);
    expect(groups[0].items.map((i) => i.key)).toEqual(['a', 'c']);
    expect(groups[1].items.map((i) => i.key)).toEqual(['b']);
    expect(groupByCourse([])).toEqual([]);
  });
});

describe('Check what Cue found', () => {
  it('shows the count, the groups, the Exam tag and the missing-date prompt', async () => {
    const { root } = await openReview();
    const shown = texts(root);
    expect(shown).toContain('Check what Cue found');
    expect(shown).toContain("2 items from 2 courses. Untick anything you don't want.");
    expect(shown).toContain('DATABASES');
    expect(shown).toContain('SOFTWARE ENGINEERING');
    expect(shown).toContain('Exam');
    expect(shown).toContain('Canvas has no date for this exam');
    expect(shown).toContain('or add it later');
    expect(texts(root).some((t) => t.includes('YYYY'))).toBe(false);
  });

  it('counts the ticked items in the save button', async () => {
    const { root } = await openReview();
    expect(texts(root)).toContain('Save 2 items');
    await press(root, 'SQL homework');
    expect(texts(root)).toContain('Save 1 item');
    await press(root, 'Midterm Exam');
    expect(texts(root)).toContain('Save 0 items');
    expect(isDisabled(root, 'Save 0 items')).toBe(true);
    await press(root, 'SQL homework');
    expect(texts(root)).toContain('Save 1 item');
  });

  it('sends the date picked for an exam, and goes to Today with a toast', async () => {
    const { server, root } = await openReview();
    const picked = new Date(2026, 10, 6, 10, 0);
    await pickDate(root, 'Due date for Midterm Exam', picked);
    await press(root, 'Save 2 items');
    await flush();
    const confirm = server.state.calls.find((c) => c.path === '/api/canvas/sync/confirm')!;
    expect(confirm.body.accept).toEqual(['assignment:1', 'assignment:2']);
    expect(confirm.body.dates).toEqual({ 'assignment:2': picked.toISOString() });
    expect(selectedTab(root)).toBe('Today');
    expect(texts(root)).not.toContain('Check what Cue found');
    expect(texts(root)).toContain('2 items saved from Canvas');
  });

  it('saves an exam left without a date, and drops the date of an unticked exam', async () => {
    const { server, root } = await openReview();
    await pickDate(root, 'Due date for Midterm Exam', new Date(2026, 10, 6, 10, 0));
    await press(root, 'Midterm Exam');
    expect(texts(root)).not.toContain('or add it later');
    await press(root, 'Save 1 item');
    await flush();
    const confirm = server.state.calls.find((c) => c.path === '/api/canvas/sync/confirm')!;
    expect(confirm.body.accept).toEqual(['assignment:1']);
    expect(confirm.body.dates).toEqual({});
    expect(texts(root)).toContain('1 item saved from Canvas');
  });

  it('Cancel goes back to where the student was, without saving', async () => {
    const { server, root } = await openReview();
    await press(root, 'Cancel');
    await flush();
    expect(selectedTab(root)).toBe('Schedule');
    expect(texts(root)).not.toContain('Check what Cue found');
    expect(server.state.calls.some((c) => c.path === '/api/canvas/sync/confirm')).toBe(false);
  });

  it('connects Canvas with a token, picks an exam date, lands on Today, and the week shows the items', async () => {
    const { server, root } = await launch();
    await press(root, 'Connect Canvas');
    await flush();
    const typeInto = (placeholder: string, value: string) =>
      act(async () => {
        root.find((n) => n.props.placeholder === placeholder && typeof n.props.onChangeText === 'function').props.onChangeText(value);
      });
    await typeInto('yourschool.instructure.com', 's.instructure.com');
    await typeInto('Paste your token', 'good-token-123');
    await press(root, 'Connect and sync');
    await flush();
    expect(server.state.calls.find((c) => c.method === 'PUT' && c.path === '/api/canvas/connection')!.body).toEqual({
      baseUrl: 'https://s.instructure.com',
      token: 'good-token-123',
    });

    expect(texts(root)).toContain('Check what Cue found');
    expect(texts(root)).toContain('Canvas has no date for this exam');
    await pickDate(root, 'Due date for Midterm Exam', new Date(2026, 10, 6, 10, 0));
    await press(root, 'Save 2 items');
    await flush();
    expect(selectedTab(root)).toBe('Today');
    expect(tokenForms(root)).toBe(0);

    // Schedule opens on today and the next two days; the homework is due on Tuesday.
    await press(root, 'Schedule');
    await flush();
    const shown = texts(root);
    expect(shown).toContain('Mon 2 Nov – Wed 4 Nov');
    expect(root.findAll((n) => n.props.accessibilityLabel === 'Tue 3 Nov')).not.toHaveLength(0);
    expect(shown).toContain('SQL homework');
    expect(shown).not.toContain('Exam: Midterm Exam');
    expect(shown).not.toContain('Needs a date'); // items without a date are on Today

    // The exam on Friday is on the next page.
    await tap(root, 'Next days');
    await flush();
    expect(texts(root)).toContain('Thu 5 Nov – Sat 7 Nov');
    expect(texts(root)).toContain('Exam: Midterm Exam');
    expect(server.state.items).toHaveLength(2);
  });

  describe('after logging in from Welcome', () => {
    async function loginFromWelcome() {
      const server = fakeServer();
      server.state.loginAvailable = true;
      const { root } = await launch(server);
      await press(root, 'Log in with Canvas');
      await flush();
      await act(async () => {
        root.findByType('WebView' as any).props.onShouldStartLoadWithRequest({ url: codeUrl });
      });
      await flush();
      return root;
    }

    it.each(['Save 2 items', 'Cancel'])('%s on the review lands on Today, not Welcome', async (button) => {
      const root = await loginFromWelcome();
      expect(texts(root)).toContain('Check what Cue found');
      await press(root, button);
      await flush();
      expect(selectedTab(root)).toBe('Today');
      expect(texts(root)).not.toContain('Check what Cue found');
      expect(texts(root)).not.toContain(HEADLINE);
    });
  });
});

describe('Logging in again from the sync screen', () => {
  const refused = "Canvas no longer accepts Cue's access. Connect again.";

  function syncFailing(syncError: { status: number; error: string }, loginAvailable: boolean) {
    return openReview((server) => {
      server.state.loginAvailable = loginAvailable;
      server.state.syncError = syncError;
    });
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
