export type LoginReturn = { kind: 'code'; code: string } | { kind: 'denied' } | { kind: 'failed' } | { kind: 'mismatch' };

const RETURN_PATH = '/login/oauth2/auth';

/**
 * Canvas's "out-of-band" return address is a page on Canvas's own site that carries
 * `code` (or `error`) and our `state`. The host is compared, not the origin: behind a
 * tunnel Canvas may build an http:// address. Returns null for any other URL, so the page loads.
 */
export function readLoginReturn(url: string, authorizeUrl: string, state: string): LoginReturn | null {
  let target: URL;
  let host: string;
  try {
    target = new URL(url);
    host = new URL(authorizeUrl).hostname;
  } catch {
    return null;
  }
  if (target.hostname !== host || target.pathname !== RETURN_PATH) return null;
  const code = target.searchParams.get('code');
  const error = target.searchParams.get('error');
  if (code == null && error == null) return null;
  if (target.searchParams.get('state') !== state) return { kind: 'mismatch' };
  if (error != null) return { kind: error === 'access_denied' ? 'denied' : 'failed' };
  return { kind: 'code', code: code as string };
}

const NGROK_HOSTS = ['.ngrok-free.dev', '.ngrok-free.app', '.ngrok.io'];

/**
 * The user agent for the login screen's web view. A free ngrok address shows
 * a warning page ("Visit Site") to any user agent that starts with "Mozilla",
 * as every browser's does, and Cue's private login screen forgets the click
 * after each login. A Cue user agent skips that page for the page and its
 * stylesheets alike. Any other Canvas address keeps the default (undefined).
 */
export function loginUserAgent(authorizeUrl: string, platform: string): string | undefined {
  let host: string;
  try {
    host = new URL(authorizeUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (!NGROK_HOSTS.some((suffix) => host.endsWith(suffix))) return undefined;
  return platform === 'android'
    ? 'CueApp/0.1 (Linux; Android) AppleWebKit/537.36 (KHTML, like Gecko) Mobile'
    : 'CueApp/0.1 (iPhone; CPU iPhone OS like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
}
