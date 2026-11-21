/** Start of the week (Monday 00:00, local time) containing `d`. */
export function startOfWeek(d: Date): Date {
  const out = startOfDay(d);
  const offset = (out.getDay() + 6) % 7; // Monday = 0
  out.setDate(out.getDate() - offset);
  return out;
}

/** Local midnight at the start of `d`'s day. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "Mon 2 Nov" */
export function dayLabel(d: Date): string {
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "Mon" */
export function weekdayLabel(d: Date): string {
  return DAYS[d.getDay()];
}

/**
 * The month of the days from `first` to `last`: "November", or "Oct – Nov" across two months.
 * The year is named only when it is not the year of `now`.
 */
export function monthTitle(first: Date, last: Date, now: Date): string {
  const thisYear = now.getFullYear();
  if (first.getFullYear() !== last.getFullYear()) {
    return `${MONTHS[first.getMonth()]} ${first.getFullYear()} – ${MONTHS[last.getMonth()]} ${last.getFullYear()}`;
  }
  const year = first.getFullYear() === thisYear ? '' : ` ${first.getFullYear()}`;
  if (first.getMonth() === last.getMonth()) return `${MONTH_NAMES[first.getMonth()]}${year}`;
  return `${MONTHS[first.getMonth()]} – ${MONTHS[last.getMonth()]}${year}`;
}

/**
 * The local day a date in a route means, at midnight: "YYYY-MM-DD" is that local date
 * (not UTC midnight); anything else is read as a time, and its local day is taken. Null when unreadable.
 */
export function parseDay(text: string | undefined): Date | null {
  if (!text) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
    const day = new Date(y, mo, d);
    return day.getFullYear() === y && day.getMonth() === mo && day.getDate() === d ? day : null;
  }
  const time = new Date(text);
  return Number.isNaN(time.getTime()) ? null : startOfDay(time);
}

/** "2026-11-02": `d`'s local date, as routes and the day strip name a day. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "14:30" */
export function timeLabel(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** "Mon 2 Nov – Wed 4 Nov" for `days` days starting on `from`; "Mon 2 Nov" for one day. */
export function rangeLabel(from: Date, days: number): string {
  if (days <= 1) return dayLabel(from);
  return `${dayLabel(from)} – ${dayLabel(addDays(from, days - 1))}`;
}
