export type LoginReturn = { kind: 'code'; code: string } | { kind: 'denied' } | { kind: 'mismatch' };

const RETURN_PATH = '/login/oauth2/auth';

/**
 * Canvas's "out-of-band" return address is a page on Canvas's own site that carries
 * `code` (or `error`) and our `state`. Returns null for any other URL, so the page loads.
 */
export function readLoginReturn(url: string, authorizeUrl: string, state: string): LoginReturn | null {
  let target: URL;
  let origin: string;
  try {
    target = new URL(url);
    origin = new URL(authorizeUrl).origin;
  } catch {
    return null;
  }
  if (target.origin !== origin || target.pathname !== RETURN_PATH) return null;
  const code = target.searchParams.get('code');
  const error = target.searchParams.get('error');
  if (code == null && error == null) return null;
  if (target.searchParams.get('state') !== state) return { kind: 'mismatch' };
  if (error != null) return { kind: 'denied' };
  return { kind: 'code', code: code as string };
}
