import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { dueSoon, noDate, pickUpNext } from './today';
import { useItemActions } from './useItemActions';
import { useOverview } from './useOverview';
import { shortfallText } from './useSchedule';

/** View model for Today: Up next, what is due this week, what has no date, and the changes made from there. */
export function useToday() {
  const { overview, courses, loading, error: loadError, reload: load } = useOverview();
  const actions = useItemActions(load);
  // The phone may sit on Today overnight: when the app comes back to the front, take the time again
  // (the date, week strip, Due soon window and Up next all hang on it) and load what changed since.
  const [now, setNow] = useState(() => new Date());
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    setNow(new Date()); // also each time Today comes back into view, when it reloads
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setNow(new Date());
      load();
    });
    return () => subscription.remove();
  }, [focused, load]);
  const items = overview?.items ?? [];
  const blocks = overview?.blocks ?? [];

  return {
    now,
    /** False until the first load has worked. */
    loaded: overview !== null,
    loading,
    error: actions.error ?? loadError,
    /** Loads again; it also clears an old message. */
    reload: async () => {
      actions.clearError();
      await load();
    },
    courses,
    items,
    blocks,
    upNext: pickUpNext(blocks, items, now),
    dueSoon: dueSoon(items, now),
    noDate: noDate(overview?.undated ?? []),
    shortfalls: (overview?.shortfalls ?? []).map((s) => ({ itemId: s.itemId, text: shortfallText(s) })),
    saveItem: actions.saveItem,
    setStatus: actions.setStatus,
    deleteItem: actions.deleteItem,
    acceptBlock: actions.acceptBlock,
    rejectBlock: actions.rejectBlock,
    moveBlock: actions.moveBlock,
    setStudyHours: actions.setStudyHours,
  };
}
