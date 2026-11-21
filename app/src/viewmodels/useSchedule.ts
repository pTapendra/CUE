import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useApi } from '../api/ApiContext';
import { friendlyMessage } from '../api/client';
import type { Course, Shortfall, StudyBlock, StudyWindow, Week } from '../api/types';
import { addDays, dayLabel, startOfDay, startOfWeek } from '../dates';
import { syncTimeZone } from '../timeZone';
import { gridRange, timedEventsFor } from './grid';
import { useItemActions } from './useItemActions';

export type ScheduleView = 'day' | '3days' | 'week';

/** Days on screen in each view; the arrows move by this many. */
export const DAYS_IN_VIEW: Record<ScheduleView, number> = { day: 1, '3days': 3, week: 7 };

/** The first day of the page that shows `date`, at local midnight: its Monday in week view, else the day itself. */
export function pageStart(view: ScheduleView, date: Date): Date {
  return view === 'week' ? startOfWeek(date) : startOfDay(date);
}

type Page = { view: ScheduleView; from: Date };

/** `next`, unless it is the page already shown (so nothing reloads). */
function keep(current: Page, next: Page): Page {
  return current.view === next.view && current.from.getTime() === next.from.getTime() ? current : next;
}

/** "DB final: 5 of 6 hours fit before Mon 9 Nov. Add study times or lower the hours." */
export function shortfallText(s: Shortfall): string {
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

/**
 * View model for Schedule: a time grid of 1, 3 or 7 days with deadlines and study blocks (UC2).
 * `open` is the first page shown; `show` opens another one later (as route params do).
 */
export function useSchedule(open: { view: ScheduleView; date: Date }) {
  const api = useApi();
  const [page, setPage] = useState<Page>(() => ({ view: open.view, from: pageStart(open.view, open.date) }));
  const [week, setWeek] = useState<Week | null>(null);
  const [windows, setWindows] = useState<StudyWindow[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [opened, setOpened] = useState<StudyBlock | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setError] = useState<string | null>(null);
  // Only the latest request may fill the screen: paging quickly must not show an older page's answer.
  const latest = useRef(0);

  const { view, from } = page;
  const count = DAYS_IN_VIEW[view];

  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const [w, c, s] = await Promise.all([
        // Up to local midnight after the last day: a page over a clock change is not a whole number of 24 hours.
        api.getWeek(from, addDays(from, count)),
        api.listCourses(),
        api.getPlannerSettings(),
      ]);
      if (mine !== latest.current) return;
      setWeek(w);
      setCourses(c.courses);
      setWindows(s.windows);
    } catch (err) {
      if (mine === latest.current) setError(friendlyMessage(err));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [api, from, count]);

  // Actions and the time zone handler outlive the page they began on: they must reload the page
  // on screen when they finish, not the one whose `load` they were created with.
  const loadRef = useRef(load);
  loadRef.current = load;
  const reloadCurrent = useCallback(() => loadRef.current(), []);

  const actions = useItemActions(reloadCurrent);
  const { clearError } = actions;

  useEffect(() => {
    clearError();
    load();
  }, [load, clearError]);

  // The phone may be in another time zone when the student comes back to the app.
  // When the server gets a new zone it re-plans, so load the page again.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      syncTimeZone(api).then((changed) => {
        if (changed) reloadCurrent();
      });
    });
    return () => subscription.remove();
  }, [api, reloadCurrent]);

  /** Opens the page with `date` in `view` (or the current view). */
  const show = useCallback((nextView: ScheduleView | undefined, date: Date) => {
    setPage((p) => {
      const v = nextView ?? p.view;
      return keep(p, { view: v, from: pageStart(v, date) });
    });
  }, []);

  /** Switches view around today when it is on screen, else around the first day shown. */
  const setView = useCallback((nextView: ScheduleView) => {
    setPage((p) => {
      const now = new Date();
      const showsToday = now >= p.from && now < addDays(p.from, DAYS_IN_VIEW[p.view]);
      return keep(p, { view: nextView, from: pageStart(nextView, showsToday ? now : p.from) });
    });
  }, []);

  /** Saves the item's study time. The open block keeps the new amount even if the re-plan moved it away. */
  async function setStudyHours(itemId: string, hours: number): Promise<boolean> {
    const ok = await actions.setStudyHours(itemId, hours);
    if (ok) setOpened((b) => (b && b.itemId === itemId ? { ...b, itemStudyMinutes: hours * 60 } : b));
    return ok;
  }

  const days = Array.from({ length: count }, (_, i) => addDays(from, i));
  const items = week?.items ?? [];
  const blocks = week?.blocks ?? [];
  const events = days.flatMap((day) => timedEventsFor(day, items));
  const openBlock = opened ? findOpenBlock(opened, blocks) : null;

  return {
    view,
    from,
    days,
    range: gridRange(days, windows, blocks, events),
    blocks,
    items,
    shortfalls: (week?.shortfalls ?? []).map((s) => ({ itemId: s.itemId, text: shortfallText(s) })),
    courses,
    loading,
    error: actions.error ?? loadError,
    /** Loads again, as a pull to refresh does; it also clears an old message. */
    reload: async () => {
      clearError();
      await load();
    },
    setView,
    show,
    previous: () => setPage((p) => ({ ...p, from: addDays(p.from, -DAYS_IN_VIEW[p.view]) })),
    next: () => setPage((p) => ({ ...p, from: addDays(p.from, DAYS_IN_VIEW[p.view]) })),
    goToday: () => setPage((p) => keep(p, { view: p.view, from: pageStart(p.view, new Date()) })),
    suggestedCount: blocks.filter((b) => b.state === 'proposed').length,
    /** Accepts every suggestion that starts on the days on screen. */
    acceptVisible: () => actions.run(() => api.acceptBlocks(from, addDays(from, count))),
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
