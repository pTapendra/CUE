import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api/ApiContext';
import { friendlyMessage } from '../api/client';
import type { Course, ItemInput, ItemStatus, StudyWindow, Week } from '../api/types';
import { addDays, fromInput, startOfDay } from '../dates';
import { gridRange, timedEventsFor } from './grid';

/** Days the grid shows at once; the arrows move by this many. */
export const DAYS_PER_PAGE = 3;

/** View model for the Week screen: a time grid of a few days with study blocks (UC2). */
export function useWeek(today: Date = new Date()) {
  const api = useApi();
  const [from, setFrom] = useState(() => startOfDay(today));
  const [week, setWeek] = useState<Week | null>(null);
  const [windows, setWindows] = useState<StudyWindow[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [w, c, s] = await Promise.all([
        api.getWeek(from, DAYS_PER_PAGE),
        api.listCourses(),
        api.getPlannerSettings(),
      ]);
      setWeek(w);
      setCourses(c.courses);
      setWindows(s.windows);
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api, from]);

  useEffect(() => {
    load();
  }, [load]);

  /** Runs a change, then reloads the week. Returns false and shows the error if it fails. */
  async function mutate(action: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    try {
      await action();
      await load();
      return true;
    } catch (err) {
      setError(friendlyMessage(err));
      return false;
    }
  }

  /** Moves a block to a typed local start time, such as "2026-11-06 14:00". */
  async function moveBlock(id: string, text: string): Promise<boolean> {
    const startsAt = fromInput(text);
    if (!startsAt) {
      setError('Use the form 2026-11-06 14:00');
      return false;
    }
    return mutate(() => api.moveBlock(id, startsAt));
  }

  const days = Array.from({ length: DAYS_PER_PAGE }, (_, i) => addDays(from, i));
  const items = week?.items ?? [];
  const blocks = week?.blocks ?? [];
  const events = days.flatMap((day) => timedEventsFor(day, items));

  return {
    from,
    days,
    range: gridRange(days, windows, blocks, events),
    blocks,
    items,
    undated: week?.undated ?? [],
    shortfalls: week?.shortfalls ?? [],
    windows,
    courses,
    loading,
    error,
    reload: load,
    previous: () => setFrom((f) => addDays(f, -DAYS_PER_PAGE)),
    next: () => setFrom((f) => addDays(f, DAYS_PER_PAGE)),
    goToday: () => setFrom(startOfDay(new Date())),
    suggestedCount: blocks.filter((b) => b.state === 'proposed').length,
    acceptVisible: () => mutate(() => api.acceptBlocks(from, addDays(from, DAYS_PER_PAGE))),
    acceptBlock: (id: string) => mutate(() => api.acceptBlock(id)),
    rejectBlock: (id: string) => mutate(() => api.rejectBlock(id)),
    moveBlock,
    setStudyHours: (itemId: string, hours: number) =>
      mutate(() => api.updateItem(itemId, { studyMinutes: hours * 60 })),
    saveItem: (id: string | null, input: ItemInput) =>
      mutate(() => (id ? api.updateItem(id, input) : api.addItem(input))),
    setStatus: (id: string, status: ItemStatus) => mutate(() => api.setStatus(id, status)),
    deleteItem: (id: string) => mutate(() => api.deleteItem(id)),
  };
}
