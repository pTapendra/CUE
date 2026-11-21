/**
 * Adapter interface for logging in with Canvas (OAuth, out-of-band return).
 * These are the only requests Cue makes to Canvas that are not reads:
 * exchanging a code, renewing, and revoking, all on /login/oauth2/token.
 */
export const OOB_REDIRECT = "urn:ietf:wg:oauth:2.0:oob";
export const CANVAS_SCOPES = [
  "url:GET|/api/v1/courses",
  "url:GET|/api/v1/courses/:course_id/assignments",
  "url:GET|/api/v1/calendar_events",
] as const;

export interface CanvasLoginSettings {
  canvasUrl: string;
  clientId: string;
  clientSecret: string;
}

export interface CanvasTokens {
  accessToken: string;
  /** null: keep the one already stored. */
  refreshToken: string | null;
  /** null: the access token does not expire. */
  expiresInSeconds: number | null;
}

export interface CanvasLogin {
  /** No trailing slash. */
  readonly canvasUrl: string;
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<CanvasTokens>;
  renew(refreshToken: string): Promise<CanvasTokens>;
  revoke(accessToken: string): Promise<void>;
}

/** Canvas refused a code or refresh token (HTTP 400 or 401 from /login/oauth2/token). */
export class CanvasLoginRefusedError extends Error {
  constructor(message = "Canvas refused the login") {
    super(message);
    this.name = "CanvasLoginRefusedError";
  }
}
