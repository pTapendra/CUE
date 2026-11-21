import type { Item, StudyBlock } from '../src/api/types';
import {
  blockMeta,
  dueSoon,
  durationLabel,
  noDate,
  pickUpNext,
  syncedLabel,
  upNextLabel,
  weekMarks,
  whenLabel,
} from '../src/viewmodels/today';

/** A local time in November 2026. */
const nov = (day: number, hour = 9, minute = 0) => new Date(2026, 10, day, hour, minute);
const iso = (d: Date) => d.toISOString();

function item(fields: Partial<Item> & Pick<Item, 'id'>): Item {
  return {
    courseId: null,
    courseName: null,
    source: 'manual',
    kind: 'assignment',
    title: fields.id,
    dueAt: null,
    endsAt: null,
    allDay: false,
    studyMinutes: null,
    status: 'not_started',
    ...fields,
  };
}

function block(fields: Partial<StudyBlock> & Pick<StudyBlock, 'id' | 'startsAt'>): StudyBlock {
  return {
    itemId: 'item-stats',
    itemTitle: 'Stats midterm',
    itemKind: 'exam',
    courseName: 'Statistics',
    itemDueAt: iso(nov(20)),
    itemStudyMinutes: 360,
    endsAt: iso(new Date(Date.parse(fields.startsAt) + 3600e3)),
    state: 'accepted',
    index: 1,
    total: 6,
    clash: null,
    ...fields,
  };
}

describe('pickUpNext', () => {
  const now = nov(2, 9, 0);

  it('shows the accepted block that comes first, before any suggestion', () => {
    const later = block({ id: 'later', startsAt: iso(nov(4, 19)) });
    const sooner = block({ id: 'sooner', startsAt: iso(nov(3, 19)) });
    const suggested = block({ id: 'suggested', startsAt: iso(nov(2, 18)), state: 'proposed' });

    expect(pickUpNext([later, suggested, sooner], [], now)).toEqual({ kind: 'block', block: sooner });
  });

  it('shows an accepted block 12 days away, as the overview covers 200 days', () => {
    const far = block({ id: 'far', startsAt: iso(nov(14, 19)) });
    const suggested = block({ id: 'suggested', startsAt: iso(nov(3, 19)), state: 'proposed' });

    expect(pickUpNext([suggested, far], [], now)).toEqual({ kind: 'block', block: far });
  });

  it('skips an accepted block that has ended, and keeps one that is under way', () => {
    const ended = block({ id: 'ended', startsAt: iso(nov(2, 7)), endsAt: iso(nov(2, 8)) });
    const underWay = block({ id: 'under-way', startsAt: iso(nov(2, 8, 30)), endsAt: iso(nov(2, 9, 30)) });

    expect(pickUpNext([ended, underWay], [], now)).toEqual({ kind: 'block', block: underWay });
    expect(pickUpNext([ended], [], now)).toBeNull();
  });

  it('counts the suggestions, and names the first, when nothing is accepted', () => {
    const second = block({ id: 'second', startsAt: iso(nov(5, 19)), state: 'proposed' });
    const first = block({ id: 'first', startsAt: iso(nov(3, 19)), state: 'proposed' });

    expect(pickUpNext([second, first], [], now)).toEqual({ kind: 'suggested', count: 2, first });
  });

  it('asks to plan when an assignment or exam not done is due within 30 days', () => {
    const exam = item({ id: 'exam', kind: 'exam', dueAt: iso(nov(30, 9)) }); // 28 days
    expect(pickUpNext([], [exam], now)).toEqual({ kind: 'plan' });
    expect(pickUpNext([], [item({ id: 'hw', dueAt: iso(nov(3)) })], now)).toEqual({ kind: 'plan' });
  });

  it('is hidden when nothing needs planning', () => {
    expect(pickUpNext([], [], now)).toBeNull();
    const notWork = [
      item({ id: 'done', kind: 'exam', dueAt: iso(nov(10)), status: 'done' }),
      item({ id: 'event', kind: 'event', dueAt: iso(nov(10)) }),
      item({ id: 'past', kind: 'exam', dueAt: iso(nov(1)) }),
      item({ id: 'far', kind: 'exam', dueAt: iso(new Date(2026, 11, 2, 9, 0)) }), // 30 days
    ];
    expect(pickUpNext([], notWork, now)).toBeNull();
  });
});

describe('dueSoon', () => {
  // 23:30 on a Monday: the window still runs a whole week from now, in the phone's local time.
  const now = nov(2, 23, 30);

  it('lists what is due from now to a week ahead, not done, by due time', () => {
    const items = [
      item({ id: 'next-monday-just-before', dueAt: iso(nov(9, 23, 29)) }),
      item({ id: 'tomorrow-23:59', dueAt: iso(nov(3, 23, 59)) }),
      item({ id: 'right-now', dueAt: iso(now) }),
      item({ id: 'next-monday-on-the-edge', dueAt: iso(nov(9, 23, 30)) }),
      item({ id: 'earlier-today', dueAt: iso(nov(2, 23, 0)) }),
      item({ id: 'done-tomorrow', dueAt: iso(nov(3, 12)), status: 'done' }),
      item({ id: 'in-progress', dueAt: iso(nov(4, 12)), status: 'in_progress' }),
      item({ id: 'no-date' }),
    ];

    expect(dueSoon(items, now).map((i) => i.id)).toEqual([
      'right-now',
      'tomorrow-23:59',
      'in-progress',
      'next-monday-just-before',
    ]);
  });
});

describe('noDate', () => {
  it('lists what is not done, exams first, then by title; then what is done, in the same order', () => {
    const undated = [
      item({ id: 'b', title: 'Lab report' }),
      item({ id: 'c', title: 'Midterm', kind: 'exam' }),
      item({ id: 'd', title: 'Essay', status: 'done' }),
      item({ id: 'e', title: 'Final', kind: 'exam' }),
      item({ id: 'f', title: 'Club', kind: 'event' }),
      item({ id: 'g', title: 'Quiz', kind: 'exam', status: 'done' }),
    ];

    // Done items stay listed, so they can be reopened, dated or deleted.
    expect(noDate(undated).map((i) => i.title)).toEqual(['Final', 'Midterm', 'Club', 'Lab report', 'Quiz', 'Essay']);
  });
});

describe('weekMarks', () => {
  const colorFor = (name: string | null) => `colour of ${name ?? 'none'}`;

  it("marks each day from Monday to Sunday of the week with work, in the colour of the day's first thing", () => {
    const items = [
      item({ id: 'monday-midnight', courseName: 'Databases', dueAt: iso(nov(2, 0, 0)) }),
      item({ id: 'sunday-before', courseName: 'Databases', dueAt: iso(new Date(2026, 10, 1, 23, 59)) }),
      item({ id: 'wednesday-late', courseName: 'Databases', dueAt: iso(nov(4, 22)) }),
      item({ id: 'done', courseName: 'Databases', dueAt: iso(nov(5, 9)), status: 'done' }),
      item({ id: 'sunday-23:59', dueAt: iso(nov(8, 23, 59)) }),
      item({ id: 'next-monday', courseName: 'Databases', dueAt: iso(nov(9, 0, 30)) }),
      item({ id: 'no-date', courseName: 'Databases' }),
    ];
    const blocks = [
      block({ id: 'wednesday-early', courseName: 'Statistics', startsAt: iso(nov(4, 8)) }),
      block({ id: 'friday-suggested', courseName: 'Statistics', startsAt: iso(nov(6, 19)), state: 'proposed' }),
    ];

    // On Sunday night the strip still shows the week that ends that day.
    expect(weekMarks(items, blocks, nov(8, 23, 30), colorFor)).toEqual({
      '2026-11-02': 'colour of Databases',
      '2026-11-04': 'colour of Statistics',
      '2026-11-08': 'colour of none',
    });
  });
});

describe('syncedLabel', () => {
  const now = nov(2, 9, 0);
  const ago = (minutes: number) => iso(new Date(now.getTime() - minutes * 60e3));

  it('says how long ago Canvas was synced', () => {
    expect(syncedLabel(ago(0.5), now)).toBe('just now');
    expect(syncedLabel(ago(1), now)).toBe('1 min ago');
    expect(syncedLabel(ago(12), now)).toBe('12 min ago');
    expect(syncedLabel(ago(59), now)).toBe('59 min ago');
    expect(syncedLabel(ago(60), now)).toBe('1 h ago');
    expect(syncedLabel(ago(23 * 60 + 59), now)).toBe('23 h ago');
    expect(syncedLabel(ago(25 * 60), now)).toBe('on Sun 1 Nov');
    expect(syncedLabel(null, now)).toBe('never');
  });
});

describe('labels', () => {
  const now = nov(2, 23, 30);

  it('names today and tomorrow by local day, other days by date', () => {
    expect(whenLabel(nov(2, 23, 45), now)).toBe('Today, 23:45');
    expect(whenLabel(nov(3, 0, 15), now)).toBe('Tomorrow, 00:15');
    expect(whenLabel(nov(4, 9), now)).toBe('Wed 4 Nov, 09:00');
  });

  it('gives a length in hours and minutes', () => {
    expect(durationLabel(45)).toBe('45 min');
    expect(durationLabel(60)).toBe('1 h');
    expect(durationLabel(90)).toBe('1 h 30 min');
  });

  it("labels Up next with the block's time, and its day when that is not today", () => {
    const tonight = block({ id: 'tonight', startsAt: iso(nov(2, 23, 45)) });
    const later = block({ id: 'later', startsAt: iso(nov(14, 19)) });
    expect(upNextLabel(tonight, now)).toBe('Up next · 23:45');
    expect(upNextLabel(later, now)).toBe('Up next · Sat 14 Nov, 19:00');
  });

  it('describes a block by course, length and what it is for', () => {
    const exam = block({ id: 'exam', startsAt: iso(nov(3, 19)), itemDueAt: iso(nov(5, 9)) });
    expect(blockMeta(exam, now)).toBe('Statistics · 1 h · exam Thu 5 Nov, 09:00');

    const homework = block({
      id: 'hw',
      startsAt: iso(nov(3, 19)),
      endsAt: iso(nov(3, 20, 30)),
      itemKind: 'assignment',
      courseName: null,
      itemDueAt: iso(nov(3, 22)),
    });
    expect(blockMeta(homework, now)).toBe('1 h 30 min · due Tomorrow, 22:00');
  });
});
