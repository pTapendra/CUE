# Cue Accounts from the Canvas Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Canvas login decides which Cue account a phone uses, so each Canvas user gets their own Cue account on any phone, with a real Log out.

**Architecture:** Each account may carry a keyed hash of (Canvas address, Canvas user ID); a `devices` table lets an account be on several phones. When a Canvas login (or the token form) finishes, an `AccountService` links the phone to the right account in one transaction (claim, create, or switch, moving hand-added data from an unlinked account) and the reply carries a new device token when the phone switched. The app adopts that token, and Settings gets Log out.

**Tech Stack:** Server: TypeScript, Express, better-sqlite3, zod, vitest + supertest. App: Expo SDK 58, React Native, React Navigation, jest-expo + @testing-library/react-native.

**Spec:** `docs/superpowers/specs/2026-11-21-canvas-accounts-design.md`

## Global Constraints

- Identity: `HMAC-SHA256(CUE_SECRET_KEY, canvasUrl + "|" + canvasUserId)` as lowercase hex; `canvasUrl` has no trailing slash. Never store the raw Canvas user ID, the name, or the email.
- Existing databases upgrade without losing rows; every existing device token keeps authenticating after the upgrade.
- `students.canvas_identity` is `TEXT UNIQUE`, null for an unlinked account; once set it never changes.
- Reply field names: `deviceToken` (only when the phone switched accounts), `linked: boolean` (on every connection status).
- Log out: `DELETE /api/device` → 204; unlinked account → 409 `{ error: "account_not_linked" }`.
- All Canvas network requests happen before the linking transaction; best-effort revokes after it commits.
- Exact copy (verbatim):
  - Log out row title: `Log out`
  - Alert title: `Log out of Cue?`
  - Alert message: `Your schedule and study plans stay saved. Log in with Canvas to get them back, on this phone or another.`
  - Alert buttons: `Log out`, `Cancel`
  - Welcome footnote: `No name or email needed. Your Canvas login is your Cue account; your Canvas access stays on Cue's server.`
  - What Cue keeps, first entry: title `No name or email`, text `Cue never asks who you are. When you log in with Canvas, Cue keeps a scrambled code for your Canvas account, so it can find your schedule again. It can't turn that code back into your name.`
  - What Cue keeps, delete entry text: `Delete all my data, in Settings, removes your account and everything Cue holds for you, on every phone.`
  - Delete alert message: `Your schedule, courses and study plans are removed from Cue, on every phone. This can't be undone.`
- Never write sprint labels in code, tests, docs or commits. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never print or commit secrets (`server/.env`, `CUE_SECRET_KEY`, Canvas client secret).
- Run, from `server/`: `npm test` and `npm run typecheck`; from `app/`: `npm test`, `npm run typecheck`, `npm run lint`.

## Review Focus

1. **A request in flight with the old token after a switch.** It gets 401 from the server; the client must not create a fresh anonymous account over the newly adopted token. (Task 5 test.)
2. **Upgrading a real database.** Children of `students` (items, courses, connections, blocks, settings) must survive the table rebuild, and the old device token must still authenticate. (Task 1 test.)
3. **Logging in again as the same student** (Reconnect on Check what Cue found): no new token, nothing moved or deleted. (Task 3 test.)
4. **Log out, then log in again on the same phone.** The data comes back, and the empty anonymous account created after logging out is deleted rather than left behind. (Task 3 test.)
5. **Delete all my data on one phone while another phone uses the account.** The other phone's token gets 401 (the client then starts fresh, as today). (Task 3 test.)

---

### Task 1: Devices and Canvas identity in the database

**Files:**
- Modify: `server/src/db.ts` (new migration; `migrate()` runs migrations with foreign keys off)
- Modify: `server/src/accounts/AccountRepository.ts`
- Test: `server/test/migrations.test.ts`, new `server/test/accounts.test.ts`

**Interfaces:**
- Produces (`AccountRepository`, all synchronous):
  - `create(): { studentId: string; deviceToken: string }`: unlinked account + one device (unchanged signature).
  - `findByToken(deviceToken: string): string | null`: looks up `devices`.
  - `delete(studentId: string): void` (unchanged).
  - `addDevice(studentId: string): string`: returns a new device token.
  - `removeDevice(deviceToken: string): void`
  - `identityOf(studentId: string): string | null`
  - `findByIdentity(identity: string): string | null`
  - `createLinked(identity: string): string`: new account with that identity and no device; returns its id.
  - `setIdentity(studentId: string, identity: string): void`
  - `moveManualData(fromStudentId: string, toStudentId: string): number`: moves `source = 'manual'` courses and items and the study blocks of the moved items; returns the number of items moved.
  - `transaction<T>(fn: () => T): T`: runs `fn` in one better-sqlite3 transaction.

- [ ] **Step 1: Write the failing tests**

In `migrations.test.ts`, extending the file's existing pattern for building an older database:
- `it("moves device tokens into devices and keeps every student's rows")`: build a database at the current latest `user_version` (2) with one student (known token), a course, an item, a study block, planner settings and a Canvas connection. Run `migrate`. Expect: `new AccountRepository(db).findByToken(token)` is that student's id; the counts of `courses`, `items`, `study_blocks`, `planner_settings`, `canvas_connections` are unchanged; `PRAGMA foreign_key_check` returns no rows; `PRAGMA foreign_keys` is 1 afterwards; `students` has a `canvas_identity` column (null) and no `token_hash` column.
- `it("runs each migration once")` keeps passing with the new count.

In `accounts.test.ts`:
- `it("create makes an unlinked account with one device")`: `identityOf(id)` null; `findByToken(token)` is id.
- `it("addDevice gives another phone the same account")`: two tokens both resolve to id; `removeDevice(first)` → `findByToken(first)` null, second still id.
- `it("findByIdentity finds a linked account")`: `setIdentity(id, "abc")` → `findByIdentity("abc")` is id; `createLinked("def")` returns an id with `identityOf` "def" and no device.
- `it("refuses a second account with the same identity")`: `setIdentity(b, "abc")` after `a` has it throws.
- `it("moveManualData moves hand-added courses, items and their blocks, not Canvas ones")`: from-account has a manual course + manual item (with a study block) + a Canvas course + Canvas item; after the move the target has the manual course, the manual item and its block; the Canvas rows still belong to the from-account; returns 1.
- `it("delete removes the account's devices")`: after `delete(id)`, `findByToken(token)` is null.

- [ ] **Step 2: Run them and see them fail**

Run: `cd server && npx vitest run test/migrations.test.ts test/accounts.test.ts`
Expected: FAIL (no `devices` table / missing methods).

- [ ] **Step 3: Implement**

Migration 3 (index 2 in `MIGRATIONS`), SQLite's rebuild procedure: create `devices (token_hash TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, created_at TEXT NOT NULL)` plus an index on `student_id`; copy `students.token_hash, id, created_at` into it; create `students_new (id TEXT PRIMARY KEY, canvas_identity TEXT UNIQUE, created_at TEXT NOT NULL)`; copy; `DROP TABLE students`; `ALTER TABLE students_new RENAME TO students`.
`migrate()`: switch `foreign_keys` off before the loop (the pragma is a no-op inside a transaction), run each migration in its transaction, check `PRAGMA foreign_key_check` is empty before committing (throw otherwise, rolling back), and switch `foreign_keys` back on in a `finally`. Leave the base `SCHEMA` string as it is: fresh databases get there through the migrations.
`AccountRepository`: rewrite against `devices` per the interface; `hashToken`/`newDeviceToken` from `crypto.ts`.

- [ ] **Step 4: Run all server tests and the typecheck**

Run: `cd server && npm test && npm run typecheck`
Expected: PASS (all existing tests still pass: they authenticate through `findByToken`).

- [ ] **Step 5: Commit**

`git commit -m "Server: devices table and a Canvas identity on each account"` (with the co-author line).

---

### Task 2: Canvas says who logged in

**Files:**
- Modify: `server/src/canvas/CanvasLogin.ts`, `HttpCanvasLogin.ts`, `FakeCanvasLogin.ts`
- Modify: `server/src/canvas/CanvasClient.ts`, `HttpCanvasClient.ts`, `FakeCanvasClient.ts`
- Test: `server/test/httpCanvasLogin.test.ts`, `server/test/httpCanvasClient.test.ts`

**Interfaces:**
- Produces:
  - `CanvasLogin.exchangeCode(code: string): Promise<CanvasTokens & { userId: string }>` (`renew` unchanged).
  - `CanvasClient.whoAmI(): Promise<{ id: string }>`: `GET /api/v1/users/self`.
  - `FakeCanvasLogin.users: Record<string, string>`: code → Canvas user ID, default `{ "good-code": "42" }`. A code not in it is refused, as `"good-code"` alone is today.
  - `FakeCanvasClient`: a `userId` field (default `"42"`) that `whoAmI` returns.

- [ ] **Step 1: Write the failing tests**

- `httpCanvasLogin.test.ts`: `it("exchangeCode returns the Canvas user ID as a string")`: reply `{ access_token, refresh_token, expires_in, user: { id: 42, name: "Maya Thompson" } }` → result has `userId: "42"` and no name anywhere in the result. `it("a token reply without user.id is CanvasUnavailableError")`.
- `httpCanvasClient.test.ts`: `it("whoAmI asks /api/v1/users/self with the token")`: request path `/api/v1/users/self`, `Authorization: Bearer <token>`, reply `{ id: 7, name: "x" }` → `{ id: "7" }`; a 401 is `CanvasAuthError` (same mapping as the other reads).

- [ ] **Step 2: Run them and see them fail**

Run: `cd server && npx vitest run test/httpCanvasLogin.test.ts test/httpCanvasClient.test.ts`

- [ ] **Step 3: Implement** per the interfaces. Keep the comment at the drop of the reply's other fields accurate: only the tokens, expiry and user ID are kept.

- [ ] **Step 4: Run all server tests and the typecheck** (`npm test && npm run typecheck`). Existing callers of `exchangeCode` compile unchanged, since the result only gains a field.

- [ ] **Step 5: Commit**: `"Server: read the Canvas user ID from the login and the token form"`.

---

### Task 3: Link the login to the right account

**Files:**
- Create: `server/src/accounts/AccountService.ts`
- Modify: `server/src/canvasReader/CanvasReaderService.ts` (`finishLogin`, `connect`, `status`)
- Modify: `server/src/schedule/ScheduleService.ts` (public `markChanged`)
- Modify: `server/src/api/app.ts` (auth keeps the device token; replies), `server/src/index.ts`, `server/test/helpers.ts`
- Test: new `server/test/canvasAccounts.test.ts`

**Interfaces:**
- Consumes: Task 1's `AccountRepository`, Task 2's `exchangeCode` `userId` and `whoAmI`.
- Produces:
  - `AccountService` (constructor `(repo: AccountRepository, secretKey: Buffer)`):
    - `create()`, `findByToken(token)`, `delete(studentId)`: pass through to the repository.
    - `isLinked(studentId: string): boolean`
    - `identityHash(canvasUrl: string, canvasUserId: string): string`
    - `link(current: { studentId: string; deviceToken: string }, identity: { canvasUrl: string; userId: string }, save: (studentId: string) => void): LinkResult`. In one transaction it applies the spec's linking table, calls `save(resultingStudentId)` (the caller saves the Canvas tokens there), and returns.
    - `LinkResult = { studentId: string; deviceToken: string | null; removedStudentId: string | null; movedItems: number }`
  - `CanvasReaderService` options gain `accounts: AccountService`.
    - `finishLogin(current: { studentId: string; deviceToken: string }, code: string, state: string): Promise<{ studentId: string; deviceToken: string | null }>`
    - `connect(current, baseUrl: string, token: string)`: same return.
    - `status(studentId)` adds `linked: boolean`.
  - `ScheduleService.markChanged(studentId: string): void`: runs the change listeners (the planner replans).
  - `createApp` deps: `accounts: AccountService` (replacing the repository).
  - `POST /api/canvas/login/finish` and `PUT /api/canvas/connection` reply with `status(result.studentId)`, plus `deviceToken` when it isn't null.
  - `test/helpers.ts`: `newStudent()` also returns `token`, and a `loginAs(student, code)` helper (start, then finish with the returned state) is available to tests; a student object can switch tokens (`student.useToken(t)`) after a reply carries `deviceToken`.

- [ ] **Step 1: Write the failing tests** in `canvasAccounts.test.ts`. With `FakeCanvasLogin.users = { "maya": "1", "liam": "2" }`:
- `it("the first login links the phone's own account and keeps its hand-added items")`: student adds a manual item, logs in as maya → no `deviceToken`, `linked: true`, the manual item is still in `/api/schedule/overview`.
- `it("logging in again as the same student changes nothing")`: second login as maya → no `deviceToken`; item counts unchanged.
- `it("another student on the same phone gets a new account")`: phone linked to maya logs in as liam → reply has `deviceToken`; with it, overview has none of maya's items; maya's account still has its items (log in as maya from a second fresh phone and see them, with that phone's `deviceToken`).
- `it("an unlinked phone logging in to an existing account moves its hand-added items and is deleted")`: phone A logs in as maya. Fresh phone B adds manual item "Read chapter 4", with a manual course, then logs in as maya → `deviceToken` present; with it, the overview has maya's items and "Read chapter 4"; B's old token now gets 401; `students` row count dropped by one.
- `it("disconnect keeps the account linked")`: after `DELETE /api/canvas/connection`, the status says `connected: false, linked: true`; logging in as maya again → no `deviceToken`.
- `it("the token form links the same way")`: `PUT /api/canvas/connection` with a token, where `FakeCanvasClient.userId = "1"`, on a fresh phone, after maya already has an account → reply has `deviceToken`.
- `it("deleting the account logs out its other phones")`: two phones on maya; phone 1 `DELETE /api/account`; phone 2's next request → 401.
- `it("stores no Canvas user ID")`: after logging in as maya, no column of `students` or `devices` contains `"1"` as a whole value, and `canvas_identity` equals `HMAC-SHA256(key, "https://canvas.test|1")` (compute it in the test via `AccountService.identityHash`, and check it is 64 hex characters).
- `it("a failed login links nothing")`: a refused code leaves the phone unlinked and creates no account.

- [ ] **Step 2: Run them and see them fail**

Run: `cd server && npx vitest run test/canvasAccounts.test.ts`

- [ ] **Step 3: Implement**
- Order in `finishLogin`: take the state, exchange the code, check it with `listCourses` (revoke and rethrow on failure, as today); then remember the current account's connection (for a revoke if that account is removed); then `accounts.link(current, { canvasUrl: login.canvasUrl, userId }, (target) => { previousOfTarget = repo.getConnection(target); repo.saveConnection(target, ...) })`. After commit: revoke `previousOfTarget` if renewable (as today); if `removedStudentId === current.studentId` and its old connection was renewable, revoke it best effort; if `movedItems > 0`, `schedule.markChanged(result.studentId)`.
- `connect` does the same with `whoAmI()` after the `listCourses` check and the token form's URL.
- Auth middleware stores the device token on the request next to `studentId`.

- [ ] **Step 4: Run all server tests and the typecheck**: existing login and sync tests pass. Update the call sites in existing tests only where the signatures changed.

- [ ] **Step 5: Commit**: `"Server: a Canvas login opens that student's own Cue account"`.

---

### Task 4: Log out on the server

**Files:**
- Modify: `server/src/accounts/AccountService.ts` (`logout`), `server/src/api/app.ts` (route, error mapping)
- Modify: `README.md` (server API list, accounts, the secret-key note)
- Test: `server/test/canvasAccounts.test.ts`

**Interfaces:**
- Produces: `AccountService.logout(studentId: string, deviceToken: string): void`, throwing `AccountNotLinkedError` (exported) for an unlinked account. `DELETE /api/device` → 204; `AccountNotLinkedError` → 409 `account_not_linked`.

- [ ] **Step 1: Write the failing tests**
- `it("log out forgets only this phone")`: two phones on maya; phone 1 `DELETE /api/device` → 204; phone 1's token → 401; phone 2 still 200; maya's Canvas connection still there (`connected: true` from phone 2).
- `it("an unlinked account can't log out")`: fresh phone → 409 `account_not_linked`; its token still works.
- `it("log out then log in again brings the data back and leaves no empty account")`: phone linked to maya, with a manual item; `DELETE /api/device`; `POST /api/devices` (what the app does next); log in as maya with the new token → `deviceToken` present; with it, the manual item is there; the `students` count equals what it was before logging out.

- [ ] **Step 2: Run them and see them fail**: `cd server && npx vitest run test/canvasAccounts.test.ts`

- [ ] **Step 3: Implement**; README: replace "anonymous account per phone" wording with how accounts follow the Canvas login, add `DELETE /api/device` and the `deviceToken`/`linked` reply fields to the API list, and note beside `CUE_SECRET_KEY` that changing it also unlinks accounts from their Canvas logins.

- [ ] **Step 4: Run all server tests and the typecheck**

- [ ] **Step 5: Commit**: `"Server: log out a phone"`.

---

### Task 5: The app follows the account the server picks

**Files:**
- Modify: `app/src/api/types.ts` (`ConnectionStatus.linked`), `app/src/api/client.ts`
- Modify: `app/src/viewmodels/useCanvasLogin.ts`, `app/src/screens/connect/TokenConnectScreen.tsx`, `app/src/viewmodels/useSync.ts`, `app/src/navigation/startup.ts`, `app/App.tsx`
- Modify: `app/test-support/fakeServer.ts`
- Test: `app/src/api/client.test.ts` (or the client's existing test file), the login view model's test file, `useSync`'s test file

**Interfaces:**
- Produces:
  - `ConnectionStatus.linked: boolean`; `Startup.linked: boolean` (start-up's answer, as `canvasUrl` is).
  - `ApiClient.finishCanvasLogin(code, state)` and `connectCanvas(baseUrl, token)` resolve to `ConnectionStatus & { switched: boolean }`. When the server's reply has `deviceToken`, the client stores it (store and memory) before resolving, and `switched` is true.
  - `ApiClient.logout(): Promise<void>`: `DELETE /api/device` without the 401 retry. 204 or 401 → `forgetDevice()`; anything else throws `ApiError`.
  - `useSync` exposes `linked: boolean`.
  - After a `switched` result, `useCanvasLogin` and the token form call `syncTimeZone(api)` without awaiting it.
  - `fakeServer`: `state.linked` (in every connection reply); `state.switchToken: string | null`: when set, login finish and token connect reply with `deviceToken: state.switchToken` and requests with that token then work; `DELETE /api/device` → 204, or 409 `account_not_linked` when `!state.linked`, or 401 when `state.logoutUnauthorized`.

- [ ] **Step 1: Write the failing tests**
- `it("adopts the device token a login reply carries")`: finish returns `deviceToken: "device-9"` → the store's `cue.deviceToken` is `"device-9"`, `switched` true; the next request sends `Bearer device-9`.
- `it("a request still in flight with the old token doesn't start a fresh account")`: a request made with token A is answered 401 after the client has adopted token B → no `POST /api/devices` happens, the stored token stays B, and the request is retried once with B.
- `it("a 401 with the current token still starts a fresh account")`: the existing recovery keeps working.
- `it("logout forgets the token on 204 and on 401, and keeps it on 500")`.
- `it("after a switched login the phone's time zone is sent")`: in the login view model's test, `PUT /api/planner/settings` (or whatever `syncTimeZone` calls) happens after a switched finish, and not after an unswitched one.
- `useSync` reports `linked` from the connection status.

- [ ] **Step 2: Run them and see them fail**: `cd app && npx jest <files>`

- [ ] **Step 3: Implement.** The 401 guard: remember the token a request was sent with; on 401, if the stored token has changed since, retry once with the current token and don't reset; otherwise reset as today.

- [ ] **Step 4: Run the app suite, the typecheck and lint**

- [ ] **Step 5: Commit**: `"App: follow the account a Canvas login opens"`.

---

### Task 6: Log out in Settings, and honest privacy copy

**Files:**
- Modify: `app/src/screens/settings/SettingsScreen.tsx`
- Modify: `app/src/screens/welcome/WelcomeScreen.tsx`, `app/src/screens/settings/WhatCueKeepsScreen.tsx`
- Modify: `README.md` (app section: Log out, what Cue keeps)
- Test: the Settings, Welcome and What Cue keeps screen tests

**Interfaces:**
- Consumes: `useSync().linked`, `ApiClient.logout()`, the existing post-delete sequence in Settings (clear the onboarded flag, `ensureAccount`, `syncTimeZone` not awaited, reset to Welcome).

- [ ] **Step 1: Write the failing tests** (copy verbatim from Global Constraints)
- `it("shows Log out only for an account linked to Canvas")`: `state.linked = false` → no `Log out` row; `true` → row present, in its own group above About.
- `it("Log out asks first, then returns to Welcome")`: pressing it shows `Log out of Cue?` with the exact message and buttons; choosing `Log out` → `DELETE /api/device` called, the device token is gone from the store, a new anonymous account is created, and Welcome is on screen.
- `it("Log out treats a 401 as logged out")` and `it("Log out shows the error and stays when the server fails")` (500 → error banner, still on Settings, token kept).
- `it("Cancel keeps you logged in")`.
- The delete alert's message is the new copy.
- Welcome shows the new footnote; What Cue keeps shows the new first entry and delete entry.

- [ ] **Step 2: Run them and see them fail**

- [ ] **Step 3: Implement.** The Log out row uses the kit's action-row style in accent (not danger), shows busy while the request runs, and is disabled while busy. The post-success sequence is shared with Delete all my data (extract one function in the screen; no new module needed).

- [ ] **Step 4: Run the app suite, the typecheck and lint**

- [ ] **Step 5: Commit**: `"App: Log out in Settings, and what Cue keeps about your Canvas login"`.
