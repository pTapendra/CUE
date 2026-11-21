import { CanvasUnavailableError } from "./CanvasClient.js";
import {
  CANVAS_SCOPES,
  CanvasLoginRefusedError,
  OOB_REDIRECT,
  type CanvasLogin,
  type CanvasLoginSettings,
  type CanvasTokens,
} from "./CanvasLogin.js";

type Fetch = typeof fetch;

/**
 * Makes Canvas's OAuth token requests. The client secret is only ever sent
 * in the body of a token request to Canvas; it is never put in an error.
 */
export class HttpCanvasLogin implements CanvasLogin {
  readonly canvasUrl: string;

  constructor(
    private readonly settings: CanvasLoginSettings,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    this.canvasUrl = settings.canvasUrl.replace(/\/+$/, "");
  }

  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.settings.clientId,
      response_type: "code",
      redirect_uri: OOB_REDIRECT,
      state,
      scope: CANVAS_SCOPES.join(" "),
    });
    return `${this.canvasUrl}/login/oauth2/auth?${params}`;
  }

  exchangeCode(code: string): Promise<CanvasTokens> {
    return this.tokenRequest({ grant_type: "authorization_code", redirect_uri: OOB_REDIRECT, code });
  }

  renew(refreshToken: string): Promise<CanvasTokens> {
    return this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  async revoke(accessToken: string): Promise<void> {
    const res = await this.send({
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) throw new CanvasUnavailableError(`HTTP ${res.status}`);
  }

  private async tokenRequest(fields: Record<string, string>): Promise<CanvasTokens> {
    const body = new URLSearchParams({
      ...fields,
      client_id: this.settings.clientId,
      client_secret: this.settings.clientSecret,
    });
    const res = await this.send({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
    if (res.status === 400 || res.status === 401) throw new CanvasLoginRefusedError();
    if (!res.ok) throw new CanvasUnavailableError(`HTTP ${res.status}`);
    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new CanvasUnavailableError("Unreadable token reply");
    }
    if (!json || typeof json.access_token !== "string" || !json.access_token) {
      throw new CanvasUnavailableError("Token reply had no access token");
    }
    // Keep only the tokens and expiry; `user` and anything else is dropped.
    return {
      accessToken: json.access_token,
      refreshToken: typeof json.refresh_token === "string" && json.refresh_token ? json.refresh_token : null,
      expiresInSeconds: typeof json.expires_in === "number" ? json.expires_in : null,
    };
  }

  private async send(init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.canvasUrl}/login/oauth2/token`, init);
    } catch (err) {
      throw new CanvasUnavailableError((err as Error).message);
    }
  }
}
