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
