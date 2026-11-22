import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api/ApiContext';
import { ApiError, friendlyMessage } from '../api/client';
import type { FieldChange, ProposedItem, SyncCounts, SyncPreview } from '../api/types';
import { dayLabel, timeLabel } from '../dates';

/** Sync failures that connecting Canvas again fixes. */
const CONNECT_AGAIN = new Set(['canvas_token_rejected', 'canvas_not_connected']);

/**
 * View model for reviewing what a sync found before it is saved (UC1): the new items to tick,
 * Canvas's changes and removals (applied on Save), and the items skipped before.
 */
export function useSyncReview() {
  const api = useApi();
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dates, setDates] = useState<Record<string, string | null>>({});
  const [showSkipped, setShowSkipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConnect, setNeedsConnect] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsConnect(false);
    try {
      const p = await api.previewSync();
      setPreview(p);
      setSelected(new Set(p.newItems.map((i) => i.key)));
      setDates({});
      setShowSkipped(false);
    } catch (err) {
      setError(friendlyMessage(err));
      setNeedsConnect(err instanceof ApiError && CONNECT_AGAIN.has(err.code));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** The date the student picked for an item (an ISO date), or null to leave it for later. */
  const setDate = (key: string, iso: string | null) => setDates((prev) => ({ ...prev, [key]: iso }));

  async function confirm(): Promise<SyncCounts | null> {
    if (!preview) return null;
    setSaving(true);
    setError(null);
    try {
      return await api.confirmSync(preview.syncId, [...selected], buildDates(dates, selected));
    } catch (err) {
      setError(friendlyMessage(err));
      return null;
    } finally {
      setSaving(false);
    }
  }

  const nothingListed = !preview || (preview.newItems.length === 0 && preview.changed.length === 0 && preview.removed.length === 0);

  return {
    preview,
    selected,
    toggle,
    dates,
    setDate,
    /** The new items grouped by course. */
    groups: groupByCourse(preview?.newItems ?? []),
    changed: preview?.changed ?? [],
    removed: preview?.removed ?? [],
    /** The skipped items grouped by course, shown once the student asks. */
    skippedGroups: groupByCourse(preview?.skipped ?? []),
    skippedCount: preview?.skipped.length ?? 0,
    showSkipped,
    revealSkipped: () => setShowSkipped(true),
    /** Nothing new, changed or removed. */
    nothingListed,
    /** Save is offered when there is something to save: anything listed, or a skipped item ticked again. */
    canSave: !!preview && (!nothingListed || selected.size > 0),
    loading,
    saving,
    error,
    /** The sync failed because Canvas must be connected (again): offer to log in. */
    needsConnect,
    reload: load,
    confirm,
  };
}

/** Keeps the picked dates of the accepted items only. */
export function buildDates(dates: Record<string, string | null>, selected: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, iso] of Object.entries(dates)) {
    if (selected.has(key) && iso) out[key] = iso;
  }
  return out;
}

/** Items grouped by course, in the order each course first appears. */
export function groupByCourse(items: ProposedItem[]): { courseName: string; items: ProposedItem[] }[] {
  const groups = new Map<string, ProposedItem[]>();
  for (const item of items) {
    const list = groups.get(item.courseName);
    if (list) list.push(item);
    else groups.set(item.courseName, [item]);
  }
  return [...groups].map(([courseName, list]) => ({ courseName, items: list }));
}

const counted = (parts: [number, string][]) =>
  parts
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`)
    .join(', ');

/** "1 new, 1 changed, 1 removed", leaving out what is zero. */
export function summaryLine(p: SyncPreview): string {
  return counted([
    [p.newItems.length, 'new'],
    [p.changed.length, 'changed'],
    [p.removed.length, 'removed'],
  ]);
}

/** "2 added, 1 updated", leaving out what is zero; "Saved" when only skips were recorded. */
export function savedToast(c: SyncCounts): string {
  return (
    counted([
      [c.added, 'added'],
      [c.updated, 'updated'],
      [c.removed, 'removed'],
    ]) || 'Saved'
  );
}

const LABELS: Record<FieldChange['field'], { shown: string; spoken: string; none: string }> = {
  title: { shown: 'Title', spoken: 'title', none: 'no title' },
  dueAt: { shown: 'Due', spoken: 'due date', none: 'no date' },
  endsAt: { shown: 'Ends', spoken: 'end', none: 'no end' },
  allDay: { shown: 'All day', spoken: 'all day', none: '' },
};

/** One change as the review shows it ("Due: Fri 27 Nov · 23:59 → Mon 30 Nov · 23:59") and as a screen reader says it. */
export function describeChange(c: FieldChange): { shown: string; spoken: string } {
  const label = LABELS[c.field];
  const value = (v: string | boolean | null, spoken: boolean): string => {
    if (typeof v === 'boolean') return spoken ? (v ? 'yes' : 'no') : v ? 'Yes' : 'No';
    if (v === null) return label.none;
    if (c.field === 'title') return v;
    const d = new Date(v);
    return spoken ? `${dayLabel(d)}, ${timeLabel(d)}` : `${dayLabel(d)} · ${timeLabel(d)}`;
  };
  return {
    shown: `${label.shown}: ${value(c.from, false)} → ${value(c.to, false)}`,
    spoken: `${label.spoken} changed from ${value(c.from, true)} to ${value(c.to, true)}`,
  };
}
