import React from 'react';
import { StyleSheet } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { ApiClient } from '../src/api/client';
import type { Course, Item, StudyBlock } from '../src/api/types';
import { lightColors, lightCourses } from '../src/ui/tokens';
import { fakeServer, memoryStore } from '../test-support/fakeServer';
import { flush, lowestOpacity, onScreen, press, tap, textColor, texts } from '../test-support/ui';

jest.useFakeTimers({ now: new Date(2026, 10, 2, 9, 0), doNotFake: ['nextTick', 'setImmediate'] });

type Node = ReactTestRenderer.ReactTestInstance;
type Server = ReturnType<typeof fakeServer>;

const TABS = ['Today', 'Schedule', 'Courses'];
const nov = (day: number, hour = 9) => new Date(2026, 10, day, hour);

const courses: Course[] = [
  { id: 'c-db', source: 'canvas', name: 'Databases', code: 'DB' },
  { id: 'c-stats', source: 'canvas', name: 'Statistics', code: 'STAT' },
];

function item(fields: Partial<Item> & Pick<Item, 'id' | 'title'>): Item {
  return {
    courseId: null,
    courseName: null,
    source: 'canvas',
    kind: 'assignment',
    dueAt: null,
    endsAt: null,
    allDay: false,
    studyMinutes: null,
    status: 'not_started',
    ...fields,
  };
}

const stats = { courseId: 'c-stats', courseName: 'Statistics' };
const dbase = { courseId: 'c-db', courseName: 'Databases' };

function block(fields: Partial<StudyBlock> & Pick<StudyBlock, 'id'>): StudyBlock {
  return {
    itemId: 'midterm',
    itemTitle: 'Stats midterm',
    itemKind: 'exam',
    courseName: 'Statistics',
    itemDueAt: nov(5).toISOString(),
    itemStudyMinutes: 360,
    startsAt: nov(3, 19).toISOString(),
    endsAt: nov(3, 20).toISOString(),
    state: 'accepted',
    index: 1,
    total: 3,
    clash: null,
    ...fields,
  };
}

/** Statistics: a midterm with 3 blocks (1 accepted), a past quiz and an undated final. Databases: homework. */
function semester(server: Server) {
  server.state.items = [
    item({ id: 'midterm', title: 'Stats midterm', kind: 'exam', dueAt: nov(5).toISOString(), ...stats }),
    item({ id: 'quiz', title: 'Old quiz', kind: 'exam', dueAt: nov(1).toISOString(), ...stats }),
    item({ id: 'final', title: 'Final exam', kind: 'exam', ...stats }),
    item({ id: 'hw', title: 'SQL homework', dueAt: nov(3, 22).toISOString(), ...dbase }),
    item({ id: 'lab', title: 'Lab report', ...dbase }),
  ];
  server.state.blocks = [
    block({ id: 'b1' }),
    block({ id: 'b2', state: 'proposed', startsAt: nov(4, 19).toISOString(), endsAt: nov(4, 20).toISOString() }),
    block({ id: 'b3', state: 'proposed', startsAt: nov(4, 21).toISOString(), endsAt: nov(4, 22).toISOString() }),
  ];
}

let tree: ReactTestRenderer.ReactTestRenderer | undefined;

async function openCourses(setup?: (server: Server) => void, signedOut = false) {
  const server = fakeServer();
  server.state.connected = true;
  server.state.courses = courses;
  setup?.(server);
  const client = new ApiClient('http://cue.test', memoryStore(), server.fetchImpl);
  await act(async () => {
    tree = ReactTestRenderer.create(<App client={client} />);
  });
  await flush();
  if (signedOut) await press(tree!.root, 'Skip for now · add dates by hand');
  await press(tree!.root, 'Courses');
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
  const tab = onScreen(root, (n) => n.props['aria-selected'] === true && typeof n.props.onPress === 'function')[0];
  return tab ? texts(tab).find((t) => TABS.includes(t)) : undefined;
}

const progressBars = (root: Node) => onScreen(root, (n) => n.props.accessibilityRole === 'progressbar');

async function pick(root: Node, label: string, date: Date) {
  await tap(root, label);
  await act(async () => root.findAllByType('DateTimePicker' as never)[0].props.onChange({ type: 'set' }, date));
  await tap(root, 'Done');
}

describe('Courses', () => {
  it('shows the title, subtitle and a card per course with its next item and plan', async () => {
    const { root } = await openCourses(semester);
    const shown = texts(root);

    expect(shown).toEqual(expect.arrayContaining(['Courses', 'Your courses · synced from Canvas']));
    expect(onScreen(root, (n) => n.props.accessibilityLabel === 'Sync' && typeof n.props.onPress === 'function')).toHaveLength(1);
    expect(shown).toEqual(
      expect.arrayContaining([
        'DB',
        'Databases',
        'Next: SQL homework · Tue 3 Nov',
        'STAT',
        'Statistics',
        'Next: Stats midterm · Thu 5 Nov',
        'Stats midterm Thu 5 Nov · study plan 1 of 3 blocks',
        'Final exam needs a date',
      ]),
    );
    expect(shown.indexOf('Databases')).toBeLessThan(shown.indexOf('Statistics'));
    expect(shown).not.toContain('Old quiz needs a date');
  });

  it('draws the plan progress in the course colour', async () => {
    const { root } = await openCourses(semester);
    const [bar] = progressBars(root);

    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 3, now: 1 });
    const fill = bar.findAll((n) => n.props.testID === 'progress-fill')[0];
    expect(StyleSheet.flatten(fill.props.style).backgroundColor).toBe(lightCourses[1].mark);
  });

  it('opens a course when its card is tapped', async () => {
    const { root } = await openCourses(semester);
    await press(root, 'Statistics');
    await flush();

    const shown = texts(root);
    expect(shown).toEqual(expect.arrayContaining(['STAT', 'Statistics', 'Exams', 'Work', 'Stats midterm']));
    expect(shown).not.toContain('SQL homework');
  });

  it('with no courses shows an empty state that syncs', async () => {
    const { root } = await openCourses((s) => {
      s.state.courses = [];
    });
    expect(texts(root)).toContain('No courses yet');
    await press(root, 'Sync');
    await flush();
    expect(texts(root)).toContain('Check what Cue found');
  });

  it('with no courses and no Canvas offers Connect Canvas', async () => {
    const { root } = await openCourses((s) => {
      s.state.courses = [];
      s.state.connected = false;
    }, true);
    expect(texts(root)).toContain('No courses yet');
    expect(texts(root).filter((t) => t === 'Connect Canvas').length).toBeGreaterThanOrEqual(1);
  });
});

describe('A course', () => {
  async function openStatistics() {
    const opened = await openCourses(semester);
    await press(opened.root, 'Statistics');
    await flush();
    return opened;
  }

  it('lists upcoming exams, then past ones, with the plan', async () => {
    const { root } = await openStatistics();
    const shown = texts(root);

    expect(shown).toEqual(
      expect.arrayContaining(['Stats midterm', 'Thu 5 Nov', '1 accepted · 2 suggested', 'Final exam', 'Add date', 'Old quiz']),
    );
    expect(shown.indexOf('Stats midterm')).toBeLessThan(shown.indexOf('Final exam'));
    expect(shown.indexOf('Final exam')).toBeLessThan(shown.indexOf('Old quiz'));
  });

  it('lists a done exam without a date after the past ones, dimmed, and opens it to reopen it', async () => {
    const opened = await openCourses((s) => {
      semester(s);
      s.state.items.push(item({ id: 'mock', title: 'Mock exam', kind: 'exam', status: 'done', ...stats }));
    });
    await press(opened.root, 'Statistics');
    await flush();
    const { root, server } = opened;

    const shown = texts(root);
    expect(shown).toContain('Mock exam');
    expect(shown.indexOf('Old quiz')).toBeLessThan(shown.indexOf('Mock exam'));
    expect(textColor(root, 'Mock exam')).toBe(lightColors.text2);
    expect(lowestOpacity(onScreen(root, (n) => n.props.children === 'Mock exam')[0])).toBe(1);

    await press(root, 'No date');
    expect(texts(root)).toContain('Edit item');
    await press(root, 'Not started');
    await flush();
    const put = server.state.calls.find((c) => c.method === 'PUT' && c.path === '/api/items/mock/status');
    expect(put!.body.status).toBe('not_started');
    // Not done any more: an upcoming exam that needs a date.
    expect(textColor(root, 'Mock exam')).toBe(lightColors.text);
  });

  it("names each exam's date button for a screen reader", async () => {
    const { root } = await openStatistics();
    const labelled = (label: string) => onScreen(root, (n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');
    expect(labelled('Change date for Old quiz')).toHaveLength(1);
    expect(labelled('Add date for Final exam')).toHaveLength(1);

    await tap(root, 'Change date for Stats midterm');
    expect(texts(root)).toContain('Edit item');
    const title = root.find((n) => n.props.accessibilityLabel === 'Title' && typeof n.props.onChangeText === 'function');
    expect(title.props.value).toBe('Stats midterm');
  });

  it("View in Schedule opens Schedule on the exam's first block", async () => {
    const { root } = await openStatistics();
    await press(root, 'View in Schedule');
    await flush();

    expect(selectedTab(root)).toBe('Schedule');
    const headers = onScreen(root, (n) => n.props.accessibilityRole === 'header' && typeof n.props.accessibilityLabel === 'string');
    expect(headers.map((n) => n.props.accessibilityLabel)).toContain('Tue 3 Nov');
    expect(headers.map((n) => n.props.accessibilityLabel)).not.toContain('Wed 4 Nov');
  });

  it("View in Schedule uses the exam's date when it has no blocks", async () => {
    const opened = await openCourses((s) => {
      semester(s);
      s.state.blocks = [];
    });
    await press(opened.root, 'Statistics');
    await flush();
    await press(opened.root, 'View in Schedule');
    await flush();

    const headers = onScreen(
      opened.root,
      (n) => n.props.accessibilityRole === 'header' && typeof n.props.accessibilityLabel === 'string',
    );
    expect(headers.map((n) => n.props.accessibilityLabel)).toContain('Thu 5 Nov');
  });

  it("Add date opens the exam's sheet, which saves the date", async () => {
    const { server, root } = await openStatistics();
    await press(root, 'Add date');
    expect(texts(root)).toContain('Edit item');

    await pick(root, 'Due or exam date', nov(20, 10));
    await press(root, 'Save');
    await flush();

    const patch = server.state.calls.find((c) => c.method === 'PATCH' && c.path === '/api/items/final');
    expect(patch!.body.dueAt).toBe(nov(20, 10).toISOString());
    expect(texts(root)).not.toContain('Add date');
  });

  it('Work lists assignments and events, ticks them done, and opens their sheet', async () => {
    const opened = await openCourses(semester);
    await press(opened.root, 'Databases');
    await flush();
    await press(opened.root, 'Work');

    const shown = texts(opened.root);
    expect(shown).toEqual(expect.arrayContaining(['SQL homework', 'Lab report']));
    expect(shown.indexOf('SQL homework')).toBeLessThan(shown.indexOf('Lab report'));

    await tap(opened.root, 'Mark SQL homework done');
    await flush();
    const put = opened.server.state.calls.find((c) => c.method === 'PUT' && c.path === '/api/items/hw/status');
    expect(put!.body.status).toBe('done');
    const box = onScreen(opened.root, (n) => n.props.accessibilityLabel === 'Mark SQL homework not done')[0];
    expect(box.props.accessibilityState.checked).toBe(true);

    await press(opened.root, 'Lab report');
    expect(texts(opened.root)).toContain('Edit item');
  });

  it('dims past exams and done work with colour, not opacity, so the text stays readable', async () => {
    const opened = await openStatistics();
    expect(textColor(opened.root, 'Old quiz')).toBe(lightColors.text2);
    expect(textColor(opened.root, 'Sun 1 Nov')).toBe(lightColors.text3);
    const quiz = onScreen(opened.root, (n) => n.props.children === 'Old quiz')[0];
    expect(lowestOpacity(quiz)).toBe(1);
    await tap(opened.root, 'Back');
    await flush();

    await press(opened.root, 'Databases');
    await flush();
    await press(opened.root, 'Work');
    await tap(opened.root, 'Mark SQL homework done');
    await flush();
    expect(textColor(opened.root, 'SQL homework')).toBe(lightColors.text2);
    const row = onScreen(opened.root, (n) => n.props.children === 'SQL homework')[0];
    expect(lowestOpacity(row)).toBe(1);
    expect(textColor(opened.root, 'Lab report')).toBe(lightColors.text);
  });

  it('Back returns to Courses', async () => {
    const { root } = await openStatistics();
    await tap(root, 'Back');
    await flush();
    expect(texts(root)).toContain('Your courses · synced from Canvas');
  });
});
