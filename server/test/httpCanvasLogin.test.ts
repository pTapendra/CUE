import { describe, expect, it } from "vitest";
import { CanvasUnavailableError } from "../src/canvas/CanvasClient.js";
import { CANVAS_SCOPES, CanvasLoginRefusedError, OOB_REDIRECT } from "../src/canvas/CanvasLogin.js";
import { HttpCanvasLogin } from "../src/canvas/HttpCanvasLogin.js";

const settings = { canvasUrl: "https://canvas.test/", clientId: "10000000000001", clientSecret: "s/e+c=r&t" };

type Call = { url: string; method: string; contentType: string | null; auth: string | null; body: string };

function fakeFetch(reply: { status?: number; body?: unknown } | Error) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      contentType: headers.get("content-type"),
      auth: headers.get("authorization"),
      body: init?.body ? String(init.body) : "",
    });
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}

describe("HttpCanvasLogin", () => {
  it("builds the authorize URL with the out-of-band return and the three read scopes", () => {
    const login = new HttpCanvasLogin(settings, fakeFetch({}).impl);
    expect(login.canvasUrl).toBe("https://canvas.test");
    const url = new URL(login.authorizeUrl("st"));
    expect(url.origin + url.pathname).toBe("https://canvas.test/login/oauth2/auth");
    expect(url.searchParams.get("client_id")).toBe("10000000000001");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(OOB_REDIRECT);
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("scope")).toBe(CANVAS_SCOPES.join(" "));
  });

  it("exchanges a code with a form POST and keeps only the tokens, expiry and user ID", async () => {
    const { impl, calls } = fakeFetch({
      body: { access_token: "a", refresh_token: "r", expires_in: 3600, token_type: "Bearer", user: { id: 7, name: "Ada" } },
    });
    const tokens = await new HttpCanvasLogin(settings, impl).exchangeCode("the-code");
    expect(tokens).toEqual({ accessToken: "a", refreshToken: "r", expiresInSeconds: 3600, userId: "7" });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("https://canvas.test/login/oauth2/token");
    expect(calls[0].contentType).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(calls[0].body);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "authorization_code",
      client_id: "10000000000001",
      client_secret: "s/e+c=r&t",
      redirect_uri: OOB_REDIRECT,
      code: "the-code",
    });
  });

  it("exchangeCode returns the Canvas user ID as a string", async () => {
    const { impl } = fakeFetch({
      body: { access_token: "a", refresh_token: "r", expires_in: 3600, user: { id: 42, name: "Maya Thompson" } },
    });
    const result = await new HttpCanvasLogin(settings, impl).exchangeCode("c");
    expect(result.userId).toBe("42");
    expect(JSON.stringify(result)).not.toContain("Maya");
  });

  it("a token reply without user.id is CanvasUnavailableError", async () => {
    for (const body of [
      { access_token: "a" },
      { access_token: "a", user: { name: "x" } },
    ]) {
      const { impl } = fakeFetch({ body });
      await expect(new HttpCanvasLogin(settings, impl).exchangeCode("c")).rejects.toBeInstanceOf(CanvasUnavailableError);
    }
  });

  it("renews with grant_type=refresh_token; a reply without expires_in or refresh_token gives nulls", async () => {
    const { impl, calls } = fakeFetch({ body: { access_token: "b", token_type: "Bearer" } });
    const tokens = await new HttpCanvasLogin(settings, impl).renew("old-refresh");
    expect(tokens).toEqual({ accessToken: "b", refreshToken: null, expiresInSeconds: null });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("https://canvas.test/login/oauth2/token");
    const form = new URLSearchParams(calls[0].body);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("old-refresh");
    expect(form.get("client_id")).toBe("10000000000001");
    expect(form.get("client_secret")).toBe("s/e+c=r&t");
  });

  it("a 400 or 401 from the token endpoint is CanvasLoginRefusedError; a 500 or network error is CanvasUnavailableError", async () => {
    for (const status of [400, 401]) {
      const login = new HttpCanvasLogin(settings, fakeFetch({ status }).impl);
      await expect(login.exchangeCode("x")).rejects.toBeInstanceOf(CanvasLoginRefusedError);
      await expect(login.renew("x")).rejects.toBeInstanceOf(CanvasLoginRefusedError);
    }
    const down = new HttpCanvasLogin(settings, fakeFetch({ status: 500 }).impl);
    await expect(down.exchangeCode("x")).rejects.toBeInstanceOf(CanvasUnavailableError);
    await expect(down.renew("x")).rejects.toBeInstanceOf(CanvasUnavailableError);
    const offline = new HttpCanvasLogin(settings, fakeFetch(new Error("boom")).impl);
    await expect(offline.exchangeCode("x")).rejects.toBeInstanceOf(CanvasUnavailableError);
    await expect(offline.renew("x")).rejects.toBeInstanceOf(CanvasUnavailableError);
    await expect(offline.revoke("x")).rejects.toBeInstanceOf(CanvasUnavailableError);
  });

  it("revokes with DELETE and the access token as Bearer", async () => {
    const { impl, calls } = fakeFetch({ body: { success: true } });
    await new HttpCanvasLogin(settings, impl).revoke("tok");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe("https://canvas.test/login/oauth2/token");
    expect(calls[0].auth).toBe("Bearer tok");
    const down = new HttpCanvasLogin(settings, fakeFetch({ status: 500 }).impl);
    await expect(down.revoke("tok")).rejects.toBeInstanceOf(CanvasUnavailableError);
  });
});
