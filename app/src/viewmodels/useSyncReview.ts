import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api/ApiContext';
import { ApiError, friendlyMessage } from '../api/client';
import type { ProposedItem, SyncPreview } from '../api/types';

/** Sync failures that connecting Canvas again fixes. */
const CONNECT_AGAIN = new Set(['canvas_token_rejected', 'canvas_not_connected']);

/** View model for reviewing Canvas items before they are saved (UC1). */
export function useSyncReview() {
  const api = useApi();
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dates, setDates] = useState<Record<string, string | null>>({});
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
      setSelected(new Set(p.items.map((i) => i.key)));
      setDates({});
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

  async function confirm(): Promise<number | null> {
    if (!preview) return null;
    setSaving(true);
    setError(null);
    try {
      const res = await api.confirmSync(preview.syncId, [...selected], buildDates(dates, selected));
      return res.imported;
    } catch (err) {
      setError(friendlyMessage(err));
      return null;
    } finally {
      setSaving(false);
    }
  }

  return {
    preview,
    selected,
    toggle,
    dates,
    setDate,
    /** The proposed items grouped by course, with the count to show. */
    groups: groupByCourse(preview?.items ?? []),
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
