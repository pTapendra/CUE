import { useRef, useState } from 'react';
import { useApi } from '../api/ApiContext';
import { friendlyMessage } from '../api/client';
import { readLoginReturn } from './canvasLogin';

interface Session {
  authorizeUrl: string;
  state: string;
  finished: boolean;
}

/** View model for the Log in with Canvas screen. */
export function useCanvasLogin(onConnected: () => void) {
  const api = useApi();
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Refs, not state: the web view can report the return address several times in one tick.
  const session = useRef<Session | null>(null);
  const attempt = useRef(0);

  function close(message: string | null) {
    setAuthorizeUrl(null);
    setError(message);
  }

  async function start(): Promise<void> {
    const mine = ++attempt.current;
    session.current = null;
    setError(null);
    setBusy(true);
    try {
      const res = await api.startCanvasLogin();
      if (mine !== attempt.current) return; // cancelled while waiting
      session.current = { authorizeUrl: res.authorizeUrl, state: res.state, finished: false };
      setAuthorizeUrl(res.authorizeUrl);
    } catch (err) {
      if (mine === attempt.current) setError(friendlyMessage(err));
    } finally {
      if (mine === attempt.current) setBusy(false);
    }
  }

  /** Returns false when the web view must not load this URL. */
  function onNavigate(url: string): boolean {
    const s = session.current;
    if (!s) return true;
    const found = readLoginReturn(url, s.authorizeUrl, s.state);
    if (!found) return true;
    if (s.finished) return false;
    s.finished = true;
    if (found.kind === 'denied') {
      close("You didn't allow Cue to read Canvas.");
    } else if (found.kind === 'mismatch') {
      close("The login didn't complete. Please try again.");
    } else {
      finish(s, found.code);
    }
    return false;
  }

  async function finish(s: Session, code: string): Promise<void> {
    const mine = attempt.current;
    setBusy(true);
    try {
      await api.finishCanvasLogin(code, s.state);
      if (mine !== attempt.current) return;
      close(null);
      onConnected();
    } catch (err) {
      if (mine === attempt.current) close(friendlyMessage(err));
    } finally {
      if (mine === attempt.current) setBusy(false);
    }
  }

  function cancel(): void {
    attempt.current++;
    session.current = null;
    setBusy(false);
    close(null);
  }

  return { authorizeUrl, busy, error, start, onNavigate, cancel };
}
