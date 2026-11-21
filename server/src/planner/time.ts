// Pure helpers converting local wall-clock times in an IANA time zone to UTC instants and back.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Local wall-clock fields of an instant, as a UTC timestamp of those same fields. */
function localFieldsAsUtc(ms: number, timeZone: string): number {
  const p: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
}

/** Offset of the zone from UTC at an instant, in milliseconds. */
function offsetAt(ms: number, timeZone: string): number {
  const whole = Math.floor(ms / 1000) * 1000;
  return localFieldsAsUtc(whole, timeZone) - whole;
}

export function zonedTimeToUtc(localDate: string, time: string, timeZone: string): Date {
  const [y, mo, d] = localDate.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const DAY = 24 * 60 * 60 * 1000;
  // The offsets in force a day before and after bracket any single transition.
  const before = offsetAt(guess - DAY, timeZone);
  const after = offsetAt(guess + DAY, timeZone);
  const matches = [...new Set([before, after])]
    .map((offset) => guess - offset)
    .filter((t) => localFieldsAsUtc(t, timeZone) === guess);
  // Ambiguous (fall back): earliest instant. Skipped (spring forward): none match, so use the
  // offset in force before the transition, which lands one hour later.
  return new Date(matches.length > 0 ? Math.min(...matches) : guess - before);
}

export function localDateOf(instant: Date, timeZone: string): string {
  return new Date(localFieldsAsUtc(instant.getTime(), timeZone)).toISOString().slice(0, 10);
}

export function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 0 = Sunday, 6 = Saturday. */
export function weekdayOf(localDate: string): number {
  const [y, m, d] = localDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}
