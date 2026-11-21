# Skip ngrok's Warning Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The login screen sends a Cue user agent for ngrok addresses so ngrok's warning page never appears.

**Architecture:** A pure `loginUserAgent` function decides the user agent from the authorize URL's host and the platform; `CanvasLoginScreen` passes it to the `WebView`.

**Tech Stack:** Expo / React Native, react-native-webview, jest-expo.

**Spec:** `docs/superpowers/specs/2026-11-21-skip-ngrok-warning-design.md`

## Global Constraints

- ngrok hosts: hostname ends with `.ngrok-free.dev`, `.ngrok-free.app` or `.ngrok.io`.
- User agents exactly as in the spec; neither starts with `Mozilla`.
- Other hosts: `undefined` (the web view's default).

## Review Focus

1. A lookalike host (`ngrok-free.dev.evil.test`) must not get the Cue user agent (logic test).
2. An unparsable authorize URL gives `undefined`, not a crash (logic test).

---

### Task 1: Cue user agent for ngrok addresses

**Files:**
- Modify: `app/src/viewmodels/canvasLogin.ts`, `app/src/screens/CanvasLoginScreen.tsx`, `app/test-support/fakeServer.ts` (login address configurable: `state.loginUrl`, default `https://canvas.test`)
- Test: `app/__tests__/logic.test.ts`, `app/__tests__/App.test.tsx`

**Interfaces:**
- `loginUserAgent(authorizeUrl: string, platform: string): string | undefined`.

- [ ] **Step 1: Write the failing tests**:
  - logic: ngrok address on `ios` → the iOS string; on `android` → the Android string; `https://canvas.test/...` → undefined; `https://ngrok-free.dev.evil.test/...` → undefined; `not a url` → undefined.
  - App: `server.state.loginUrl = 'https://demo.ngrok-free.dev'`; after opening the login, the web view's `userAgent` starts with `CueApp/`.
- [ ] **Step 2: Run to see them fail** — `cd app && npx jest __tests__/logic.test.ts __tests__/App.test.tsx`.
- [ ] **Step 3: Implement** the function, the `userAgent` prop, and the configurable fake login address.
- [ ] **Step 4: Run** `cd app && npx jest && npm run typecheck && npm run lint` — all pass, no lint errors.
- [ ] **Step 5: Commit.**
