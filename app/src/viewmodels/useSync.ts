import { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useApi } from '../api/ApiContext';
import { useStartup } from '../navigation/startup';
import { type CanvasLogin, useCanvasLogin } from './useCanvasLogin';

export type Sync = {
  connected: boolean;
  /** The server has Canvas login set up; without it, connecting uses the token form. */
  loginAvailable: boolean;
  /** The account has a Canvas identity, so Settings can offer Log out. */
  linked: boolean;
  lastSyncedAt: string | null;
  /** The Canvas login is starting or finishing. */
  busy: boolean;
  /** Opens Check what Cue found, which runs the sync. Without Canvas, connects instead. */
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
  const login = useCanvasLogin(() => navigation.navigate('Review'));

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

  return {
    connected,
    loginAvailable,
    linked,
    lastSyncedAt,
    busy: login.busy,
    sync: () => (connected ? navigation.navigate('Review') : connect()),
    connect,
    reload: () => load(() => true),
    login,
  };
}
