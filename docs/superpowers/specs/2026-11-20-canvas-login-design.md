# Log in with Canvas: design

## Why

To connect Cue to Canvas today, a student types the Canvas address, opens Canvas's settings page from the Connect screen, creates an access token, copies it, comes back to Cue and pastes it. That is slow and easy to get wrong on a phone, especially in front of an audience.

Cue will be demoed to and used by students against the team's own local Canvas (run with `scripts/local-canvas.sh` and reached from phones through ngrok), for the whole demo. Because the team is that Canvas's admin, Cue can use Canvas's standard login (OAuth 2): the student taps one button, logs in on Canvas's own page, approves Cue, and is connected. No token to create, copy or paste.

## Goals

- A **Log in with Canvas** button on the Connect screen. The student logs in, taps Authorize, and lands on the Review screen exactly as after connecting with a token today.
- Cue's server swaps Canvas's one-time code for an access token and a refresh token, stores both encrypted, and renews the access token by itself (Canvas access tokens from login last one hour). Students never see an expiry.
- The token Canvas issues can only read the three things Cue reads (courses, assignments, calendar events). Even a leaked token cannot change anything in Canvas.
- `scripts/local-canvas.sh start` with ngrok sets everything up: it creates Canvas's developer key for Cue (once) and writes the login settings into `server/.env`.
- Built the standard way (code exchange and renewal on the server), so the server side carries over unchanged if Cue later works with a school's Canvas.

## Non-goals

- Real schools' Canvases: choosing among several Canvases, or one developer key per school.
- Login against the Mac-only address `http://canvas.docker` (phones can't reach it). Login is set up only on the ngrok path of `start`.
- A Disconnect button in the app (there isn't one today; the server endpoint exists).
- Google sign-in. The local Canvas uses Canvas's own username and password. Google refuses sign-in inside an in-app web view (`disallowed_useragent`), so adding Google later would mean moving login to the phone's browser sheet (see Approaches).
- Students sharing one phone. Each student uses Cue on their own phone; Cue's anonymous account is per installed app, so a shared phone would show one student's schedule to the next.
- Any change to syncing, the Review screen or the schedule.

## Anti-goals

- The developer key's secret on the phone, in git, in logs, or printed by the script.
- Storing who the student is. Canvas's token reply includes the student's Canvas user ID and name; Cue must not store or log them (Cue stores no name or email anywhere).
- Breaking the token path. Existing connections made with a pasted token keep working, and its code stays, ready to show again.
- A token that can write to Canvas.
- Cue's app reading what the student types on Canvas's login page. The app only watches the page's address; it injects no scripts and reads no page content.

## Approaches

How Cue handles Canvas login tokens expiring after an hour:

1. **Standard login with renewal (chosen).** The server keeps a refresh token and renews access when it expires. It is how Cue would work with a real school, so none of it is thrown away later. More server work: new columns, renewal before syncing, handling a student who revokes Cue in Canvas.
2. **Local Canvas issues tokens that never expire.** Canvas's developer key has a setting for this. Less server work, but only possible because the team controls this Canvas; a school would never allow it, and renewal would have to be built later anyway.

Dropped: Canvas showing a code for the student to copy back (brings copy and paste back), and Cue asking for the student's Canvas password (Cue should never handle passwords).

How the login comes back to the app (a call made in writing this design; see "Calls made"):

- **Login page in a web view inside Cue, using Canvas's "out-of-band" return (chosen).** Canvas allows the special return address `urn:ietf:wg:oauth:2.0:oob` for any developer key. After the student authorizes, Canvas sends the page to its own `/login/oauth2/auth?code=…&state=…`. The app's web view sees that address, stops it loading, and hands the code to Cue's server. Nothing has to be registered in Canvas, and it works however the phone reaches Cue's server and on both iPhone and Android in Expo Go. This is how Canvas's own mobile apps log in. Trade-off: the login page shows inside Cue rather than in the phone's browser, which login guidance for real schools discourages (and Google sign-in refuses); for a real school this part of the app would move to the system browser.
- **System browser, returning to Cue's server.** The standard way, but Canvas only returns to addresses registered on the developer key, and Cue's server address is the Mac's Wi-Fi address, which changes with every network and can differ between the Mac's interfaces. A mismatch shows Canvas's "redirect URI does not match" error mid-demo.

## Design

### Settings (server)

Three new variables in `server/.env`. All three set: login is available. None set: the app shows today's token screen. Some but not all set: the server refuses to start and names what's missing.

| Variable | Meaning |
| --- | --- |
| `CUE_CANVAS_URL` | The Canvas address phones use, the ngrok address (`https://…ngrok-free.dev`). Checked like a student-entered address today (https unless `CUE_ALLOW_INSECURE_CANVAS=1`). |
| `CUE_CANVAS_CLIENT_ID` | The developer key's ID |
| `CUE_CANVAS_CLIENT_SECRET` | The developer key's secret |

Add the three, commented, to `server/.env.example`.

### Login (server)

`GET /api/canvas/connection` adds `loginAvailable: boolean`.

`POST /api/canvas/login` (device token required) returns `{ authorizeUrl }`:

- Makes a random `state` (at least 32 random bytes), stores it with the student's ID and an expiry of 10 minutes, in the database (a new table), so `npm run dev` restarting on a file save doesn't lose it. Expired rows are cleared as new ones are written, like sync previews.
- `authorizeUrl` is `CUE_CANVAS_URL/login/oauth2/auth` with `client_id`, `response_type=code`, `redirect_uri=urn:ietf:wg:oauth:2.0:oob`, `state`, and `scope` (the three read scopes below, space-separated).

`POST /api/canvas/login/finish` with `{ code, state }`:

- The state must exist, belong to this student and not be expired. It is deleted whatever happens (used once). Otherwise: `409 login_expired`.
- Exchanges the code: `POST CUE_CANVAS_URL/login/oauth2/token` (form-encoded) with `grant_type=authorization_code`, `client_id`, `client_secret`, `redirect_uri=urn:ietf:wg:oauth:2.0:oob`, `code`. Canvas refusing it: `409 canvas_login_failed`. Canvas unreachable: the existing `502 canvas_unavailable`.
- Checks the access token with one read (as `connect` does today), then saves the connection: base URL `CUE_CANVAS_URL`, access token, refresh token, and the time access expires (now plus Canvas's `expires_in`). Tokens are sealed with the existing `encrypt`. Everything else in Canvas's reply (including `user`) is dropped.
- Returns the same status body as `PUT /api/canvas/connection`.

### Storage

`canvas_connections` gets two nullable columns: `refresh_sealed` and `access_expires_at`. Rows made from a pasted token leave both empty and are never renewed, as today. The columns and the login-state table are added as the next entry in `MIGRATIONS` in `server/src/db.ts`, the Planner's migration list (applied once, by `user_version`).

### Renewal

- Before any Canvas read for a student (today, the sync preview), if the connection has a refresh token and access expires within 2 minutes, renew first: `POST /login/oauth2/token` with `grant_type=refresh_token`, `client_id`, `client_secret`, `refresh_token`. Save the new access token and expiry (and a new refresh token, if Canvas sends one).
- If a read gets 401 and the connection has a refresh token, renew once and retry the whole read once.
- If renewal is refused (the student revoked Cue in Canvas, or the key was deleted), the student must connect again: the existing `409 canvas_token_rejected`. The app's message for it changes to wording that fits both ways of connecting, e.g. "Canvas no longer accepts Cue's access. Connect again." Keep the saved connection row so the app still knows the Canvas address.
- The HTTP calls to Canvas's login endpoints (code exchange, renewal, revoke) go behind an interface next to `CanvasClient`, with a fake for tests, following the Adapter pattern already in `server/src/canvas/`.

### Disconnect

For connections made through login, `DELETE /api/canvas/connection` and `DELETE /api/account` also ask Canvas to revoke the token (`DELETE /login/oauth2/token` with the access token), renewing first if access has expired (Canvas won't accept an expired token for this). Best effort: a failure is ignored and the row is deleted anyway.

Connections made with a pasted token are never revoked: that token is the student's own, created by them in Canvas, and Cue leaves it alone as today.

When a pasted token replaces a login connection (through `PUT /api/canvas/connection`, for example after login settings are removed), saving it clears `refresh_sealed` and `access_expires_at`, so the new connection is never renewed with the old refresh token.

### Read-only scopes

The developer key enforces scopes, allowing only:

- `url:GET|/api/v1/courses`
- `url:GET|/api/v1/courses/:course_id/assignments`
- `url:GET|/api/v1/calendar_events`

Exact strings to be checked against the pinned Canvas version (see "Left to the builder"). Cue's only non-GET requests to Canvas are the login's own token requests (exchange, renewal, revoke). The README's "only with read (GET) requests" line and the comment in `CanvasClient.ts` change to say that.

### App

Connect screen:

- `loginAvailable` true: a short line ("Log in with your Canvas account. Cue only reads your courses and deadlines."), a primary **Log in with Canvas** button, and **Skip**. The token controls (address, token, "Open Canvas to create a token", "Connect and sync") are not rendered, and there is no link to them. Their logic stays: `useConnectCanvas`, `ApiClient.connectCanvas` and `PUT /api/canvas/connection` are kept and keep their tests, so the token form can be shown again by changing only what the screen renders.
- `loginAvailable` false (the server has no login settings): today's token screen, unchanged, since it is then the only way to connect.

Login screen (full screen, opened by the button):

```
┌──────────────────────────────┐
│ Cancel      Log in to Canvas │
├──────────────────────────────┤
│                              │
│   Canvas's own login page,   │
│   then its Authorize page    │
│                              │
└──────────────────────────────┘
```

- Asks the server for `authorizeUrl`, then loads it in a web view (`react-native-webview`, added with `npx expo install`; it is included in Expo Go).
- The web view is private (`incognito`): Canvas's site leaves no cookies or session on the phone, in keeping with Cue keeping no Canvas credentials on the phone. The cost is typing the Canvas username and password on every login, which is rare (once per connection).
- When the web view is about to load a URL whose path is `/login/oauth2/auth` and which has a `code` parameter and the expected `state`, it stops that load, shows a spinner, and calls `login/finish`. Success: back to the flow exactly as after "Connect and sync" today (the Review screen). If the URL has an `error` parameter (the student tapped Cancel on Canvas's Authorize page): close and show "You didn't allow Cue to read Canvas." on the Connect screen.
- Cancel closes it with no message. Errors from the server show on the Connect screen through the existing error banner and `friendlyMessage` (add `login_expired` and `canvas_login_failed`).
- ngrok shows a warning page to browsers the first time. Try to skip it in the web view (ngrok skips it for requests with an `ngrok-skip-browser-warning` header or a non-browser user agent); if neither works across Canvas's redirects, the student taps **Visit Site** once per login.

### Script: `local-canvas.sh start` with ngrok

After Canvas answers at the ngrok address, and before printing it:

1. **Developer key.** If `server/.env` already has all three settings, the client ID still exists in Canvas, and `CUE_CANVAS_URL` is the current ngrok address, skip this step. Otherwise find or create a developer key named "Cue" in the local Canvas, by running a short Ruby snippet with `rails runner` inside the running web container: enforce the three scopes above, turn it on for the root account, leave token expiry on (Canvas's default). Reuse the existing key if there is one rather than making another each time.
2. **Settings.** Write or replace the three `CUE_CANVAS_*` lines in `server/.env`, keeping every other line. If `server/.env` doesn't exist, copy `server/.env.example` and also generate `CUE_SECRET_KEY` (32 random bytes, base64), so saved Canvas tokens survive server restarts. Never print the secret.
3. **Tell the teammate** to restart Cue's server so it picks up Canvas login, and change the closing text: students now tap **Log in with Canvas**; they no longer need the address.

This extends the local Canvas script's job: its earlier design kept it away from Cue's code, and it now writes `server/.env`. `server/.env` is already git-ignored.

The script writes the `server/.env` of the checkout it runs from, which suits the usual setup: Cue's server on the same Mac as Canvas. To run Cue's server on another computer, copy the three `CUE_CANVAS_*` lines from that file by hand; the README says so. The script never prints them.

### README

- "Getting a Canvas token" becomes "Connecting Canvas": login when the server has login settings; the token steps only for a server without them.
- The local Canvas section: `start` with ngrok sets up login; restart Cue's server after; demo students need Canvas logins created by the Canvas admin and must be enrolled in courses.
- The API table gains the two login routes; the settings table gains the three variables.

## Testing

- **Server (vitest, fake Canvas login):** authorize URL contents; finish with a good, expired, reused and another student's state; Canvas refusing the code; tokens stored sealed with the expiry and nothing from `user` stored; renewal shortly before expiry; renewal after a 401 followed by one retry; refused renewal gives `canvas_token_rejected`; pasted-token connections unchanged and never renewed; `loginAvailable` with all, none and some settings (some refuses to start); for login connections, disconnect and account delete renew if needed, try to revoke, and still delete when that fails; pasted-token connections are never revoked; a pasted token replacing a login connection clears the refresh token and expiry; the new migration upgrades a database at the previous version and keeps its connections.
- **App (jest):** Connect screen with login (only the login button and Skip; no token controls) and without (today's token screen); the login screen's URL check (code with matching state, wrong state, `error`, unrelated Canvas pages) and the calls it makes; new error messages.
- **Script:** unit tests in `local-canvas.test.sh` for the `server/.env` rewriting (replace, add, keep other lines, create from the example with a secret key). The developer key step is checked by hand against the local Canvas, as are the other Canvas-touching steps.
- **By hand, end to end:** iPhone and Android in Expo Go, Canvas through ngrok. Log in as a student account, authorize, see the Review screen, sync. Set `access_expires_at` in the past and sync again (renews). Revoke Cue in Canvas (Account → Settings → Approved Integrations) and sync (asks to connect again). Tap Cancel on Canvas's Authorize page. Connect with a pasted token still works.

## Calls made

Decided in writing this design, open to change:

- Login in a web view with Canvas's out-of-band return, not the system browser (reasons under Approaches). Confirmed workable: the demo uses no Google sign-in.
- The web view is private, so every login asks for the Canvas username and password.
- The token's scopes are limited to Cue's three reads.
- Revoking at Canvas on disconnect and account deletion, for login connections only; pasted tokens are left alone.
- Login state kept in the database, not in memory.
- The script also creates `server/.env` with a secret key when it's missing.
- The script writes only its own checkout's `server/.env`; a Cue server on another computer gets the settings copied by hand.

Decided by the team after review: when login is available, the token controls are not rendered at all (no "Use a token instead" link); their code stays.

## Left to the builder

- Exact screen and script wording, and layout.
- The Ruby snippet for the developer key, and the exact scope strings, checked against the pinned Canvas commit (`1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`), including how the key is turned on for the root account and how the script checks that a saved client ID still exists.
- Where renewal sits (inside `CanvasReaderService`, or a small helper it uses) and the names of the new interface, fake and table.
- Whether the ngrok warning can be skipped in the web view, and how.
