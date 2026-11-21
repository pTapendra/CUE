# Cue

Cue is a study app for university students who use Canvas. It plans the work, tells you when to start it, and tests whether you know it.

This repository holds two parts:

| Folder | What it is |
| --- | --- |
| `server/` | Back-end server: Node.js, Express, TypeScript, SQLite |
| `app/` | Mobile app: React Native with Expo, TypeScript (runs in Expo Go; can be turned into a bare React Native project at any time) |

The app talks only to the server. Only the server talks to Canvas, and only with read (GET) requests, apart from the token requests of logging in with Canvas (code exchange, renewal and revoke).

## What works

- **Retrieve schedule data (UC1).** Connect a Canvas account with Log in with Canvas (or with a personal access token when the server has no login settings), read courses, assignment deadlines and calendar events, and review them before anything is saved. Exams are recognised by their titles (exam, midterm, final, test). An exam with no date in Canvas is flagged so the student can type one in.
- **View and edit the schedule (UC2).** A three-day time grid (the arrows move three days; tapping the title returns to today) with a "Needs a date" list. Students can add items by hand (including exams Canvas does not list), edit them, delete them, and set one of four statuses: Not started, In progress, Done, Postponed.
- **Study planner.** Students set their study times (which hours of each weekday they can study, in their own time zone) and a daily limit, and give each item an amount of study time (an exam defaults to 6 hours, an assignment to 2). Cue suggests study blocks that fit inside the study times, before the due date, and shows them on a three-day time grid next to events and deadlines. A student can accept, move or reject each block, or accept all suggestions on screen at once. Where the time does not fit, the app says how much is missing.
- **Privacy.** Each installed app gets an anonymous account. No name or email is collected. The Canvas token is encrypted (AES-256-GCM) on the server and never stored on the phone.

Not built yet: start reminders, notes and slides, quizzes, weak topics.

## Run the server

Requires Node.js 22 or later.

```bash
cd server
npm install
cp .env.example .env        # then set CUE_SECRET_KEY (see below)
npm run dev                 # http://localhost:3000
npm test                    # 77 tests, uses a fake Canvas
```

Create a secret key once and put it in `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Without `CUE_SECRET_KEY` the server makes a temporary key, and saved Canvas tokens stop working after a restart.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `CUE_DB_FILE` | `cue.db` | SQLite database file |
| `CUE_SECRET_KEY` | (temporary) | 32 bytes, base64. Encrypts Canvas tokens |
| `CUE_ALLOW_INSECURE_CANVAS` | off | Set to `1` to allow `http://` or local Canvas addresses during development |
| `CUE_CANVAS_URL` | (off) | The Canvas address phones use. Set with the next two to turn on **Log in with Canvas** |
| `CUE_CANVAS_CLIENT_ID` | (off) | The developer key's ID |
| `CUE_CANVAS_CLIENT_SECRET` | (off) | The developer key's secret. Never sent to the app |

The server reads `server/.env` on start when the file exists.

## Run the app on your phone (Expo Go)

No Xcode or Android Studio needed.

1. Install **Expo Go** on your phone from the App Store or Google Play.
2. Put the phone and your computer on the **same Wi-Fi**.
3. Start the server (above), then in a second terminal:

```bash
cd app
npm install
npm start                   # shows a QR code
npm test                    # 50 tests
```

4. Scan the QR code: on iPhone with the Camera app, on Android from inside Expo Go. The app opens and reloads when you save a file.

Students set their study times from **⚙ → Study times** in the app. Until they do, Cue uses the defaults (Monday to Friday 18:00 to 22:00, Saturday and Sunday 10:00 to 16:00, at most 3 hours a day).

The app finds the server automatically on the computer that runs `npm start` (port 3000). To use a server elsewhere, copy `app/.env.example` to `app/.env` and set `EXPO_PUBLIC_SERVER_URL`.

If the phone cannot connect, try `npx expo start --tunnel` for the app, check that your computer's firewall allows incoming connections to Node on port 3000, and make sure the Wi-Fi does not isolate devices (some campus networks do; a phone hotspot works instead).

### Going back to bare React Native

The app uses Expo's continuous native generation, so the native projects can be created at any time:

```bash
cd app
npm run native:prebuild     # creates ios/ and android/ from app.json
npm run native:ios          # build and run with Xcode tools (Mac)
npm run native:android      # build and run with the Android SDK
```

From then on it is a normal React Native project with native folders. To commit those folders and edit them by hand, remove `/ios` and `/android` from `app/.gitignore`.

### Connecting Canvas

When the server has Canvas login settings, the Connect screen has one button. Tap **Log in with Canvas**, log in to Canvas inside Cue, then tap **Authorize**. Cue only reads your courses and deadlines. Tap **Cancel** to go back without connecting.

Without login settings on the server, the Connect screen asks for a token instead.

#### Getting a Canvas token

The Canvas mobile app cannot create tokens, but the Canvas website can, including in a phone's browser. On the Connect screen:

1. Type your school's Canvas address (for example `yourschool.instructure.com`).
2. Tap **Open Canvas to create a token**. Your Canvas settings page opens inside Cue.
3. Log in, tap **+ New Access Token**, copy the token (Canvas shows it only once), then tap **Done**.
4. Paste the token and tap **Connect and sync**.

On a computer the same page is **Account → Settings → Approved Integrations → New Access Token**. You can delete the token in Canvas at any time. Some schools turn off token creation for students; if Canvas shows no **New Access Token** button, use **Skip** and add dates by hand.

## A local Canvas for testing and demos

To test or demo Cue without a school's Canvas, run your own Canvas on a Mac in Docker:

```bash
scripts/local-canvas.sh setup   # first time only; takes an hour or more
scripts/local-canvas.sh start   # whenever you need Canvas
scripts/local-canvas.sh stop
```

**setup** checks for Homebrew, git, Docker Desktop and ngrok, and offers to install anything missing (or tells you how). Canvas needs 8 GB of memory in Docker and about 60 GB of disk. If the Mac is short on space, setup can put Canvas and Docker's disk on an external drive, inside a disk image, which also works on exFAT drives. It then downloads a fixed Canvas version and runs Canvas's own setup, which asks for an email and password for the Canvas admin account.

**start** starts Canvas at <http://canvas.docker> (that Mac only) and asks whether to make it reachable from a phone through ngrok. If you say yes:

- it uses your own free ngrok account and asks for your authtoken the first time;
- it prints your address, like `https://your-name.ngrok-free.dev`, which stays the same every time;
- it sets up Canvas login for Cue: it creates a developer key named Cue in Canvas (once; later starts reuse it) and writes `CUE_CANVAS_URL`, `CUE_CANVAS_CLIENT_ID` and `CUE_CANVAS_CLIENT_SECRET` into `server/.env`. If there is no `server/.env` yet, it copies `server/.env.example`, and it fills in `CUE_SECRET_KEY` if that is empty. Restart Cue's server afterwards so it picks up Canvas login;
- Canvas stays on the internet only while that window is open. Ctrl+C takes it off again; Canvas keeps running on the Mac.

The script writes the `server/.env` of the checkout it runs from, which suits running Cue's server on the same Mac as Canvas. For a Cue server on another computer, copy the three `CUE_CANVAS_*` lines from that file into its `server/.env` by hand; the script never prints them. If setting up login fails, `start` says so and carries on; students can still connect with a token.

A free ngrok account allows one tunnel at a time. While it runs, anyone with the address can reach your Canvas login page, so give the Canvas admin a strong password. The first time a phone opens the address, ngrok shows a warning page; tap **Visit Site**. Inside Cue's private login screen it may appear on each login; tap **Visit Site** there too.

If setup put Canvas on an external drive, Docker keeps its disk there too, inside a disk image that has to be mounted before Docker starts. Turn off **Start Docker Desktop when you sign in** (Docker Desktop → Settings → General), plug the drive in, and use `scripts/local-canvas.sh start`: it mounts the disk image first, then starts Docker. If Docker Desktop did start without it, `start` says so; quit Docker Desktop and run `start` again.

`start` with ngrok writes `docker-compose.cue-ngrok.yml` in the Canvas folder so Canvas accepts the ngrok address. To undo that, delete the file; the next `start` or `stop` tidies Canvas's `.env` to match.

### Demo data

Until there is demo data, `start` offers to add it (`Add demo courses and accounts (about a minute)? [y/N]`). To add it or refresh it later, run `scripts/local-canvas-seed.sh` while Canvas is running. It creates 3 courses (CS 4350 Software Engineering, CS 4513 Database Systems, STAT 3303 Applied Statistics), 3 teachers and 6 students, with assignments (homework, quizzes, midterms, one exam with no date) and calendar events (a final exam, a review session, a demo day) dated around the day it runs.

Every account's password is its first name in lowercase plus `-cue2026` (for example `maya-cue2026`). The logins and passwords are in `local-canvas-accounts.csv` in the project folder, readable only by you and kept out of git. Running the seed again moves the dates to the new day and adds nothing twice. It only changes records it created (their Canvas SIS IDs start with `cue-demo-`), never the admin account or courses you made by hand.

To use it with Cue, log in as one of the demo students. With ngrok and login set up, students tap **Log in with Canvas** on Cue's Connect screen. Without ngrok there is no login: take the three `CUE_CANVAS_*` lines out of `server/.env` so Cue asks for a token, create one under **Account → Settings → New Access Token**, connect with `http://canvas.docker`, and start Cue's server with `CUE_ALLOW_INSECURE_CANVAS=1`; that only works while Cue's server runs on the same Mac. To use your own data instead, skip the demo data and, as the Canvas admin, start a course and create student logins and assignments by hand.

## How the code is organised

The structure follows the P2 design document.

```
server/src/
  api/app.ts                     API layer: routes, validation, errors
  accounts/                      anonymous device accounts
  canvas/CanvasClient.ts         adapter interface (read-only)
  canvas/HttpCanvasClient.ts     real Canvas REST client
  canvas/FakeCanvasClient.ts     in-memory Canvas for tests
  canvas/CanvasLogin.ts          login adapter interface (token requests only)
  canvas/HttpCanvasLogin.ts      real Canvas login requests
  canvas/FakeCanvasLogin.ts      in-memory Canvas login for tests
  canvasReader/                  Canvas Reader: connect, preview, confirm (UC1)
  schedule/                      Schedule Manager: courses, items, study blocks (UC2)
  planner/                       Planner: study times, suggested study blocks
  db.ts                          SQLite schema and migrations
  crypto.ts                      token encryption and hashing

app/src/
  api/                           API client and types
  viewmodels/                    hooks holding screen logic (MVVM)
  viewmodels/useCanvasLogin.ts   screen logic for Log in with Canvas
  screens/                       Connect, CanvasLoginScreen, Review, Week, TimeGrid, BlockSheet, StudyTimes, ItemEditor
  ui/                            shared components and theme
```

Each subsystem reads and writes only its own data through a repository (Repository pattern). Canvas reads go only through the `CanvasClient` interface, and the login's token requests only through `CanvasLogin` (Adapter pattern), so tests use a fake and the access route can change in one place.

## API

All `/api` routes except `POST /api/devices` need `Authorization: Bearer <device token>`.

| Method and path | Purpose |
| --- | --- |
| `POST /api/devices` | Create an anonymous account; returns `deviceToken` |
| `DELETE /api/account` | Delete the account and all its data |
| `GET /api/canvas/connection` | Connection status |
| `PUT /api/canvas/connection` | Save `{ baseUrl, token }` after checking it with Canvas |
| `POST /api/canvas/login` | Start a Canvas login: returns `{ authorizeUrl, state }` |
| `POST /api/canvas/login/finish` | Save `{ code, state }` after Canvas approves; returns the connection status |
| `DELETE /api/canvas/connection` | Forget the Canvas token |
| `POST /api/canvas/sync` | Read Canvas and return items to confirm (stores nothing) |
| `POST /api/canvas/sync/confirm` | Save `{ syncId, accept: [keys], dates?: { key: ISO date } }` |
| `GET /api/courses` · `POST /api/courses` | List or add courses |
| `GET /api/schedule/week?from=<ISO date>&to=<ISO date>` | Items due from `from` up to `to` (or, without `to`, in the `days=<n>` days from `from`, default 7), plus undated items, the study `blocks` in that range (accepted, and proposed ones that have not started; each carries its item's `itemStudyMinutes`) and any `shortfalls` |
| `GET /api/planner/settings` · `PUT /api/planner/settings` | Read or save the time zone, daily limit and study times; a save needs all seven weekdays, each with `enabled`, `start` and `end` |
| `POST /api/blocks/accept` | Accept every proposed block that starts in `{ from, to }` and has not started yet; returns `{ accepted }` |
| `POST /api/blocks/:id/accept` · `POST /api/blocks/:id/reject` | Accept or reject one block (204) |
| `POST /api/blocks/:id/move` | Move a block to `{ startsAt }`; 409 `block_move_invalid` if it does not fit |
| `POST /api/items` · `PATCH /api/items/:id` · `DELETE /api/items/:id` | Add, edit, delete items; items accept `studyMinutes` and `endsAt` (which must be after `dueAt`) |
| `PUT /api/items/:id/status` | Set `not_started`, `in_progress`, `done` or `postponed` |
