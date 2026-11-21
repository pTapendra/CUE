import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useApi } from '../api/ApiContext';
import { friendlyMessage } from '../api/client';
import type { Course, Shortfall, StudyBlock, StudyWindow, Week } from '../api/types';
import { addDays, dayLabel, startOfDay } from '../dates';
import { syncTimeZone } from '../timeZone';
import { gridRange, timedEventsFor } from './grid';
import { useItemActions } from './useItemActions';

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
  const [loadError, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [w, c, s] = await Promise.all([
        // Up to local midnight after the last day: a page over a clock change is not 72 hours.
        api.getWeek(from, addDays(from, DAYS_PER_PAGE)),
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

  const actions = useItemActions(load);
  const { clearError } = actions;

  useEffect(() => {
    clearError();
    load();
  }, [load, clearError]);

  // The phone may be in another time zone when the student comes back to the app.
  // When the server gets a new zone it re-plans, so load the week again.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      syncTimeZone(api).then((changed) => {
        if (changed) load();
      });
    });
    return () => subscription.remove();
  }, [api, load]);

  /** Saves the item's study time. The open block keeps the new amount even if the re-plan moved it away. */
  async function setStudyHours(itemId: string, hours: number): Promise<boolean> {
    const ok = await actions.setStudyHours(itemId, hours);
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
    error: actions.error ?? loadError,
    /** Loads again, as a pull to refresh does; it also clears an old message. */
    reload: async () => {
      clearError();
      await load();
    },
    previous: () => setFrom((f) => addDays(f, -DAYS_PER_PAGE)),
    next: () => setFrom((f) => addDays(f, DAYS_PER_PAGE)),
    goToday: () => setFrom(startOfDay(new Date())),
    suggestedCount: blocks.filter((b) => b.state === 'proposed').length,
    acceptVisible: () => actions.run(() => api.acceptBlocks(from, addDays(from, DAYS_PER_PAGE))),
    /** The block whose sheet is open, kept up to date across reloads. */
    openBlock,
    /** Hours of study the open block's item needs. */
    openBlockHours: openBlock ? openBlock.itemStudyMinutes / 60 : 0,
    showBlock: (block: StudyBlock) => setOpened(block),
    closeBlock: () => setOpened(null),
    acceptBlock: actions.acceptBlock,
    rejectBlock: actions.rejectBlock,
    moveBlock: actions.moveBlock,
    setStudyHours,
    saveItem: actions.saveItem,
    setStatus: actions.setStatus,
    deleteItem: actions.deleteItem,
  };
}
