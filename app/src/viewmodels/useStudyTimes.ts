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
