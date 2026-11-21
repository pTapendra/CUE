import type { Course, Item, Overview, StudyBlock } from '../api/types';

/** An exam with its study plan: how many of its blocks are accepted and how many are only suggested. */
export type ExamPlan = {
  exam: Item;
  accepted: number;
  suggested: number;
  total: number;
  /** When the earliest block starts (an ISO time), or null without blocks. */
  firstBlockStart: string | null;
};

export type CourseSummary = {
  course: Course;
  /** The soonest item still to come that isn't done. */
  next: Item | null;
  /** Upcoming exams that aren't done, in date order. */
  exams: ExamPlan[];
  undatedExams: Item[];
};

export type CourseDetail = {
  /** Dated exams still to come, in date order, then exams without a date. */
  upcomingExams: ExamPlan[];
  /** Exams that have passed or are done, the latest first, then done exams without a date. */
  pastExams: Item[];
  /** Assignments and events by due date, undated last. */
  work: Item[];
};

const time = (iso: string) => Date.parse(iso);
const byDue = (a: Item, b: Item) => time(a.dueAt!) - time(b.dueAt!);
const upcoming = (i: Item, now: Date) => i.status !== 'done' && i.dueAt !== null && time(i.dueAt) >= now.getTime();

function planFor(exam: Item, blocks: StudyBlock[]): ExamPlan {
  const mine = blocks.filter((b) => b.itemId === exam.id);
  const starts = mine.map((b) => b.startsAt).sort((a, b) => time(a) - time(b));
  return {
    exam,
    accepted: mine.filter((b) => b.state === 'accepted').length,
    suggested: mine.filter((b) => b.state === 'proposed').length,
    total: mine.length,
    firstBlockStart: starts[0] ?? null,
  };
}

/** One summary per course, in the order of `courses`; items are matched by `courseId`. */
export function courseSummaries(courses: Course[], overview: Overview, now: Date): CourseSummary[] {
  return courses.map((course) => {
    const items = overview.items.filter((i) => i.courseId === course.id);
    const coming = items.filter((i) => upcoming(i, now)).sort(byDue);
    return {
      course,
      next: coming[0] ?? null,
      exams: coming.filter((i) => i.kind === 'exam').map((e) => planFor(e, overview.blocks)),
      undatedExams: overview.undated.filter((i) => i.courseId === course.id && i.kind === 'exam' && i.status !== 'done'),
    };
  });
}

/** A course's exams (upcoming, past) and its work, matched by `courseId`. */
export function courseDetail(course: Course, overview: Overview, now: Date): CourseDetail {
  const dated = overview.items.filter((i) => i.courseId === course.id);
  const undated = overview.undated.filter((i) => i.courseId === course.id);
  const exams = dated.filter((i) => i.kind === 'exam');
  const undatedExams = undated.filter((i) => i.kind === 'exam');
  const upcomingDated = exams.filter((i) => upcoming(i, now)).sort(byDue);
  const work = (list: Item[]) => list.filter((i) => i.kind !== 'exam');
  const byTitle = (a: Item, b: Item) => a.title.localeCompare(b.title);
  return {
    upcomingExams: [...upcomingDated, ...undatedExams.filter((i) => i.status !== 'done')].map((e) =>
      planFor(e, overview.blocks),
    ),
    // A done exam without a date stays here, so it can still be reopened, dated or deleted.
    pastExams: [
      ...exams.filter((i) => !upcoming(i, now)).sort((a, b) => byDue(b, a)),
      ...undatedExams.filter((i) => i.status === 'done').sort(byTitle),
    ],
    work: [...work(dated).sort(byDue), ...work(undated).sort(byTitle)],
  };
}
