/**
 * @format
 */

import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import type { ChangedItem, ProposedItem, RemovedItem, SyncPreview } from '../src/api/types';
import { ApiClient, type TokenStore } from '../src/api/client';
import { describeChange, groupByCourse, savedToast, summaryLine } from '../src/viewmodels/useSyncReview';
import { fakeServer, memoryStore } from '../test-support/fakeServer';
import { flush, isDisabled, onScreen, press, tap, texts, type } from '../test-support/ui';

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
  await tap(root, 'Sync');
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
  return { key, courseName, kind: 'assignment', title: key, dueAt: null, needsDate: false };
}

/** Local times, as the phone shows them. */
const FRI_2359 = new Date(2026, 10, 27, 23, 59).toISOString();
const MON_2359 = new Date(2026, 10, 30, 23, 59).toISOString();

const HW3: ChangedItem = {
  key: 'assignment:7',
  courseName: 'Databases',
  kind: 'assignment',
  title: 'HW 3',
  changes: [{ field: 'dueAt', from: FRI_2359, to: MON_2359 }],
};
const LAB2: RemovedItem = { key: 'assignment:8', courseName: 'Networks', kind: 'assignment', title: 'Lab 2', dueAt: null };

function preview(parts: Partial<SyncPreview>): SyncPreview {
  return { syncId: 's', newItems: [], changed: [], removed: [], skipped: [], ...parts };
}

describe('summaryLine, savedToast and describeChange', () => {
  it('summaryLine gives the counts that are not zero', () => {
    expect(summaryLine(preview({ newItems: [item('a', 'Databases')], changed: [HW3] }))).toBe('1 new, 1 changed');
    expect(summaryLine(preview({ removed: [LAB2, { ...LAB2, key: 'x' }] }))).toBe('2 removed');
    expect(summaryLine(preview({ skipped: [item('a', 'Databases')] }))).toBe('');
  });

  it('savedToast gives the counts that are not zero, or Saved', () => {
    expect(savedToast({ added: 1, updated: 0, removed: 2 })).toBe('1 added, 2 removed');
    expect(savedToast({ added: 2, updated: 1, removed: 0 })).toBe('2 added, 1 updated');
    expect(savedToast({ added: 0, updated: 0, removed: 0 })).toBe('Saved');
  });

  it('describeChange shows and speaks each kind of change', () => {
    expect(describeChange({ field: 'dueAt', from: FRI_2359, to: MON_2359 })).toEqual({
      shown: 'Due: Fri 27 Nov · 23:59 → Mon 30 Nov · 23:59',
      spoken: 'due date changed from Fri 27 Nov, 23:59 to Mon 30 Nov, 23:59',
    });
    expect(describeChange({ field: 'dueAt', from: null, to: MON_2359 }).shown).toBe('Due: no date → Mon 30 Nov · 23:59');
    expect(describeChange({ field: 'endsAt', from: FRI_2359, to: null })).toEqual({
      shown: 'Ends: Fri 27 Nov · 23:59 → no end',
      spoken: 'end changed from Fri 27 Nov, 23:59 to no end',
    });
    expect(describeChange({ field: 'allDay', from: false, to: true })).toEqual({ shown: 'All day: No → Yes', spoken: 'all day changed from no to yes' });
    expect(describeChange({ field: 'title', from: 'HW 3', to: 'Homework 3' })).toEqual({
      shown: 'Title: HW 3 → Homework 3',
      spoken: 'title changed from HW 3 to Homework 3',
    });
  });
});

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
    expect(shown).toContain('2 new');
    expect(shown).toContain('New');
    expect(shown).toContain('DATABASES');
    expect(shown).toContain('SOFTWARE ENGINEERING');
    expect(shown).toContain('Exam');
    expect(shown).toContain('Canvas has no date for this exam');
    expect(shown).toContain('or add it later');
    expect(texts(root).some((t) => t.includes('YYYY'))).toBe(false);
  });

  it('reads each item to a screen reader with its Exam tag and its date', async () => {
    const { root } = await openReview((server) => {
      server.state.preview.newItems.push({
        key: 'assignment:3',
        courseName: 'Databases',
        kind: 'exam',
        title: 'DB quiz',
        dueAt: '2026-11-04T15:00:00.000Z',
        needsDate: false,
      });
    });
    const labels = onScreen(root, (n) => n.props.accessibilityRole === 'checkbox' && typeof n.props.onPress === 'function').map(
      (n) => n.props.accessibilityLabel,
    );
    expect(labels).toEqual([
      'SQL homework, Tue 3 Nov, 16:00',
      'DB quiz, exam, Wed 4 Nov, 09:00',
      'Midterm Exam, exam, no date',
    ]);
  });

  it('Save stays enabled with every new item unticked, and sends no accepted keys', async () => {
    const { server, root } = await openReview();
    await press(root, 'SQL homework');
    await press(root, 'Midterm Exam');
    expect(isDisabled(root, 'Save')).toBe(false);
    await press(root, 'Save');
    await flush();
    const confirm = server.state.calls.find((c) => c.path === '/api/canvas/sync/confirm')!;
    expect(confirm.body.accept).toEqual([]);
    expect(texts(root)).toContain('Saved');
  });

  it('shows changed items with each change, and removed items, without checkboxes', async () => {
    const { root } = await openReview((server) => {
      server.state.preview.changed.push(HW3);
      server.state.preview.removed.push(LAB2);
    });
    const shown = texts(root);
    expect(shown).toContain('2 new, 1 changed, 1 removed');
    for (const text of ['New', 'Changed', 'Removed from Canvas', 'HW 3', 'Due: Fri 27 Nov · 23:59 → Mon 30 Nov · 23:59', 'Lab 2', 'Networks', 'Will be removed from Cue']) {
      expect(shown).toContain(text);
    }
    const checkboxes = onScreen(root, (n) => n.props.accessibilityRole === 'checkbox' && typeof n.props.onPress === 'function');
    expect(checkboxes.map((n) => n.props.accessibilityLabel)).toEqual(['SQL homework, Tue 3 Nov, 16:00', 'Midterm Exam, exam, no date']);
    const labels = onScreen(root, (n) => typeof n.props.accessibilityLabel === 'string').map((n) => n.props.accessibilityLabel);
    expect(labels).toContain('HW 3, due date changed from Fri 27 Nov, 23:59 to Mon 30 Nov, 23:59');
    expect(labels).toContain('Lab 2, will be removed from Cue');
  });

  it('when nothing is new, Sync stays on Schedule and says In sync with Canvas', async () => {
    const { server, root } = await openReview((s) => {
      s.state.preview.newItems = [];
    });
    expect(texts(root)).not.toContain('Check what Cue found');
    expect(texts(root)).toContain('In sync with Canvas');
    expect(selectedTab(root)).toBe('Schedule');
    expect(server.state.calls.some((c) => c.path === '/api/canvas/sync/confirm')).toBe(false);
  });

  it('opened with what the sync read, the review does not read Canvas again', async () => {
    const { server } = await openReview();
    expect(server.state.calls.filter((c) => c.method === 'POST' && c.path === '/api/canvas/sync')).toHaveLength(1);
  });

  it('with only skipped items, Show opens the review, which says Cue is up to date; Done closes without saving', async () => {
    const { server, root } = await openReview((s) => {
      s.state.preview.skipped = s.state.preview.newItems;
      s.state.preview.newItems = [];
    });
    await press(root, 'Show');
    await flush();
    expect(texts(root)).toContain('Cue is up to date with Canvas.');
    expect(texts(root)).not.toContain('Save');
    expect(texts(root)).not.toContain('Cancel');
    await press(root, 'Done');
    await flush();
    expect(selectedTab(root)).toBe('Schedule');
    expect(texts(root)).not.toContain('Check what Cue found');
    expect(server.state.calls.some((c) => c.path === '/api/canvas/sync/confirm')).toBe(false);
  });

  it('Show 2 skipped reveals them unticked; ticking one sends it', async () => {
    const { server, root } = await openReview((s) => {
      s.state.preview.skipped = s.state.preview.newItems;
      s.state.preview.newItems = [];
    });
    await press(root, 'Show');
    await flush();
    expect(texts(root)).toContain('Cue is up to date with Canvas.');
    await press(root, 'Show 2 skipped');
    expect(texts(root)).toContain('Skipped');
    const boxes = onScreen(root, (n) => n.props.accessibilityRole === 'checkbox' && typeof n.props.onPress === 'function');
    expect(boxes.map((n) => n.props.accessibilityState.checked)).toEqual([false, false]);
    expect(texts(root)).toContain('Done');

    await press(root, 'SQL homework');
    await press(root, 'Save');
    await flush();
    const confirm = server.state.calls.find((c) => c.path === '/api/canvas/sync/confirm')!;
    expect(confirm.body.accept).toEqual(['assignment:1']);
    expect(texts(root)).toContain('1 added');
  });

  it('the toast after Save gives the counts', async () => {
    const { root } = await openReview((s) => {
      s.state.preview.changed.push(HW3);
    });
    await press(root, 'Save');
    await flush();
    expect(texts(root)).toContain('2 added, 1 updated');
  });

  it('sends the date picked for an exam, and goes to Today with a toast', async () => {
    const { server, root } = await openReview();
    const picked = new Date(2026, 10, 6, 10, 0);
    await pickDate(root, 'Due date for Midterm Exam', picked);
    await press(root, 'Save');
    await flush();
    const confirm = server.state.calls.find((c) => c.path === '/api/canvas/sync/confirm')!;
    expect(confirm.body.accept).toEqual(['assignment:1', 'assignment:2']);
    expect(confirm.body.dates).toEqual({ 'assignment:2': picked.toISOString() });
    expect(selectedTab(root)).toBe('Today');
    expect(texts(root)).not.toContain('Check what Cue found');
    expect(texts(root)).toContain('2 added');
  });

  it("Remove date takes an exam's date away again, back to Add date", async () => {
    const { server, root } = await openReview();
    expect(texts(root)).toContain('Add date');
    expect(texts(root)).not.toContain('Remove date');
    await pickDate(root, 'Due date for Midterm Exam', new Date(2026, 10, 6, 10, 0));
    expect(texts(root)).not.toContain('Add date');

    await tap(root, 'Remove date');
    expect(texts(root)).toContain('Add date');
    expect(texts(root)).toContain('or add it later');
    await press(root, 'Save');
    await flush();
    const confirm = server.state.calls.find((c) => c.path === '/api/canvas/sync/confirm')!;
    expect(confirm.body.dates).toEqual({});
  });

  it('saves an exam left without a date, and drops the date of an unticked exam', async () => {
    const { server, root } = await openReview();
    await pickDate(root, 'Due date for Midterm Exam', new Date(2026, 10, 6, 10, 0));
    await press(root, 'Midterm Exam');
    expect(texts(root)).not.toContain('or add it later');
    await press(root, 'Save');
    await flush();
    const confirm = server.state.calls.find((c) => c.path === '/api/canvas/sync/confirm')!;
    expect(confirm.body.accept).toEqual(['assignment:1']);
    expect(confirm.body.dates).toEqual({});
    expect(texts(root)).toContain('1 added');
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
    await press(root, 'Save');
    await flush();
    expect(selectedTab(root)).toBe('Today');
    expect(tokenForms(root)).toBe(0);

    // Schedule opens on today and the next two days; the homework is due on Tuesday.
    await press(root, 'Schedule');
    await flush();
    const shown = texts(root);
    expect(shown).toContain('Mon 2 Nov – Wed 4 Nov');
    expect(onScreen(root, (n) => n.props.accessibilityLabel === 'Tue 3 Nov')).not.toHaveLength(0);
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

    it.each(['Save', 'Cancel'])('%s on the review lands on Today, not Welcome', async (button) => {
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

describe('after connecting with a token from Welcome', () => {
  async function connectFromWelcome() {
    const { root } = await launch();
    await press(root, 'Connect Canvas');
    await flush();
    await type(root, 'yourschool.instructure.com', 's.instructure.com');
    await type(root, 'Paste your token', 'good-token-123');
    await press(root, 'Connect and sync');
    await flush();
    return root;
  }

  it("leaves no Welcome under the review, so Android's Back can't return to it", async () => {
    const root = await connectFromWelcome();
    expect(texts(root)).toContain('Check what Cue found');
    // Every screen in the stack stays mounted; Welcome is not among them.
    expect(root.findAll((n) => n.type === Text && n.props.children === HEADLINE)).toHaveLength(0);
  });

  it.each(['Save', 'Cancel'])('%s on the review lands on Today', async (button) => {
    const root = await connectFromWelcome();
    await press(root, button);
    await flush();
    expect(selectedTab(root)).toBe('Today');
    expect(texts(root)).not.toContain('Check what Cue found');
    expect(root.findAll((n) => n.type === Text && n.props.children === HEADLINE)).toHaveLength(0);
  });

  it('from Settings, the review still opens over the tabs, and Cancel goes back to them', async () => {
    const server = fakeServer();
    server.state.connected = true;
    const { root } = await launch(server);
    server.state.connected = false; // disconnected elsewhere
    await tap(root, 'Settings');
    await flush();
    await press(root, 'Connect Canvas');
    await flush();
    await type(root, 'Paste your token', 'good-token-123');
    await press(root, 'Connect and sync');
    await flush();
    expect(texts(root)).toContain('Check what Cue found');

    await press(root, 'Cancel');
    await flush();
    expect(selectedTab(root)).toBe('Today');
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
