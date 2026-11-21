import type { Course, Item, Overview, StudyBlock } from '../src/api/types';
import { courseDetail, courseSummaries } from '../src/viewmodels/courses';

const now = new Date(2026, 10, 2, 9, 0);
const nov = (day: number, hour = 9) => new Date(2026, 10, day, hour).toISOString();

const db: Course = { id: 'c-db', source: 'canvas', name: 'Databases', code: 'DB' };
const stats: Course = { id: 'c-stats', source: 'canvas', name: 'Statistics', code: 'STAT' };

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

function block(itemId: string, startsAt: string, state: StudyBlock['state'] = 'accepted'): StudyBlock {
  return {
    id: `${itemId}-${startsAt}`,
    itemId,
    itemTitle: itemId,
    itemKind: 'exam',
    courseName: null,
    itemDueAt: null,
    itemStudyMinutes: 360,
    startsAt,
    endsAt: startsAt,
    state,
    index: 1,
    total: 1,
    clash: null,
  };
}

const overview = (items: Item[], undated: Item[] = [], blocks: StudyBlock[] = []): Overview => ({
  items,
  undated,
  blocks,
  shortfalls: [],
});

describe('courseSummaries', () => {
  it('keeps the order of the courses and matches items by courseId', () => {
    const o = overview([item({ id: 'a', title: 'A', courseId: 'c-stats', dueAt: nov(4) })]);
    const s = courseSummaries([db, stats], o, now);
    expect(s.map((x) => x.course.id)).toEqual(['c-db', 'c-stats']);
    expect(s[0].next).toBeNull();
    expect(s[1].next?.id).toBe('a');
  });

  it('picks the soonest item still to come, not done', () => {
    const o = overview([
      item({ id: 'past', title: 'Past', courseId: 'c-db', dueAt: nov(1) }),
      item({ id: 'done', title: 'Done', courseId: 'c-db', dueAt: nov(3), status: 'done' }),
      item({ id: 'late', title: 'Late', courseId: 'c-db', dueAt: nov(9) }),
      item({ id: 'soon', title: 'Soon', courseId: 'c-db', dueAt: nov(5) }),
    ]);
    expect(courseSummaries([db], o, now)[0].next?.id).toBe('soon');
  });

  it("counts an exam's accepted and suggested blocks, and the first block's start", () => {
    const exam = item({ id: 'e', title: 'Midterm', kind: 'exam', courseId: 'c-stats', dueAt: nov(9) });
    const o = overview([exam], [], [
      block('e', nov(6, 19), 'proposed'),
      block('e', nov(4, 19)),
      block('e', nov(5, 19)),
      block('other', nov(3, 19)),
    ]);
    const [plan] = courseSummaries([stats], o, now)[0].exams;
    expect(plan).toEqual({ exam, accepted: 2, suggested: 1, total: 3, firstBlockStart: nov(4, 19) });
  });

  it('leaves past and done exams out, and lists undated exams apart', () => {
    const undated = item({ id: 'u', title: 'Final', kind: 'exam', courseId: 'c-db' });
    const o = overview(
      [
        item({ id: 'p', title: 'Old', kind: 'exam', courseId: 'c-db', dueAt: nov(1) }),
        item({ id: 'd', title: 'Done', kind: 'exam', courseId: 'c-db', dueAt: nov(8), status: 'done' }),
        item({ id: 'ok', title: 'Quiz', kind: 'exam', courseId: 'c-db', dueAt: nov(7) }),
      ],
      [undated, item({ id: 'hw', title: 'Homework', courseId: 'c-db' })],
    );
    const [s] = courseSummaries([db], o, now);
    expect(s.exams.map((e) => e.exam.id)).toEqual(['ok']);
    expect(s.undatedExams).toEqual([undated]);
  });

  it('orders exams by date', () => {
    const o = overview([
      item({ id: 'b', title: 'B', kind: 'exam', courseId: 'c-db', dueAt: nov(12) }),
      item({ id: 'a', title: 'A', kind: 'exam', courseId: 'c-db', dueAt: nov(6) }),
    ]);
    expect(courseSummaries([db], o, now)[0].exams.map((e) => e.exam.id)).toEqual(['a', 'b']);
  });
});

describe('courseDetail', () => {
  it('splits exams into upcoming (dated first, then undated) and past (latest first)', () => {
    const o = overview(
      [
        item({ id: 'p1', title: 'P1', kind: 'exam', courseId: 'c-db', dueAt: nov(1) }),
        item({ id: 'f2', title: 'F2', kind: 'exam', courseId: 'c-db', dueAt: nov(12) }),
        item({ id: 'p2', title: 'P2', kind: 'exam', courseId: 'c-db', dueAt: nov(1, 15) }),
        item({ id: 'f1', title: 'F1', kind: 'exam', courseId: 'c-db', dueAt: nov(6) }),
        item({ id: 'x', title: 'Other course', kind: 'exam', courseId: 'c-stats', dueAt: nov(6) }),
      ],
      [item({ id: 'u', title: 'U', kind: 'exam', courseId: 'c-db' })],
      [block('f1', nov(4, 19))],
    );
    const d = courseDetail(db, o, now);
    expect(d.upcomingExams.map((e) => e.exam.id)).toEqual(['f1', 'f2', 'u']);
    expect(d.upcomingExams[0]).toMatchObject({ accepted: 1, suggested: 0, total: 1, firstBlockStart: nov(4, 19) });
    expect(d.upcomingExams[2]).toMatchObject({ total: 0, firstBlockStart: null });
    expect(d.pastExams.map((e) => e.id)).toEqual(['p2', 'p1']);
  });

  it('puts a done exam with the past ones', () => {
    const o = overview([item({ id: 'd', title: 'D', kind: 'exam', courseId: 'c-db', dueAt: nov(8), status: 'done' })]);
    const d = courseDetail(db, o, now);
    expect(d.upcomingExams).toEqual([]);
    expect(d.pastExams.map((e) => e.id)).toEqual(['d']);
  });

  it('puts a done exam without a date with the past ones, after the dated ones', () => {
    const o = overview(
      [item({ id: 'p', title: 'P', kind: 'exam', courseId: 'c-db', dueAt: nov(1) })],
      [
        item({ id: 'ud', title: 'Undated done', kind: 'exam', courseId: 'c-db', status: 'done' }),
        item({ id: 'u', title: 'U', kind: 'exam', courseId: 'c-db' }),
      ],
    );
    const d = courseDetail(db, o, now);
    expect(d.upcomingExams.map((e) => e.exam.id)).toEqual(['u']);
    expect(d.pastExams.map((e) => e.id)).toEqual(['p', 'ud']);
    expect(courseSummaries([db], o, now)[0].undatedExams.map((e) => e.id)).toEqual(['u']); // no "needs a date" once done
  });

  it('lists assignments and events by due date, undated last, and no exams', () => {
    const o = overview(
      [
        item({ id: 'b', title: 'B', courseId: 'c-db', dueAt: nov(9) }),
        item({ id: 'ev', title: 'Event', kind: 'event', courseId: 'c-db', dueAt: nov(3) }),
        item({ id: 'ex', title: 'Exam', kind: 'exam', courseId: 'c-db', dueAt: nov(4) }),
      ],
      [item({ id: 'u', title: 'U', courseId: 'c-db' }), item({ id: 'a', title: 'A', courseId: 'c-db' })],
    );
    expect(courseDetail(db, o, now).work.map((i) => i.id)).toEqual(['ev', 'b', 'a', 'u']);
  });
});
