import { useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { useApi } from '../api/ApiContext';
import { friendlyMessage } from '../api/client';
import { setOnboarded } from '../prefs';

/** View model for the Connect Canvas screen. */
export function useConnectCanvas(initialUrl = '') {
  const api = useApi();
  const [baseUrl, setBaseUrl] = useState(initialUrl);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = baseUrl.trim().length > 0 && token.trim().length >= 10 && !busy;
  const settingsUrl = canvasSettingsUrl(baseUrl);

  /** Opens the school's Canvas settings in a browser inside the app, where the token is made. */
  async function openCanvasSettings(): Promise<void> {
    if (!settingsUrl) return;
    setError(null);
    try {
      await WebBrowser.openBrowserAsync(settingsUrl);
    } catch {
      setError(`Could not open Canvas. Open ${settingsUrl} in your phone's browser instead.`);
    }
  }

  async function connect(): Promise<boolean> {
    if (!canSubmit) return false;
    setBusy(true);
    setError(null);
    try {
      await api.connectCanvas(normalizeUrl(baseUrl), token.trim());
      // Connected once: Welcome doesn't show again, even after a disconnect (see useCanvasLogin).
      await setOnboarded(api.store, true).catch(() => {});
      setToken('');
      return true;
    } catch (err) {
      setError(friendlyMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    baseUrl,
    setBaseUrl,
    token,
    setToken,
    busy,
    error,
    canSubmit,
    connect,
    canOpenSettings: settingsUrl != null,
    openCanvasSettings,
  };
}

/** Accepts "school.instructure.com" as well as a full https:// address. */
export function normalizeUrl(input: string): string {
  const t = input.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/**
 * The Canvas page where students create an access token, or null when the
 * address cannot be a Canvas site yet. Only the host is kept, as on the server.
 */
export function canvasSettingsUrl(input: string): string | null {
  const m = /^(https?:\/\/[^/?#\s]+)(?:[/?#]\S*)?$/i.exec(normalizeUrl(input));
  return m ? `${m[1]}/profile/settings` : null;
}
