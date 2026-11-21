# Cue accounts from the Canvas login

## Why

Cue keeps one anonymous account per phone. Logging in with Canvas only
attaches a Canvas connection to whatever account the phone already has, so:

- logging in as a second student on the same phone mixes the two students'
  data (seen in the demo: Maya's courses next to an admin's test course);
- a student's data can't follow them to another phone;
- there is no real "Log out", only Disconnect (keeps everything) and Delete
  (removes everything).

Canvas's login reply already tells Cue who logged in (`user.id`), and Cue
throws it away today (`server/src/canvas/HttpCanvasLogin.ts`). This change
uses it: the Canvas login decides which Cue account the phone uses.

## Goals

- Logging in with Canvas opens that Canvas user's own Cue account, on any phone.
- Logging in as a different Canvas user on the same phone opens theirs; nothing mixes.
- A student who used Cue before logging in (Skip for now, hand-added items)
  keeps that work when they log in.
- Settings gets **Log out**: this phone forgets the account; the data stays on
  the server and comes back on the next Canvas login.

## Non-goals

- Cue's own email/password accounts (decided earlier: Canvas login accounts).
- Merging two Canvas-linked accounts, or moving data between Canvas users.
- Background sync, multi-Canvas accounts, or listing which phones are logged in.
- Cleaning up the existing demo database: the one current account is unlinked,
  so Maya's next login would claim it; Delete all my data once before testing.

## Anti-goals (a failure even if it works)

- Storing the student's name, email or raw Canvas user ID. N3 privacy stays:
  Cue knows a student only by a code it can't turn back into a Canvas user.
- Silently losing a student's data: hand-added items, or an account's data
  when a phone logs out.
- A phone ending up on the wrong account after a login (for example, a
  request still in flight with the old token creating a fresh account).

## Constraints

- Server: Express + better-sqlite3; schema changes are numbered migrations in
  `server/src/db.ts` (`user_version`). Existing databases must upgrade without
  losing data; every existing phone keeps working after the upgrade.
- App: Expo SDK 58, MVVM hooks, the design system in `app/src/ui/`.
- The Canvas developer key's scopes stay as they are (courses, assignments,
  calendar events). Logging in needs no extra scope: `user.id` comes in the
  token reply (`lib/canvas/oauth/token.rb#as_json` in Canvas: `user.id`,
  `user.name`, `user.global_id`).
- Never write sprint labels in code, tests, docs or commits.

## Approaches considered

1. **Canvas identity on the Cue account (chosen).** Each account may carry a
   keyed hash of the Canvas address plus the Canvas user ID. Logins look the
   account up by it. A devices table lets one account be on several phones.
2. **Store the raw Canvas user ID.** Same flow, slightly simpler, but Cue's
   database would then say which Canvas user each account is: breaks N3 for
   no gain, since the hash serves the lookup equally well.
3. **A fresh account on every Canvas login.** Simplest, but a student who
   started with Skip for now loses their hand-added items on first login.

## Design

### Identity

- `canvas_identity = HMAC-SHA256(CUE_SECRET_KEY, canvasUrl + "|" + canvasUserId)`,
  hex. `canvasUrl` is the normalised address Cue already uses for the
  connection (no trailing slash). Keyed, so the database alone can't be
  matched against Canvas user IDs. Changing `CUE_SECRET_KEY` already makes
  stored Canvas tokens unreadable; it now also unlinks accounts (documented in
  the README next to the key).
- Stored on `students.canvas_identity`, unique, null for an unlinked account.
- An account's identity never changes once set. Delete all my data removes it
  with the account.

### Devices

- New table `devices (token_hash PRIMARY KEY, student_id → students ON DELETE
  CASCADE, created_at)`. Every device token in use today moves into it;
  `students.token_hash` goes away. `POST /api/devices` creates an unlinked
  account with one device, as now. Authentication looks the token up in
  `devices`.
- Migration: SQLite can't drop a UNIQUE column, so `students` is rebuilt
  (create new, copy, drop old, rename) with foreign keys switched off for the
  duration and `PRAGMA foreign_key_check` before commit, which is SQLite's
  documented procedure. With foreign keys on, dropping `students` would
  cascade-delete every child row. Builder decides how `migrate()` switches
  them off (it currently wraps each migration in a transaction, where the
  pragma is a no-op).

### Linking a login to an account

When a Canvas login finishes, Cue knows the phone's current account (from its
device token) and the identity (from the token reply). In one transaction:

| Account with this identity | This phone's account | Result |
|---|---|---|
| none | unlinked | The phone's account takes the identity. Nothing moves; the phone keeps its token. |
| none | linked to someone else | A new account with this identity and a new device for this phone. |
| the phone's own account | (same) | Nothing changes (a reconnect). |
| another account | unlinked | **Switch + move**: the phone gets a new device on the existing account. The old account's hand-added courses and items, with those items' study blocks, move to the existing account; then the old account is deleted. |
| another account | linked to someone else | **Switch**: the phone gets a new device on the existing account. The old account stays as it is, for its owner. |

In every switch, the phone's old device row is deleted (the phone no longer
holds that token).

- "Hand-added" means `source = 'manual'`. A moved item whose course was a
  Canvas course of the old account ends up with no course (the existing
  `ON DELETE SET NULL` does this when the old account is deleted). Canvas
  items of an unlinked account (only possible for accounts connected before
  this change) are not moved; the existing account's own sync brings Canvas
  data.
- The old unlinked account's Canvas connection, if it has one, is revoked best
  effort before it is deleted, as Delete all my data does.
- After a move, the target account is replanned (the existing
  `schedule.onChange` hook).
- The Canvas tokens from this login are then saved on the resulting account,
  replacing (and revoking, as today) any renewable connection it had.
- Moved rows can't collide: a hand-added course or item uses its own random
  id as its `external_id`, so `UNIQUE (student_id, source, external_id)`
  can't match a row the target already has.
- Everything else of the old unlinked account goes when it is deleted (the
  cascade): its planner settings (time zone, study times, daily limit; the
  target's own win), sync previews, login states, Canvas connection and
  Canvas courses and items. The student-keyed tables are `devices`,
  `canvas_connections`, `courses`, `items`, `study_blocks`,
  `planner_settings`, `sync_previews` and `canvas_login_states`.
- Order: all Canvas requests first (code exchange or token check, then
  `users/self` for the token form). Then one synchronous database transaction
  does the linking, the move, the old account's deletion and saving the new
  Canvas tokens. Best-effort revokes run after it commits. better-sqlite3
  transactions are synchronous in one process, so two logins can't interleave
  inside the linking step.
- A connection belongs to the account, not to a phone, and phones never hold
  Canvas tokens: a second phone logging in replaces the account's connection
  without breaking the first phone.
- Accounts that exist before this change stay unlinked, keep working (with or
  without a Canvas connection), and don't show Log out. Their next Canvas
  login links them by the table above; nothing is back-filled.
- An unlinked account lives on one phone. If the same student first logs in
  on another phone, that phone's account takes the identity; when they later
  log in on the first phone, its hand-added items move over (switch + move).

### Where the identity comes from

- **Log in with Canvas:** `exchangeCode` returns the user ID from the token
  reply alongside the tokens. A reply without `user.id` is a
  `CanvasUnavailableError` (and the fresh token is revoked best effort).
  Renewal doesn't need it.
- **Token form** (hidden in the app, kept working): after checking the token,
  Cue asks Canvas `GET /api/v1/users/self` for the ID. Personal access tokens
  are unscoped, so this works; the developer key's scopes don't apply to them.
  The same linking table then applies, with the token form's Canvas address.

### API

- `POST /api/canvas/login/finish` and `PUT /api/canvas/connection` reply with
  the connection status of the resulting account plus `deviceToken` when the
  phone switched accounts (absent otherwise).
- `GET /api/canvas/connection` (and the two replies above) gain
  `linked: boolean`: the account has a Canvas identity. It stays true after
  Disconnect.
- New `DELETE /api/device` (Log out): deletes this phone's device row; 204.
  For an unlinked account it refuses with 409 `account_not_linked` and changes
  nothing, because the data would be unreachable afterwards. The Canvas
  connection is left alone (another phone may be using the account).
- `DELETE /api/account` is unchanged: removes the account, its identity and
  all its devices. Other phones on that account get 401 on their next request
  and start a fresh anonymous account, as the client already does.

### App

- `finishCanvasLogin` and `connectCanvas`: when the reply has `deviceToken`,
  the client stores it in place of the old one before resolving. The login
  then continues to Check what Cue found as today, which loads with the new
  token; screens reload on focus.
- After a switch the app tells the server the phone's time zone (not awaited),
  as start-up does, because a new account has none.
- The client's 401 recovery (start a fresh anonymous account) only runs when
  the token that got the 401 is still the stored one, so a request still in
  flight with the pre-switch token can't replace the new one.
- Settings: a **Log out** row, shown only when `linked`, in its own group
  above About. It asks first:
  - title "Log out of Cue?"
  - message "Your schedule and study plans stay saved. Log in with Canvas to
    get them back, on this phone or another."
  - buttons "Log out" and "Cancel".
  On success the app forgets the device token, clears the onboarded flag, and
  resets to Welcome. A 401 reply (the server no longer knows this phone)
  counts as success: the phone is logged out either way. Any other failure
  shows the error and stays. Not red: nothing is deleted.
- Disconnect keeps the identity and the phone's device: `linked` stays true,
  Log out stays available, and the next Canvas login as the same student
  reconnects the same account.
- Copy (N3/N4 honesty):
  - Welcome footnote: "No name or email needed. Your Canvas access stays on
    Cue's server, not this phone."
    → "No name or email needed. Your Canvas login is your Cue account; your
    Canvas access stays on Cue's server."
  - What Cue keeps, first entry → title "No name or email", text "Cue never
    asks who you are. When you log in with Canvas, Cue keeps a scrambled code
    for your Canvas account, so it can find your schedule again. It can't
    turn that code back into your name."
  - What Cue keeps, the deleting entry → "Delete all my data, in Settings,
    removes your account and everything Cue holds for you, on every phone."
  - Delete alert message gains ", on every phone": "Your schedule, courses
    and study plans are removed from Cue, on every phone. This can't be
    undone."

## Left to the builder

- Module boundaries: where the linking logic lives (an account service the
  Canvas reader calls is the expected shape), and how the device token
  reaches it.
- How `migrate()` runs a migration with foreign keys off.
- Test fakes: how `FakeCanvasLogin` and `FakeCanvasClient` report user IDs
  (tests need at least two users).
- README updates (the accounts section, the secret key note, the API list).
