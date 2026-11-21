import { CanvasLoginRefusedError, type CanvasLogin, type CanvasTokens } from "./CanvasLogin.js";

/** In-memory CanvasLogin for tests. */
export class FakeCanvasLogin implements CanvasLogin {
  readonly canvasUrl = "https://canvas.test";
  expiresInSeconds: number | null = 3600;
  /** Canvas user ID for each code that Canvas accepts. */
  users: Record<string, string> = { "good-code": "42" };
  refuseRenewal = false;
  failRevoke = false;
  renewals = 0;
  revoked: string[] = [];

  authorizeUrl(state: string): string {
    return `${this.canvasUrl}/login/oauth2/auth?state=${state}`;
  }

  async exchangeCode(code: string): Promise<CanvasTokens & { userId: string }> {
    if (!Object.hasOwn(this.users, code)) throw new CanvasLoginRefusedError();
    return {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresInSeconds: this.expiresInSeconds,
      userId: this.users[code],
    };
  }

  async renew(_refreshToken: string): Promise<CanvasTokens> {
    if (this.refuseRenewal) throw new CanvasLoginRefusedError();
    this.renewals += 1;
    return { accessToken: `access-${this.renewals + 1}`, refreshToken: null, expiresInSeconds: this.expiresInSeconds };
  }

  async revoke(accessToken: string): Promise<void> {
    if (this.failRevoke) throw new Error("revoke failed");
    this.revoked.push(accessToken);
  }
}
