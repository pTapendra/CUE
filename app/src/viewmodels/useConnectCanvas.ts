import { useState } from 'react';
import { useApi } from '../api/ApiContext';
import { friendlyMessage } from '../api/client';

/** View model for the Connect Canvas screen. */
export function useConnectCanvas(initialUrl = '') {
  const api = useApi();
  const [baseUrl, setBaseUrl] = useState(initialUrl);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = baseUrl.trim().length > 0 && token.trim().length >= 10 && !busy;

  async function connect(): Promise<boolean> {
    if (!canSubmit) return false;
    setBusy(true);
    setError(null);
    try {
      await api.connectCanvas(normalizeUrl(baseUrl), token.trim());
      setToken('');
      return true;
    } catch (err) {
      setError(friendlyMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { baseUrl, setBaseUrl, token, setToken, busy, error, canSubmit, connect };
}

/** Accepts "school.instructure.com" as well as a full https:// address. */
export function normalizeUrl(input: string): string {
  const t = input.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}
