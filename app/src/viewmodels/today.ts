import type { Item, StudyBlock } from '../api/types';
import { addDays, dayKey, dayLabel, sameDay, startOfWeek, timeLabel } from '../dates';

/** What the Up next card shows, or null when it is hidden. */
export type UpNext =
  | { kind: 'block'; block: StudyBlock }
  | { kind: 'suggested'; count: number; first: StudyBlock }
  | { kind: 'plan' }
  | null;

/** How far ahead an assignment or exam due makes Today ask the student to plan. */
const PLAN_DAYS = 30;
/** How far ahead Due soon looks. */
const DUE_SOON_DAYS = 7;

const time = (iso: string) => Date.parse(iso);
const byStart = (a: StudyBlock, b: StudyBlock) => time(a.startsAt) - time(b.startsAt);

/** Whether `iso` is in [from, to). */
function within(iso: string | null, from: Date, to: Date): iso is string {
  return iso !== null && time(iso) >= from.getTime() && time(iso) < to.getTime();
}

/**
 * The Up next card: the next accepted study block that hasn't ended (however far away); else the
 * suggestions, if any; else a prompt to plan when an assignment or exam not done is due within 30 days.
 */
export function pickUpNext(blocks: StudyBlock[], items: Item[], now: Date): UpNext {
  const upcoming = blocks.filter((b) => time(b.endsAt) > now.getTime()).sort(byStart);
  const accepted = upcoming.find((b) => b.state === 'accepted');
  if (accepted) return { kind: 'block', block: accepted };

  const suggested = upcoming.filter((b) => b.state === 'proposed');
  if (suggested.length > 0) return { kind: 'suggested', count: suggested.length, first: suggested[0] };

  const horizon = addDays(now, PLAN_DAYS);
  const needsPlan = items.some(
    (i) => (i.kind === 'assignment' || i.kind === 'exam') && i.status !== 'done' && within(i.dueAt, now, horizon),
  );
  return needsPlan ? { kind: 'plan' } : null;
}

/** Items due from now until the same time a week later (in local days), not done, soonest first. */
export function dueSoon(items: Item[], now: Date): Item[] {
  const until = addDays(now, DUE_SOON_DAYS);
  return items
    .filter((i) => i.status !== 'done' && within(i.dueAt, now, until))
    .sort((a, b) => time(a.dueAt!) - time(b.dueAt!));
}

/**
 * Items without a date: those not done (exams first, then by title), then the done ones in the same order.
 * Done items stay listed: Today is the only place an undated item without a course shows, so leaving them
 * out would leave no way to reopen, date or delete them.
 */
export function noDate(undated: Item[]): Item[] {
  const done = (i: Item) => Number(i.status === 'done');
  const exam = (i: Item) => Number(i.kind === 'exam');
  return [...undated].sort((a, b) => done(a) - done(b) || exam(b) - exam(a) || a.title.localeCompare(b.title));
}

/**
 * The day strip's dots for the week (Monday to Sunday, local) that contains `weekOf`: each day with
 * work, keyed "YYYY-MM-DD", in the colour of its first thing. Work is an item due that isn't done,
 * or an accepted study block; suggestions are not work until they are accepted.
 */
export function weekMarks(
  items: Item[],
  blocks: StudyBlock[],
  weekOf: Date,
  colorFor: (courseName: string | null) => string,
): Record<string, string> {
  const monday = startOfWeek(weekOf);
  const week = new Set(Array.from({ length: 7 }, (_, i) => dayKey(addDays(monday, i))));
  const work = [
    ...items.filter((i) => i.dueAt && i.status !== 'done').map((i) => ({ at: i.dueAt!, course: i.courseName })),
    ...blocks.filter((b) => b.state === 'accepted').map((b) => ({ at: b.startsAt, course: b.courseName })),
  ].sort((a, b) => time(a.at) - time(b.at));

  const marks: Record<string, string> = {};
  for (const { at, course } of work) {
    const day = dayKey(new Date(at));
    if (week.has(day) && !(day in marks)) marks[day] = colorFor(course);
  }
  return marks;
}

/** When Canvas was last synced: "just now", "12 min ago", "3 h ago", or "on Mon 2 Nov". */
export function syncedLabel(lastSyncedAt: string | null, now: Date): string {
  if (!lastSyncedAt) return 'never';
  const minutes = Math.floor((now.getTime() - time(lastSyncedAt)) / 60e3);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `on ${dayLabel(new Date(lastSyncedAt))}`;
}

/** "Today, 14:00", "Tomorrow, 09:00" or "Wed 4 Nov, 09:00", by the phone's local days. */
export function whenLabel(d: Date, now: Date): string {
  const day = sameDay(d, now) ? 'Today' : sameDay(d, addDays(now, 1)) ? 'Tomorrow' : dayLabel(d);
  return `${day}, ${timeLabel(d)}`;
}

/** "45 min", "1 h" or "1 h 30 min". */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "Up next · 19:00" for a block today; other days also name the day. */
export function upNextLabel(block: StudyBlock, now: Date): string {
  const start = new Date(block.startsAt);
  return `Up next · ${sameDay(start, now) ? timeLabel(start) : whenLabel(start, now)}`;
}

/** "Statistics · 1 h · exam Thu 5 Nov, 09:00": the block's course, length, and what it is for. */
export function blockMeta(block: StudyBlock, now: Date): string {
  const minutes = (time(block.endsAt) - time(block.startsAt)) / 60e3;
  const due = block.itemDueAt
    ? `${block.itemKind === 'exam' ? 'exam' : 'due'} ${whenLabel(new Date(block.itemDueAt), now)}`
    : null;
  return [block.courseName, durationLabel(minutes), due].filter(Boolean).join(' · ');
}
