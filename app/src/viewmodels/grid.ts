import type { Item, StudyBlock, StudyWindow } from '../api/types';
import { addDays, sameDay } from '../dates';

export const HOUR_HEIGHT = 50;

const DEFAULT_RANGE = { startHour: 8, endHour: 22 };
const HOUR_MS = 3_600_000;

/** Whole local hours of a calendar day, 0–24. */
export interface GridRange {
  startHour: number;
  endHour: number;
}

export interface Placed<T> {
  value: T;
  top: number;
  height: number;
}

export interface TimedEvent {
  item: Item;
  startsAt: string;
  endsAt: string;
}

/** The part of [start, end) that falls on `day`, in minutes from local midnight; null when none. */
function clipToDay(day: Date, start: Date, end: Date): { from: number; to: number } | null {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  const from = Math.max(start.getTime(), dayStart);
  const to = Math.min(end.getTime(), dayEnd);
  if (to <= from) return null;
  // Measure from local midnight; a 23 h or 25 h day still ends at 24:00.
  const minutes = (ms: number) => (ms === dayEnd ? 24 * 60 : minutesOfDay(new Date(ms)));
  return { from: minutes(from), to: minutes(to) };
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000;
}

function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Study-window spans on `day` in minutes, including the tail of the previous day's overnight window. */
function windowSpans(day: Date, windows: StudyWindow[]): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  const own = windows.find((w) => w.enabled && w.weekday === day.getDay());
  if (own) {
    const start = parseTime(own.start);
    const end = parseTime(own.end);
    if (end > start) spans.push({ from: start, to: end });
    else if (end < start) spans.push({ from: start, to: 24 * 60 });
  }
  const prev = windows.find((w) => w.enabled && w.weekday === addDays(day, -1).getDay());
  if (prev) {
    const start = parseTime(prev.start);
    const end = parseTime(prev.end);
    if (end < start && end > 0) spans.push({ from: 0, to: end });
  }
  return spans;
}

export function gridRange(
  days: Date[],
  windows: StudyWindow[],
  blocks: StudyBlock[],
  events: TimedEvent[],
): GridRange {
  let lo = Infinity;
  let hi = -Infinity;
  const take = (span: { from: number; to: number } | null) => {
    if (!span) return;
    lo = Math.min(lo, span.from);
    hi = Math.max(hi, span.to);
  };
  for (const day of days) {
    windowSpans(day, windows).forEach(take);
    for (const b of blocks) take(clipToDay(day, new Date(b.startsAt), new Date(b.endsAt)));
    for (const e of events) take(clipToDay(day, new Date(e.startsAt), new Date(e.endsAt)));
  }
  if (lo === Infinity) return { ...DEFAULT_RANGE };
  return {
    startHour: Math.max(0, Math.floor(lo / 60)),
    endHour: Math.min(24, Math.ceil(hi / 60)),
  };
}

export function placeInDay<T extends { startsAt: string; endsAt: string }>(
  day: Date,
  entries: T[],
  range: GridRange,
  hourHeight: number = HOUR_HEIGHT,
): Placed<T>[] {
  const out: Placed<T>[] = [];
  for (const value of entries) {
    const span = clipToDay(day, new Date(value.startsAt), new Date(value.endsAt));
    if (!span) continue;
    const from = Math.max(span.from, range.startHour * 60);
    const to = Math.min(span.to, range.endHour * 60);
    if (to <= from) continue;
    out.push({
      value,
      top: ((from - range.startHour * 60) / 60) * hourHeight,
      height: ((to - from) / 60) * hourHeight,
    });
  }
  return out;
}

function dueOn(item: Item, day: Date): boolean {
  return item.dueAt !== null && sameDay(new Date(item.dueAt), day);
}

/** Exams, assignments and all-day events due on `day`, by time. */
export function deadlinesFor(day: Date, items: Item[]): Item[] {
  return items
    .filter((i) => dueOn(i, day) && (i.kind === 'event' ? i.allDay : true))
    .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());
}

/** Events with a time on `day`; an event without an end lasts one hour. */
export function timedEventsFor(day: Date, items: Item[]): TimedEvent[] {
  return items
    .filter((i) => i.kind === 'event' && !i.allDay && dueOn(i, day))
    .map((item) => ({
      item,
      startsAt: item.dueAt!,
      endsAt: item.endsAt ?? new Date(new Date(item.dueAt!).getTime() + HOUR_MS).toISOString(),
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
