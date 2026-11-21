# Log In Again from the Sync Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a sync fails because Canvas no longer accepts Cue's access, or Canvas isn't connected, the sync screen offers **Log in with Canvas** in place (or **Connect Canvas** in token mode).

**Architecture:** `useSyncReview` flags the two error codes. `ReviewScreen` reuses `useCanvasLogin` and `CanvasLoginScreen` from the Connect screen, and reloads the preview after a successful login. `App` passes `loginAvailable` and a way to the Connect screen.

**Tech Stack:** Expo / React Native, jest-expo, react-test-renderer, `app/test-support/fakeServer.ts`.

**Spec:** `docs/superpowers/specs/2026-11-21-reconnect-from-review-design.md`

## Global Constraints

- Error codes that offer the button: `canvas_token_rejected`, `canvas_not_connected`. No other code shows it.
- Button text: `Log in with Canvas` when the server has login settings, `Connect Canvas` otherwise.
- No server changes. Never write the banned iteration label anywhere.

## Review Focus

1. **Login finished but the next sync fails again.** Expected: the new error shows and the button stays available, with no loop (pinned by the refused-twice case in the fake server not being needed: `reload` runs once per successful login).
2. **The student cancels the login on the sync screen.** Expected: the error and the button stay, with no extra message (covered by `useCanvasLogin`'s tested cancel behaviour).

---

### Task 1: Log in again from the sync screen

**Files:**
- Modify: `app/src/viewmodels/useSyncReview.ts`, `app/src/screens/ReviewScreen.tsx`, `app/App.tsx`, `app/test-support/fakeServer.ts`
- Test: `app/__tests__/App.test.tsx`

**Interfaces:**
- `useSyncReview()` also returns `needsConnect: boolean`: true when the last preview failed with an `ApiError` whose code is `canvas_token_rejected` or `canvas_not_connected`, and false after any successful load.
- `ReviewScreen({ onDone, onCancel, loginAvailable, onConnect }: { onDone: () => void; onCancel: () => void; loginAvailable: boolean; onConnect: () => void })`.
- `fakeServer` state gains `syncError: { status: number; error: string } | null` (default null). `POST /api/canvas/sync` returns it when it is set. A successful `login/finish` clears it.

- [ ] **Step 1: Write the failing tests** in `App.test.tsx`, in a new `describe('Logging in again from the sync screen')`. Each starts with `server.state.connected = true`, so the app opens on the Week screen, then presses **Sync Canvas** and flushes.
  - `"a sync Canvas refuses offers Log in with Canvas, then shows the items"`:
    - `loginAvailable = true`; `syncError = { status: 409, error: 'canvas_token_rejected' }`;
    - `texts` contain `"Canvas no longer accepts Cue's access. Connect again."` and `'Log in with Canvas'`;
    - press it; the web view's `onShouldStartLoadWithRequest({ url: codeUrl })` returns false;
    - after `flush()`, `texts` contain `'SQL homework'` and not the error message.
  - `"without login settings the button opens the token form"`:
    - `loginAvailable = false`, same `syncError`;
    - press **Connect Canvas**; a node with placeholder `'Paste your token'` exists.
  - `"other sync failures don't offer a login"`: `syncError = { status: 502, error: 'canvas_unavailable' }`; `texts` contain neither `'Log in with Canvas'` nor `'Connect Canvas'`.

- [ ] **Step 2: Run them to see them fail**
  Run: `cd app && npx jest __tests__/App.test.tsx -t "sync screen"`
  Expected: FAIL (no button).

- [ ] **Step 3: Implement**:
  - the `fakeServer` `syncError`;
  - `needsConnect` (check `err instanceof ApiError` and its `code`);
  - in `ReviewScreen`: `const login = useCanvasLogin(vm.reload)`. Under the existing `ErrorBanner`, when `vm.needsConnect`, show the button (`login.start` or `onConnect`, by `loginAvailable`) and `<ErrorBanner message={login.error} />`. Render `CanvasLoginScreen` while `login.authorizeUrl` is set, as `ConnectScreen` does;
  - in `App`, pass `loginAvailable={loginAvailable}` and `onConnect={() => setScreen('connect')}`.

- [ ] **Step 4: Run the app suite**
  Run: `cd app && npx jest && npm run typecheck && npm run lint`
  Expected: all pass; lint has no errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/viewmodels/useSyncReview.ts app/src/screens/ReviewScreen.tsx app/App.tsx app/test-support/fakeServer.ts app/__tests__/App.test.tsx
git commit -m "App: log in again from the sync screen when Canvas refuses Cue"
```
