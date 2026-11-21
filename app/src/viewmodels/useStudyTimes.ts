import { useEffect, useState } from 'react';
import { useApi } from '../api/ApiContext';
import { friendlyMessage } from '../api/client';
import type { StudyWindow } from '../api/types';
import { deviceTimeZone } from '../timeZone';

export const MIN_LIMIT_HOURS = 1;
export const MAX_LIMIT_HOURS = 12;
const MIN_WINDOW_MINUTES = 60;
const MAX_WINDOW_MINUTES = 12 * 60;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function minutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

/** Length of the window in minutes; an end earlier than the start means the next day. */
function length(w: StudyWindow): number {
  const diff = minutes(w.end) - minutes(w.start);
  return diff > 0 ? diff : diff + 24 * 60;
}

/** What is wrong with a study window, or null when the server will accept it. */
export function windowError(w: StudyWindow): string | null {
  if (!TIME.test(w.start) || !TIME.test(w.end)) return 'Use the form 18:00';
  if (w.start === w.end) return "Start and end can't be the same";
  if (length(w) < MIN_WINDOW_MINUTES) return 'At least 1 hour';
  if (length(w) > MAX_WINDOW_MINUTES) return 'At most 12 hours';
  return null;
}

/** "18:00 – 22:00", or "22:00 – 01:00 (next day)" when the window runs past midnight. */
export function rangeText(w: StudyWindow): string {
  const next = TIME.test(w.start) && TIME.test(w.end) && minutes(w.end) < minutes(w.start);
  return `${w.start} – ${w.end}${next ? ' (next day)' : ''}`;
}

/** "18", or "9:30" when there are minutes. */
function hourText(time: string): string {
  const [h, m] = [time.slice(0, 2), time.slice(3)];
  return m === '00' ? String(Number(h)) : `${Number(h)}:${m}`;
}

/** The study times in a few words: "Weekdays 18–22", "Every day 10–16", or "5 days" when the days differ. */
export function studyTimesSummary(windows: StudyWindow[]): string {
  const on = windows.filter((w) => w.enabled);
  if (on.length === 0) return 'No studying';
  const same = on.every((w) => w.start === on[0]!.start && w.end === on[0]!.end);
  const hours = `${hourText(on[0]!.start)}–${hourText(on[0]!.end)}`;
  if (same && on.length === 7) return `Every day ${hours}`;
  if (same && on.length === 5 && on.every((w) => w.weekday >= 1 && w.weekday <= 5)) return `Weekdays ${hours}`;
  return on.length === 1 ? '1 day' : `${on.length} days`;
}

/** "3 hours" (and "1 hour"). */
export function hoursText(hours: number): string {
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/** The ISO time of today at `HH:MM` (local), for the time picker. */
export function timeToIso(time: string): string {
  const d = new Date();
  d.setHours(Number(time.slice(0, 2)), Number(time.slice(3)), 0, 0);
  return d.toISOString();
}

/** The local `HH:MM` of an ISO time picked with the time picker. */
export function isoToTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Monday first; the weekday numbers (0 = Sunday) stay as the server has them. */
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

/** View model for the Study times screen. */
export function useStudyTimes(onDone: () => void) {
  const api = useApi();
  const [rows, setRows] = useState<StudyWindow[]>([]);
  const [dailyLimitHours, setDailyLimitHours] = useState(3);
  // The zone the phone is in now; the server may still have the one from before a trip.
  const timeZone = deviceTimeZone();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getPlannerSettings()
      .then((s) => {
        if (cancelled) return;
        setRows(MONDAY_FIRST.map((d) => s.windows.find((w) => w.weekday === d)).filter((w): w is StudyWindow => !!w));
        setDailyLimitHours(Math.min(MAX_LIMIT_HOURS, Math.max(MIN_LIMIT_HOURS, Math.round(s.dailyLimitMinutes / 60))));
      })
      .catch((err) => !cancelled && setError(friendlyMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [api]);

  const errors = rows.map(windowError);
  const canSave = !loading && !saving && rows.length > 0 && errors.every((e) => e === null);

  function change(weekday: number, patch: Partial<StudyWindow>) {
    setRows((rs) => rs.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)));
  }

  function stepLimit(delta: number) {
    setDailyLimitHours((h) => Math.min(MAX_LIMIT_HOURS, Math.max(MIN_LIMIT_HOURS, h + delta)));
  }

  async function save(): Promise<void> {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await api.savePlannerSettings({ timeZone, dailyLimitMinutes: dailyLimitHours * 60, windows: rows });
      onDone();
    } catch (err) {
      setError(friendlyMessage(err));
      setSaving(false);
    }
  }

  return { rows, errors, dailyLimitHours, timeZone, loading, saving, error, canSave, change, stepLimit, save };
}
