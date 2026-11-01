import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api/ApiContext';
import { friendlyMessage } from '../api/client';
import type { Course, Item, ItemInput, ItemStatus, Week } from '../api/types';
import { addDays, sameDay, startOfWeek } from '../dates';

export interface DayGroup {
  date: Date;
  items: Item[];
}

/** Splits a week's items into seven days, Monday first. Empty days are kept. */
export function groupByDay(items: Item[], from: Date): DayGroup[] {
  const days: DayGroup[] = Array.from({ length: 7 }, (_, i) => ({ date: addDays(from, i), items: [] }));
  for (const item of items) {
    if (!item.dueAt) continue;
    const due = new Date(item.dueAt);
    const day = days.find((d) => sameDay(d.date, due));
    if (day) day.items.push(item);
  }
  return days;
}

/** View model for the weekly view (UC2). */
export function useWeek(today: Date = new Date()) {
  const api = useApi();
  const [from, setFrom] = useState(() => startOfWeek(today));
  const [week, setWeek] = useState<Week | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [w, c] = await Promise.all([api.getWeek(from), api.listCourses()]);
      setWeek(w);
      setCourses(c.courses);
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

  return {
    from,
    days: week ? groupByDay(week.items, from) : [],
    undated: week?.undated ?? [],
    courses,
    loading,
    error,
    reload: load,
    previousWeek: () => setFrom((f) => addDays(f, -7)),
    nextWeek: () => setFrom((f) => addDays(f, 7)),
    thisWeek: () => setFrom(startOfWeek(new Date())),
    saveItem: (id: string | null, input: ItemInput) =>
      mutate(() => (id ? api.updateItem(id, input) : api.addItem(input))),
    setStatus: (id: string, status: ItemStatus) => mutate(() => api.setStatus(id, status)),
    deleteItem: (id: string) => mutate(() => api.deleteItem(id)),
  };
}
