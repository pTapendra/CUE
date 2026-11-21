# Log in with Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Students connect Cue to the local Canvas by logging in on Canvas's own page (OAuth 2) instead of pasting an access token; the server renews access by itself.

**Architecture:** A new `CanvasLogin` adapter (next to `CanvasClient`) does Canvas's token requests. `CanvasReaderService` gains login start/finish, renewal before and after a 401, and revoke on disconnect. The app opens Canvas's authorize page in a private web view and catches Canvas's out-of-band return address (`/login/oauth2/auth?code=…`). `scripts/local-canvas.sh start` with ngrok creates the developer key and writes the server settings.

**Tech Stack:** Node 22, Express 5, zod 4, better-sqlite3, vitest + supertest; Expo SDK 58, React Native 0.88, jest-expo, `react-native-webview`; macOS bash 3.2.

**Spec:** `docs/superpowers/specs/2026-11-20-canvas-login-design.md`

## Global Constraints

- No iteration labels (the team's rule) in code, tests, docs, README or commit messages.
- The developer key's secret is never sent to the app, logged, printed by the script, or committed.
- Nothing from Canvas's token reply except `access_token`, `refresh_token` and `expires_in` is kept. `user` and `real_user` are dropped, never stored or logged.
- Cue's only non-GET requests to Canvas are the token requests: `POST /login/oauth2/token` (exchange, renewal) and `DELETE /login/oauth2/token` (revoke).
- Return address: `urn:ietf:wg:oauth:2.0:oob`. Scopes, exactly: `url:GET|/api/v1/courses`, `url:GET|/api/v1/courses/:course_id/assignments`, `url:GET|/api/v1/calendar_events`.
- Login state: 10 minutes, single use. Renew when access expires within 2 minutes.
- New error codes: `409 login_expired`, `409 canvas_login_failed`, `404 login_unavailable`.
- Pasted-token connections keep working, are never renewed and never revoked. The token UI code (`useConnectCanvas`, `ApiClient.connectCanvas`, `PUT /api/canvas/connection`) stays, with its tests.
- The script stays macOS bash 3.2 compatible and never writes the real `server/.env` from its tests.

## Review Focus

1. **Android doesn't report the return redirect to `onShouldStartLoadWithRequest`** (it can skip redirects that follow a POST, like Canvas's Authorize button). Expected: login still completes. The screen also hands `onNavigationStateChange` URLs to the same handler, and the handler finishes only once (Task 6).
2. **Renewal works but Canvas still answers 401.** Expected: one renewal, one retry, then `409 canvas_token_rejected`. No loop (Task 4).
3. **A developer key whose tokens don't expire** (`expires_in` missing). Expected: `access_expires_at` stays NULL, no renewal before reads, and a 401 still triggers one renewal (Task 4).
4. **A client secret containing `/`, `+`, `=` or `&`.** Expected: written to `server/.env` exactly (Task 7).
5. **The student taps "Log in with Canvas" twice, or a server restart happens mid-login** (`npm run dev` restarts on save). Expected: each unexpired state works once, and states live in the database (Task 3).

---

### Task 1: Storage for login tokens and login states

**Files:**
- Modify: `server/src/db.ts` (append to `MIGRATIONS`)
- Modify: `server/src/canvasReader/CanvasReaderRepository.ts`
- Modify: `server/test/migrations.test.ts` (its `user_version` assertions expect `1`; they become `2`)
- Test: `server/test/canvasLoginStorage.test.ts`

**Interfaces:**
- Produces:
  - `StoredConnection` gains `refreshSealed: string | null; accessExpiresAt: string | null`.
  - `saveConnection(studentId: string, baseUrl: string, tokenSealed: string, renewal?: { refreshSealed: string; accessExpiresAt: string | null } | null): void`. With no `renewal` (the pasted-token path) both new columns are set to NULL.
  - `updateAccess(studentId: string, tokenSealed: string, accessExpiresAt: string | null, refreshSealed?: string): void`. Leaves `refresh_sealed` unchanged when `refreshSealed` is undefined.
  - `saveLoginState(studentId: string, state: string, ttlMs: number): void`. Stores `hashToken(state)` and clears expired rows.
  - `takeLoginState(studentId: string, state: string): boolean`. Deletes the row for that state whoever owns it; true only if it belonged to `studentId` and hadn't expired.

- [ ] **Step 1: Write the failing tests** in `server/test/canvasLoginStorage.test.ts` (use `openDb(":memory:")`, `AccountRepository.create()` for student IDs):
  - `"a pasted token replacing a login connection clears the refresh token and expiry"`: `saveConnection(id, url, "a", { refreshSealed: "r", accessExpiresAt: "2026-11-02T16:00:00.000Z" })`, then `saveConnection(id, url, "b")`; expect `getConnection(id)` to match `{ tokenSealed: "b", refreshSealed: null, accessExpiresAt: null }`.
  - `"updateAccess keeps the refresh token unless given a new one"`.
  - `"a login state works once, only for its student, only before it expires"`: true once, then false; false for another student (and gone afterwards, even for the owner); false after the TTL. Use `ttlMs` of `-1` for expiry.
  - `"login states are stored hashed"`: the raw state string doesn't appear in `SELECT * FROM canvas_login_states`.
  - `"login states survive reopening the database"`: use a temp file DB, save, reopen with `openDb`, take → true.
  - In `migrations.test.ts`, add `"adds the login columns and keeps existing Canvas connections"`. Create a database at `user_version` 1 with a connection row, run `migrate`, then expect the row intact with `refresh_sealed` NULL and `user_version` 2.

- [ ] **Step 2: Run them to see them fail**
  Run: `cd server && npx vitest run test/canvasLoginStorage.test.ts test/migrations.test.ts`
  Expected: FAIL (no such column `refresh_sealed`, `saveLoginState` is not a function).

- [ ] **Step 3: Append the migration** to `MIGRATIONS` in `server/src/db.ts`:

```sql
ALTER TABLE canvas_connections ADD COLUMN refresh_sealed TEXT;
ALTER TABLE canvas_connections ADD COLUMN access_expires_at TEXT;
CREATE TABLE canvas_login_states (
  state_hash TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
```

- [ ] **Step 4: Implement the repository methods** listed under Interfaces.

- [ ] **Step 5: Run the whole server suite**
  Run: `cd server && npm test && npm run typecheck`
  Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/db.ts server/src/canvasReader/CanvasReaderRepository.ts server/test/canvasLoginStorage.test.ts server/test/migrations.test.ts
git commit -m "Store Canvas refresh tokens, access expiry and login states"
```

### Task 2: The CanvasLogin adapter

**Files:**
- Create: `server/src/canvas/CanvasLogin.ts` (interface, constants, error)
- Create: `server/src/canvas/HttpCanvasLogin.ts`
- Create: `server/src/canvas/FakeCanvasLogin.ts`
- Modify: `server/src/canvas/CanvasClient.ts` (the header comment: "Every method is a read" stays true for `CanvasClient`; add that the login's token requests live in `CanvasLogin`)
- Test: `server/test/httpCanvasLogin.test.ts`

**Interfaces:**
- Produces (in `CanvasLogin.ts`):

```ts
export const OOB_REDIRECT = "urn:ietf:wg:oauth:2.0:oob";
export const CANVAS_SCOPES = [
  "url:GET|/api/v1/courses",
  "url:GET|/api/v1/courses/:course_id/assignments",
  "url:GET|/api/v1/calendar_events",
] as const;

export interface CanvasLoginSettings { canvasUrl: string; clientId: string; clientSecret: string }

export interface CanvasTokens {
  accessToken: string;
  refreshToken: string | null;      // null: keep the one already stored
  expiresInSeconds: number | null;  // null: access does not expire
}

export interface CanvasLogin {
  readonly canvasUrl: string;                 // no trailing slash
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<CanvasTokens>;
  renew(refreshToken: string): Promise<CanvasTokens>;
  revoke(accessToken: string): Promise<void>;
}

/** Canvas refused a code or refresh token (HTTP 400 or 401 from /login/oauth2/token). */
export class CanvasLoginRefusedError extends Error {}
```

- `HttpCanvasLogin(settings: CanvasLoginSettings, fetchImpl: typeof fetch = fetch) implements CanvasLogin`. Network errors and other non-2xx statuses throw the existing `CanvasUnavailableError`.
- `FakeCanvasLogin implements CanvasLogin`, for Tasks 3 and 4:
  - `canvasUrl = "https://canvas.test"`.
  - `authorizeUrl(state)` returns `https://canvas.test/login/oauth2/auth?state=<state>`.
  - `exchangeCode("good-code")` returns `{ accessToken: "access-1", refreshToken: "refresh-1", expiresInSeconds: 3600 }`. Any other code throws `CanvasLoginRefusedError`.
  - `renew()` returns `access-<n>` with `n` counting up from 2, and `refreshToken: null`.
  - Public fields: `expiresInSeconds: number | null = 3600`, `refuseRenewal = false`, `failRevoke = false`, `renewals = 0`, `revoked: string[] = []`.

- [ ] **Step 1: Write the failing tests** in `server/test/httpCanvasLogin.test.ts`, with a recording fake `fetch` like `httpCanvasClient.test.ts`. Settings: `{ canvasUrl: "https://canvas.test/", clientId: "10000000000001", clientSecret: "s/e+c=r&t" }`.
  - `"builds the authorize URL with the out-of-band return and the three read scopes"`:
    - origin + path `https://canvas.test/login/oauth2/auth`;
    - `client_id=10000000000001`, `response_type=code`, `redirect_uri=urn:ietf:wg:oauth:2.0:oob`, `state=st`;
    - `scope` = the three scopes joined by one space.
  - `"exchanges a code with a form POST and keeps only the tokens and expiry"`:
    - reply `{ access_token: "a", refresh_token: "r", expires_in: 3600, token_type: "Bearer", user: { id: 7, name: "Ada" } }`;
    - expect the result to equal `{ accessToken: "a", refreshToken: "r", expiresInSeconds: 3600 }`;
    - the call is `POST https://canvas.test/login/oauth2/token` with content type `application/x-www-form-urlencoded`;
    - its body parses to `grant_type=authorization_code`, `client_id`, `client_secret=s/e+c=r&t`, `redirect_uri=urn:ietf:wg:oauth:2.0:oob`, `code`.
  - `"renews with grant_type=refresh_token; a reply without expires_in or refresh_token gives nulls"`.
  - `"a 400 or 401 from the token endpoint is CanvasLoginRefusedError; a 500 or network error is CanvasUnavailableError"`.
  - `"revokes with DELETE and the access token as Bearer"`.

- [ ] **Step 2: Run to see them fail**
  Run: `cd server && npx vitest run test/httpCanvasLogin.test.ts`
  Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement** `CanvasLogin.ts`, `HttpCanvasLogin.ts` (body with `URLSearchParams`; trailing slashes stripped from `canvasUrl`) and `FakeCanvasLogin.ts`.

- [ ] **Step 4: Run the server suite**
  Run: `cd server && npm test && npm run typecheck`
  Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/canvas/ server/test/httpCanvasLogin.test.ts
git commit -m "Add the CanvasLogin adapter for Canvas's token requests"
```

### Task 3: Login settings, login routes, and wiring

**Files:**
- Modify: `server/src/config.ts`, `server/.env.example`, `server/src/index.ts`
- Modify: `server/src/canvasReader/CanvasReaderService.ts`
- Modify: `server/src/api/app.ts`
- Modify: `server/test/helpers.ts`
- Test: `server/test/config.test.ts`, `server/test/canvasLogin.test.ts`
- Modify: `README.md` (settings table and API table)

**Interfaces:**
- Consumes: Task 1 repository methods; Task 2 `CanvasLogin`, `CanvasLoginSettings`, `CanvasLoginRefusedError`, `FakeCanvasLogin`, `HttpCanvasLogin`.
- Produces:
  - `Config.canvasLogin: CanvasLoginSettings | null`.
  - `CanvasReaderOptions.login?: CanvasLogin | null`. The constructor checks `login.canvasUrl` with the same rules as student-entered addresses, throwing `InvalidCanvasUrlError` at startup.
  - `status(studentId)` returns `{ connected, baseUrl, lastSyncedAt, loginAvailable: boolean }`.
  - `startLogin(studentId: string): { authorizeUrl: string; state: string }`. State is `randomBytes(32).toString("base64url")`, TTL `10 * 60 * 1000`. Throws `LoginUnavailableError` when `login` is null.
  - `finishLogin(studentId: string, code: string, state: string): Promise<void>`. Throws `LoginExpiredError`, `CanvasLoginRefusedError`, or (from the check read) `CanvasAuthError` / `CanvasUnavailableError`.
  - Exported error classes `LoginExpiredError` and `LoginUnavailableError`, in `CanvasReaderService.ts` next to the existing ones.
  - Routes:
    - `POST /api/canvas/login` → `200 { authorizeUrl, state }`;
    - `POST /api/canvas/login/finish` with body `{ code: string(1..2000), state: string(1..200) }` → `200` with the status body.
  - `setup()` in `helpers.ts` takes an optional `{ login?: boolean }` (default true). It returns `login: FakeCanvasLogin` and `deadTokens: Set<string>`. Its client factory returns a client with `rejectToken = true` (sharing the fake data) when the token is in `deadTokens`.

- [ ] **Step 1: Write the failing config tests** in `server/test/config.test.ts`:
  - `"no CUE_CANVAS_* settings: login is off"`: `canvasLogin` is null.
  - `"all three: login settings, trailing slash removed"`.
  - `"some but not all: refuses to start and names what is missing"`: the error message contains `CUE_CANVAS_CLIENT_SECRET`.

- [ ] **Step 2: Write the failing route tests** in `server/test/canvasLogin.test.ts`:
  - `"reports loginAvailable"`: true with the fake login, false with `setup({ login: false })`, where `POST /api/canvas/login` gives `404 login_unavailable`.
  - `"start returns Canvas's authorize URL and a state"`.
  - `"finish connects: tokens sealed, expiry stored, nothing about the Canvas user kept"`:
    - status `{ connected: true, baseUrl: "https://canvas.test" }`;
    - the row's `token_sealed` and `refresh_sealed` don't contain `access-1` or `refresh-1`;
    - `access_expires_at` equals `NOW + 3600 s`;
    - the check read used `access-1` (`tokensSeen`).
  - `"a state works once"`: a second finish with it gives `409 login_expired`.
  - `"a state from another student or after 10 minutes gives login_expired"` (use `setClock`).
  - `"two logins started: each state works once"` (Review Focus 5).
  - `"Canvas refusing the code gives canvas_login_failed"`.
  - `"connecting with a pasted token still works and is never renewed"`: `PUT /api/canvas/connection` as today, and `refresh_sealed` NULL.

- [ ] **Step 3: Run to see them fail**
  Run: `cd server && npx vitest run test/config.test.ts test/canvasLogin.test.ts`
  Expected: FAIL.

- [ ] **Step 4: Implement**:
  - `loadConfig` reads `CUE_CANVAS_URL`, `CUE_CANVAS_CLIENT_ID`, `CUE_CANVAS_CLIENT_SECRET`;
  - add the three, commented, to `.env.example`;
  - the service methods and errors above;
  - the routes; `describe()` maps `LoginExpiredError` → `[409, "login_expired", "The login took too long; please try again"]`, `CanvasLoginRefusedError` → `[409, "canvas_login_failed", "Canvas did not complete the login"]` and `LoginUnavailableError` → `[404, "login_unavailable", "Canvas login is not set up on this server"]`;
  - in `index.ts`, pass `login: config.canvasLogin ? new HttpCanvasLogin(config.canvasLogin) : null`;
  - update the `helpers.ts` `setup()`.

- [ ] **Step 5: Update `README.md`**: the settings table gets the three variables; the API table gets the two login routes.

- [ ] **Step 6: Run the server suite**
  Run: `cd server && npm test && npm run typecheck`
  Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add server/ README.md
git commit -m "Log in with Canvas: settings, start and finish routes"
```

### Task 4: Renewal, and revoke on disconnect

**Files:**
- Modify: `server/src/canvasReader/CanvasReaderService.ts`
- Modify: `server/src/api/app.ts` (`DELETE /api/canvas/connection` and `DELETE /api/account` await `canvasReader.disconnect`)
- Test: `server/test/canvasRenewal.test.ts`
- Modify: `README.md` (the "only with read (GET) requests" line, per Global Constraints)

**Interfaces:**
- Consumes: Task 3 `setup()` (`login`, `deadTokens`, `setClock`); Task 1 `updateAccess`.
- Produces: `disconnect(studentId: string): Promise<void>` (was sync). Renewal is private to the service. Suggested shape: one private `withClient<T>(studentId, read: (c: CanvasClient) => Promise<T>): Promise<T>`, used by `preview`, that renews first when needed and retries `read` once after a 401.

- [ ] **Step 1: Write the failing tests** in `server/test/canvasRenewal.test.ts`. Connect each student through login first.
  - `"renews access shortly before it expires, then syncs with the new token"`:
    - `setClock(NOW + 59 min)`, then sync → 200;
    - `login.renewals === 1`; the last `tokensSeen` is `access-2`;
    - `access_expires_at` is the new clock + 3600 s.
  - `"does not renew while access has more than 2 minutes left"`: at `NOW + 57 min`, `renewals === 0`.
  - `"after a 401, renews once and retries"`: add `access-1` to `deadTokens`; sync → 200; `renewals === 1`.
  - `"renewed but still refused: one retry, then canvas_token_rejected"`: `deadTokens` has `access-1` and `access-2`; sync → `409 canvas_token_rejected`; `renewals === 1` (Review Focus 2).
  - `"refused renewal asks the student to connect again and keeps the address"`: `refuseRenewal = true` at `NOW + 59 min`; sync → `409 canvas_token_rejected`; `GET /api/canvas/connection` still has `baseUrl`.
  - `"tokens without expiry are never renewed before a read, but are after a 401"`: `login.expiresInSeconds = null` before connecting; `access_expires_at` is NULL; sync at `NOW + 5 h` → `renewals === 0`; then add `access-1` to `deadTokens` → `renewals === 1` (Review Focus 3).
  - `"disconnect revokes a login connection, renewing first if access has expired"`: at `NOW + 2 h`, `DELETE /api/canvas/connection` → 204; `login.revoked` equals `["access-2"]`.
  - `"disconnect still deletes when revoking fails"`: `failRevoke = true` → 204, `connected: false`.
  - `"deleting the account revokes too"`.
  - `"a pasted-token connection is never revoked"`: `login.revoked` stays empty.

- [ ] **Step 2: Run to see them fail**
  Run: `cd server && npx vitest run test/canvasRenewal.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement** renewal, the retry, and the revoke in `disconnect`:
  - Renew when `refreshSealed` is set and `accessExpiresAt` is within `2 * 60 * 1000` ms of `now()`.
  - Renewal failing with `CanvasLoginRefusedError` becomes `CanvasAuthError`.
  - With `login` null, nothing is renewed or revoked.
  - In `disconnect`, swallow any error from renewing or revoking.

- [ ] **Step 4: Update `README.md`**: "only with read (GET) requests" becomes reads only, apart from the login's token requests.

- [ ] **Step 5: Run the server suite**
  Run: `cd server && npm test && npm run typecheck`
  Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/ README.md
git commit -m "Renew Canvas access by itself; revoke it on disconnect"
```

### Task 5: App login logic

**Files:**
- Modify: `app/src/api/types.ts`, `app/src/api/client.ts`
- Create: `app/src/viewmodels/canvasLogin.ts` (pure URL check)
- Create: `app/src/viewmodels/useCanvasLogin.ts`
- Modify: `app/test-support/fakeServer.ts`
- Test: `app/__tests__/logic.test.ts` (add cases)

**Interfaces:**
- Consumes: Task 3 routes and error codes.
- Produces:
  - `ConnectionStatus.loginAvailable: boolean`; `export interface CanvasLoginStart { authorizeUrl: string; state: string }`.
  - `ApiClient.startCanvasLogin(): Promise<CanvasLoginStart>` (`POST /api/canvas/login`) and `ApiClient.finishCanvasLogin(code: string, state: string): Promise<ConnectionStatus>` (`POST /api/canvas/login/finish`).
  - `friendlyMessage`:
    - `canvas_token_rejected` → `"Canvas no longer accepts Cue's access. Connect again."`
    - `login_expired` → `"The login took too long. Please try again."`
    - `canvas_login_failed` → `"Canvas didn't complete the login. Please try again."`
  - In `canvasLogin.ts`: `export type LoginReturn = { kind: 'code'; code: string } | { kind: 'denied' } | { kind: 'mismatch' }` and `export function readLoginReturn(url: string, authorizeUrl: string, state: string): LoginReturn | null`. It returns null (let the page load) unless the URL has the same origin as `authorizeUrl`, the path `/login/oauth2/auth`, and a `code` or `error` parameter. Given those: `state` differs → `mismatch`; `error` → `denied`; otherwise `code`.
  - `useCanvasLogin(onConnected: () => void)` returns:
    - `authorizeUrl: string | null` (non-null while the login screen is open);
    - `busy: boolean`;
    - `error: string | null`;
    - `start(): Promise<void>`;
    - `onNavigate(url: string): boolean` (false means "don't load this URL");
    - `cancel(): void`.
    Behaviour:
    - Finishes at most once per `start()`.
    - `denied` closes the screen with `"You didn't allow Cue to read Canvas."`.
    - `mismatch` closes it with `"The login didn't complete. Please try again."`.
    - Server errors close it with `friendlyMessage(err)`.
    - `cancel()` closes it with no message.
  - `fakeServer` state gains `loginAvailable: false` (default, so existing tests are unchanged). The connection route returns it. New routes:
    - `POST /api/canvas/login` → `{ authorizeUrl: 'https://canvas.test/login/oauth2/auth?client_id=1&state=s1', state: 's1' }`;
    - `POST /api/canvas/login/finish` → connects for code `good-code`, else `409 canvas_login_failed`.

- [ ] **Step 1: Write the failing tests** in `logic.test.ts`, with `A = 'https://canvas.test/login/oauth2/auth?client_id=1&state=s1'`:
  - `"readLoginReturn lets Canvas's own pages load"`: `A` itself, `https://canvas.test/login/canvas` and `https://canvas.test/login/oauth2/confirm` give null.
  - `"readLoginReturn catches the code"`: `https://canvas.test/login/oauth2/auth?code=c1&state=s1` gives `{ kind: 'code', code: 'c1' }`.
  - `"readLoginReturn: denied, wrong state, other site"`:
    - `?error=access_denied&state=s1` → `denied`;
    - `?code=c1&state=zz` → `mismatch`;
    - `https://evil.test/login/oauth2/auth?code=c1&state=s1` → null.
  - `"friendly messages for the login errors"`: the three strings above.

- [ ] **Step 2: Run to see them fail**
  Run: `cd app && npx jest __tests__/logic.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement** the types, the client methods, the messages, `readLoginReturn`, `useCanvasLogin`, and the `fakeServer` routes.

- [ ] **Step 4: Run the app suite**
  Run: `cd app && npm test && npm run typecheck`
  Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/src app/test-support app/__tests__/logic.test.ts
git commit -m "App: Canvas login API calls, return-address check and view model"
```

### Task 6: App login screens

**Files:**
- Modify: `app/package.json`, `app/package-lock.json` (via `npx expo install react-native-webview`)
- Modify: `app/jest.setup.js` (mock `react-native-webview`)
- Create: `app/src/screens/CanvasLoginScreen.tsx`
- Modify: `app/src/screens/ConnectScreen.tsx`, `app/App.tsx`
- Test: `app/__tests__/App.test.tsx` (add cases)
- Modify: `README.md` ("Getting a Canvas token" becomes "Connecting Canvas")

**Interfaces:**
- Consumes: Task 5 `useCanvasLogin`, `ConnectionStatus.loginAvailable`, `fakeServer` login routes.
- Produces:
  - `CanvasLoginScreen({ authorizeUrl, busy, onNavigate, onCancel }: { authorizeUrl: string; busy: boolean; onNavigate: (url: string) => boolean; onCancel: () => void })`. It is a full-screen `Modal` with a header (a **Cancel** button and the title "Log in to Canvas") and a `WebView`:
    - `source={{ uri: authorizeUrl }}`, `incognito`;
    - `onShouldStartLoadWithRequest={(r) => onNavigate(r.url)}`;
    - `onNavigationStateChange={(s) => { onNavigate(s.url); }}`;
    - a spinner over it while `busy`.
  - `ConnectScreen` gains the prop `loginAvailable: boolean`. When it is true, the screen renders the title, `"Log in with your Canvas account. Cue only reads your courses and deadlines."`, a **Log in with Canvas** button, **Skip – I'll add dates by hand**, the error banner (login error), and `CanvasLoginScreen` while `authorizeUrl` is set. No address field, token field, "Open Canvas to create a token" or "Connect and sync" is rendered. When it is false, the screen is unchanged.
  - `App.tsx` keeps `loginAvailable` from the startup `getConnection()` and passes it to `ConnectScreen`.
  - `jest.setup.js`: `jest.mock('react-native-webview', () => { const { createElement } = require('react'); return { WebView: (p) => createElement('WebView', p) }; })`.

- [ ] **Step 1: Install the web view**
  Run: `cd app && npx expo install react-native-webview`
  Expected: `react-native-webview` added to `dependencies` at the version Expo SDK 58 pins.

- [ ] **Step 2: Write the failing tests** in `App.test.tsx`. Set `server.state.loginAvailable = true` before rendering. Find the web view with `root.findByType('WebView' as any)`.
  - `"logs in with Canvas and goes to the review screen"`:
    - `texts` contain `'Log in with Canvas'`;
    - no node has the placeholder `'Paste your token'` or `'yourschool.instructure.com'`;
    - press **Log in with Canvas**; the web view's `source.uri` is the fake `authorizeUrl` and `incognito` is true;
    - `onShouldStartLoadWithRequest({ url: authorizeUrl })` returns true;
    - with `https://canvas.test/login/oauth2/auth?code=good-code&state=s1` it returns false;
    - after `flush()`, `texts` contain `'Check what Cue found'`;
    - the finish call's body equals `{ code: 'good-code', state: 's1' }`.
  - `"finishes once when both web view callbacks report the return address"`: call `onNavigationStateChange({ url: codeUrl })` and `onShouldStartLoadWithRequest({ url: codeUrl })`; exactly one `POST /api/canvas/login/finish` (Review Focus 1).
  - `"denying Cue returns to Connect with a message"`: `?error=access_denied&state=s1` → `texts` contain `"You didn't allow Cue to read Canvas."` and the web view is gone.
  - `"Cancel closes the login without a message"`.
  - The existing token test stays as is (`loginAvailable` defaults to false).

- [ ] **Step 3: Run to see them fail**
  Run: `cd app && npx jest __tests__/App.test.tsx`
  Expected: the new tests FAIL; existing ones pass.

- [ ] **Step 4: Implement** `CanvasLoginScreen`, the `ConnectScreen` login mode, and the `App.tsx` prop.

- [ ] **Step 5: Run the app suite**
  Run: `cd app && npm test && npm run typecheck && npm run lint`
  Expected: all pass.

- [ ] **Step 6: Update `README.md`**: "Getting a Canvas token" becomes "Connecting Canvas". When the server has login settings, students tap **Log in with Canvas**, log in, tap **Authorize**. The current token steps stay, for a server without login settings.

- [ ] **Step 7: Check by hand in Expo Go** (needs Task 7 and Canvas running through ngrok; if Task 7 isn't done yet, put the three settings in `server/.env` by hand from a developer key made in Canvas's admin UI):
  - log in as a student on an iPhone and on an Android phone; land on the Review screen;
  - tap Cancel on Canvas's Authorize page;
  - does ngrok's warning page appear? If so, try `source={{ uri, headers: { 'ngrok-skip-browser-warning': 'true' } }}`. If the warning still appears after Canvas's redirects, try a non-browser `userAgent` on the `WebView`. Keep whichever works on both phones. If neither does, leave it (the student taps **Visit Site**) and note it in the README.

- [ ] **Step 8: Commit**

```bash
git add app/ README.md
git commit -m "App: Log in with Canvas screen; token controls not shown when login is set up"
```

### Task 7: `local-canvas.sh start` sets up Canvas login

**Files:**
- Modify: `scripts/local-canvas.sh`
- Modify: `scripts/local-canvas.test.sh`
- Modify: `README.md` (local Canvas section)

**Interfaces:**
- Consumes: the three scopes and `urn:ietf:wg:oauth:2.0:oob` (Global Constraints); the server variables from Task 3.
- Produces (shell functions):
  - `server_env_file`: prints `${CUE_SERVER_ENV:-<repo>/server/.env}`, with `<repo>` worked out from the script's own location (`BASH_SOURCE[0]`).
  - `env_get FILE KEY`: prints the value or nothing.
  - `env_set FILE KEY VALUE`: replaces the `KEY=` line or appends one, keeps every other line and its order, prints nothing. It must not put the value in a `sed` expression (it may hold `/`, `+`, `=`, `&`); pass it to `awk` through the environment.
  - `ensure_server_env`: when the file is missing, copies `<repo>/server/.env.example`. When `CUE_SECRET_KEY` is empty, sets it to `openssl rand -base64 32`.
  - `cue_key_known URL CLIENT_ID`: fails only when `curl` gets HTTP 401 from `URL/login/oauth2/auth?client_id=CLIENT_ID&response_type=code&redirect_uri=urn:ietf:wg:oauth:2.0:oob` (Canvas's answer for an unknown key).
  - `create_cue_developer_key CANVAS_DIR`: runs `docker compose exec -T web bundle exec rails runner '<ruby>'` in `CANVAS_DIR` and prints `<client id> <secret>`, taken from the output line starting with `CUE_KEY `. The Ruby:
    - finds or creates the `DeveloperKey` named `Cue` on `Account.default`;
    - sets `require_scopes = true` and `scopes` = the three scopes, then `save!`;
    - turns on that key's `developer_key_account_bindings` row for `Account.default` (`workflow_state: "on"`);
    - prints `CUE_KEY #{key.global_id} #{key.api_key}`.
  - `ensure_cue_login CANVAS_DIR NGROK_URL`:
    - runs `ensure_server_env`;
    - skips with `"Canvas login for Cue is already set up."` when `CUE_CANVAS_URL` equals `NGROK_URL`, client ID and secret are non-empty, and `cue_key_known` passes;
    - otherwise says `"Setting up Canvas login for Cue (about a minute)..."`, creates the key, `env_set`s the three variables, and says `"Restart Cue's server so it picks up Canvas login."`;
    - on failure it warns `"Couldn't set up Canvas login for Cue. Students can still connect with an access token."` and returns 0, so Canvas stays up.

- [ ] **Step 1: Write the failing tests** in `local-canvas.test.sh`, each with `export CUE_SERVER_ENV="$T/server.env"`:
  - `test_env_set_replaces_adds_and_keeps_other_lines`: a file with `PORT=3000`, `CUE_CANVAS_URL=old` and `# note`. After setting `CUE_CANVAS_URL` and `CUE_CANVAS_CLIENT_ID`, the file is exactly `PORT=3000`, `CUE_CANVAS_URL=https://new`, `# note`, `CUE_CANVAS_CLIENT_ID=1`.
  - `test_env_set_writes_a_secret_exactly`: the value `a/b+c=d&e` reads back the same with `env_get` (Review Focus 4).
  - `test_ensure_server_env_creates_the_file_with_a_secret_key`: copies the example; `CUE_SECRET_KEY` decodes to 32 bytes (`base64 -D | wc -c` → 32).
  - `test_cue_key_known`: stub `curl` printing `401` → fails; printing `302` → succeeds.
  - `test_ensure_cue_login_writes_settings_and_never_prints_the_secret`:
    - stub `docker` printing `CUE_KEY 10000000000001 s3cr/t+=`, and stub `curl`;
    - `server.env` gets `CUE_CANVAS_URL=https://my-name.ngrok-free.dev`, `CUE_CANVAS_CLIENT_ID=10000000000001` and `CUE_CANVAS_CLIENT_SECRET=s3cr/t+=`;
    - the output doesn't contain `s3cr`.
  - `test_ensure_cue_login_skips_when_already_set_up`: settings present, `curl` → `302`; `docker` is never called (its stub writes to a log that stays empty).
  - `test_ensure_cue_login_failure_warns_and_carries_on`: `docker` exits 1 → status 0, and the warning is printed.
  - In `test_start_with_ngrok_end_to_end` and `test_start_stops_ngrok_when_canvas_fails_to_restart`, add `export CUE_SERVER_ENV="$T/server.env"` so they never touch the real `server/.env`.

- [ ] **Step 2: Run to see them fail**
  Run: `bash scripts/local-canvas.test.sh`
  Expected: the new tests FAIL, existing ones pass.

- [ ] **Step 3: Implement** the functions. In `expose_with_ngrok`, call `ensure_cue_login "$CANVAS_DIR" "$NGROK_URL"` right after Canvas answers. Replace `In Cue, open Canvas connection and enter that address.` with `Students connect from Cue's Connect screen with "Log in with Canvas".`

- [ ] **Step 4: Run the tests and lint**
  Run: `bash scripts/local-canvas.test.sh && bash -n scripts/local-canvas.sh && (command -v shellcheck >/dev/null && shellcheck scripts/local-canvas.sh || true)`
  Expected: `N passed, 0 failed`, no syntax errors.

- [ ] **Step 5: Check by hand against the local Canvas.** With Label Studio's ngrok stopped, run `scripts/local-canvas.sh start` and answer y:
  - `server/.env` gets the three lines, and the secret is never shown;
  - a second `start` says "already set up";
  - the Ruby is accepted. A wrong scope string makes `save!` fail with Canvas's own message; fix the string from Canvas's message, or from `TokenScopes.all_scopes` in a `rails runner`.

- [ ] **Step 6: Update `README.md`**, local Canvas section:
  - `start` with ngrok sets up Canvas login and writes `server/.env`;
  - restart Cue's server after;
  - demo students need Canvas logins created by the admin and enrolment in courses;
  - for a Cue server on another computer, copy the three `CUE_CANVAS_*` lines by hand.

- [ ] **Step 7: Commit**

```bash
git add scripts/ README.md
git commit -m "Local Canvas script: set up Canvas login for Cue"
```

### Task 8: End-to-end check

- [ ] **Step 1: Full suites**
  Run: `cd server && npm test && npm run typecheck && cd ../app && npm test && npm run typecheck && npm run lint && cd .. && bash scripts/local-canvas.test.sh`
  Expected: all pass.

- [ ] **Step 2: By hand**, Canvas through ngrok, Cue server restarted, Expo Go:
  - **Log in and sync:** log in, authorize, Review, save.
  - **Renewal:** set `access_expires_at` to the past (`sqlite3 server/cue.db "UPDATE canvas_connections SET access_expires_at='2000-01-01T00:00:00.000Z'"`) and sync again; it works.
  - **Revoke:** revoke Cue in Canvas (Account → Settings → Approved Integrations) and sync; you're asked to connect again.
  - **Fallback:** without the `CUE_CANVAS_*` lines, the token screen appears as before.
  Report each result.
