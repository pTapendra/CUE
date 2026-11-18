import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api/ApiContext';
import { friendlyMessage } from '../api/client';
import type { Course, ItemInput, ItemStatus, Shortfall, StudyBlock, StudyWindow, Week } from '../api/types';
import { addDays, dayLabel, fromInput, startOfDay } from '../dates';
import { gridRange, timedEventsFor } from './grid';

/** Days the grid shows at once; the arrows move by this many. */
export const DAYS_PER_PAGE = 3;

/** "DB final: 5 of 6 hours fit before Mon 9 Nov. Add study times or lower the hours." */
function shortfallText(s: Shortfall): string {
  const fit = `${s.plannedMinutes / 60} of ${s.neededMinutes / 60} hours fit`;
  return `${s.itemTitle}: ${fit} before ${dayLabel(new Date(s.dueAt))}. Add study times or lower the hours.`;
}

/**
 * The open block as the latest load has it. A re-plan gives suggestions new ids, so look for
 * the same id, else the same item's block at the same start; else keep the block as it was opened.
 */
function findOpenBlock(opened: StudyBlock, blocks: StudyBlock[]): StudyBlock {
  return (
    blocks.find((b) => b.id === opened.id) ??
    blocks.find((b) => b.itemId === opened.itemId && b.startsAt === opened.startsAt) ??
    opened
  );
}

/** View model for the Week screen: a time grid of a few days with study blocks (UC2). */
export function useWeek(today: Date = new Date()) {
  const api = useApi();
  const [from, setFrom] = useState(() => startOfDay(today));
  const [week, setWeek] = useState<Week | null>(null);
  const [windows, setWindows] = useState<StudyWindow[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [opened, setOpened] = useState<StudyBlock | null>(null);
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

  /** Runs a change, then reloads the week. If it fails, reloads anyway and then shows the error; returns false. */
  async function mutate(action: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    try {
      await action();
      await load();
      return true;
    } catch (err) {
      // load() clears the error, so show this one once the reload has finished.
      await load();
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

  /** Saves the item's study time. The open block keeps the new amount even if the re-plan moved it away. */
  async function setStudyHours(itemId: string, hours: number): Promise<boolean> {
    const ok = await mutate(() => api.updateItem(itemId, { studyMinutes: hours * 60 }));
    if (ok) setOpened((b) => (b && b.itemId === itemId ? { ...b, itemStudyMinutes: hours * 60 } : b));
    return ok;
  }

  const days = Array.from({ length: DAYS_PER_PAGE }, (_, i) => addDays(from, i));
  const items = week?.items ?? [];
  const blocks = week?.blocks ?? [];
  const events = days.flatMap((day) => timedEventsFor(day, items));
  const openBlock = opened ? findOpenBlock(opened, blocks) : null;

  return {
    from,
    days,
    range: gridRange(days, windows, blocks, events),
    blocks,
    items,
    undated: week?.undated ?? [],
    shortfalls: (week?.shortfalls ?? []).map((s) => ({ itemId: s.itemId, text: shortfallText(s) })),
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
    /** The block whose sheet is open, kept up to date across reloads. */
    openBlock,
    /** Hours of study the open block's item needs. */
    openBlockHours: openBlock ? openBlock.itemStudyMinutes / 60 : 0,
    showBlock: (block: StudyBlock) => setOpened(block),
    closeBlock: () => setOpened(null),
    acceptBlock: (id: string) => mutate(() => api.acceptBlock(id)),
    rejectBlock: (id: string) => mutate(() => api.rejectBlock(id)),
    moveBlock,
    setStudyHours,
    saveItem: (id: string | null, input: ItemInput) =>
      mutate(() => (id ? api.updateItem(id, input) : api.addItem(input))),
    setStatus: (id: string, status: ItemStatus) => mutate(() => api.setStatus(id, status)),
    deleteItem: (id: string) => mutate(() => api.deleteItem(id)),
  };
}
