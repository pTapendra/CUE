import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api/ApiContext';
import { friendlyMessage } from '../api/client';
import type { SyncPreview } from '../api/types';
import { fromInput } from '../dates';

/** View model for reviewing Canvas items before they are saved (UC1). */
export function useSyncReview() {
  const api = useApi();
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dateText, setDateText] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await api.previewSync();
      setPreview(p);
      setSelected(new Set(p.items.map((i) => i.key)));
      setDateText({});
    } catch (err) {
      setError(friendlyMessage(err));
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

  const setDate = (key: string, text: string) => setDateText((prev) => ({ ...prev, [key]: text }));

  /** Keys whose typed date is not a valid date. */
  const invalidDates = Object.entries(dateText)
    .filter(([, text]) => fromInput(text) === undefined)
    .map(([key]) => key);

  async function confirm(): Promise<number | null> {
    if (!preview || invalidDates.length > 0) return null;
    setSaving(true);
    setError(null);
    try {
      const dates = buildDates(dateText, selected);
      const res = await api.confirmSync(preview.syncId, [...selected], dates);
      return res.imported;
    } catch (err) {
      setError(friendlyMessage(err));
      return null;
    } finally {
      setSaving(false);
    }
  }

  return { preview, selected, toggle, dateText, setDate, invalidDates, loading, saving, error, reload: load, confirm };
}

/** Turns the student's typed dates into ISO dates for the accepted items only. */
export function buildDates(dateText: Record<string, string>, selected: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(dateText)) {
    const iso = fromInput(text);
    if (selected.has(key) && iso) out[key] = iso;
  }
  return out;
}
