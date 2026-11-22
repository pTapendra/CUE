import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useApi } from '../api/ApiContext';
import type { SyncPreview } from '../api/types';
import { useStartup } from '../navigation/startup';
import { type CanvasLogin, useCanvasLogin } from './useCanvasLogin';
import { toReview } from './useSyncReview';

export type Sync = {
  connected: boolean;
  /** The server has Canvas login set up; without it, connecting uses the token form. */
  loginAvailable: boolean;
  /** The account has a Canvas identity, so Settings can offer Log out. */
  linked: boolean;
  lastSyncedAt: string | null;
  /** Cue is reading Canvas, or the Canvas login is starting or finishing. */
  busy: boolean;
  /** For a moment after a sync that found nothing to review: the Sync button shows a check mark. */
  inSync: boolean;
  /**
   * Reads Canvas. Opens Check what Cue found when something is new, changed or removed; otherwise
   * stays, shows `inSync` and tells a screen reader "In sync with Canvas". Without Canvas, connects instead.
   */
  sync(): void;
  /** Starts the in-app Canvas login, or opens the token form in token mode. */
  connect(): void;
  /** Asks the server about the Canvas connection again (after Settings disconnects). */
  reload(): Promise<void>;
  /**
   * The login `connect` starts. The screen shows it with `<CanvasLoginSheet login={sync.login} />`,
   * and `login.error` (a refused or failed login) in an ErrorBanner.
   */
  login: CanvasLogin;
};

/** How long the Sync button shows its check mark after a sync with nothing to review. */
const IN_SYNC_MS = 2000;

/**
 * The Sync button's state and actions, shared by every screen that has one.
 * It asks the server about the Canvas connection each time its screen comes into view.
 */
export function useSync(): Sync {
  const api = useApi();
  const navigation = useNavigation();
  const startup = useStartup();
  // Start-up's answer until the screen's own arrives, so a connected student doesn't see "Connect Canvas" flash.
  const [connected, setConnected] = useState(startup.canvasUrl !== null);
  const [loginAvailable, setLoginAvailable] = useState(startup.loginAvailable);
  const [linked, setLinked] = useState(startup.linked);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [inSync, setInSync] = useState(false);
  // Set at once (state updates later), so a second tap during a read doesn't start another.
  const readingNow = useRef(false);
  const inSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (inSyncTimer.current) clearTimeout(inSyncTimer.current);
    };
  }, []);
  const login = useCanvasLogin(() => {
    readCanvas();
  });

  const load = useCallback(
    (isCurrent: () => boolean) =>
      api
        .getConnection()
        .then((status) => {
          if (!isCurrent()) return;
          setConnected(status.connected);
          setLoginAvailable(status.loginAvailable);
          setLinked(status.linked);
          setLastSyncedAt(status.lastSyncedAt);
        })
        // Keep what the screen knew: the button still works, and the next focus asks again.
        .catch(() => {}),
    [api],
  );

  useFocusEffect(
    useCallback(() => {
      let current = true;
      load(() => current);
      return () => {
        current = false;
      };
    }, [load]),
  );

  function connect() {
    if (loginAvailable) login.start();
    else navigation.navigate('TokenConnect');
  }

  /** Reads Canvas, then opens the review only when there is something to review. */
  async function readCanvas() {
    if (readingNow.current) return;
    readingNow.current = true;
    if (inSyncTimer.current) clearTimeout(inSyncTimer.current);
    setInSync(false);
    setReading(true);
    let preview: SyncPreview | null = null;
    try {
      preview = await api.previewSync();
    } catch {
      // Handled below: the review reads again and explains what went wrong, and how to fix it.
    } finally {
      readingNow.current = false;
      if (mounted.current) setReading(false);
    }
    if (!preview) {
      navigation.navigate('Review');
      return;
    }
    if (toReview(preview)) {
      navigation.navigate('Review', { preview });
      return;
    }
    // Nothing to review (skipped items are shown from Settings → Sync now).
    AccessibilityInfo.announceForAccessibility('In sync with Canvas');
    if (!mounted.current) return;
    setInSync(true);
    inSyncTimer.current = setTimeout(() => {
      if (mounted.current) setInSync(false);
    }, IN_SYNC_MS);
    // The synced time moved on.
    load(() => mounted.current);
  }

  return {
    connected,
    loginAvailable,
    linked,
    lastSyncedAt,
    busy: login.busy || reading,
    inSync,
    sync: () => {
      if (connected) readCanvas();
      else connect();
    },
    connect,
    reload: () => load(() => true),
    login,
  };
}
