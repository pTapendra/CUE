# Cue

Cue is a study app for university students who use Canvas. It plans the work, tells you when to start it, and tests whether you know it.

This repository holds two parts:

| Folder | What it is |
| --- | --- |
| `server/` | Back-end server: Node.js, Express, TypeScript, SQLite |
| `app/` | Mobile app: React Native with Expo, TypeScript (runs in Expo Go; can be turned into a bare React Native project at any time) |

The app talks only to the server. Only the server talks to Canvas, and only with read (GET) requests.

## Sprint 1: what works

- **Retrieve schedule data (UC1).** Connect a Canvas account with a personal access token, read courses, assignment deadlines and calendar events, and review them before anything is saved. Exams are recognised by their titles (exam, midterm, final, test). An exam with no date in Canvas is flagged so the student can type one in.
- **View and edit the schedule (UC2).** A weekly view, Monday to Sunday, with a "Needs a date" list. Students can add items by hand (including exams Canvas does not list), edit them, delete them, and set one of four statuses: Not started, In progress, Done, Postponed.
- **Privacy.** Each installed app gets an anonymous account. No name or email is collected. The Canvas token is encrypted (AES-256-GCM) on the server and never stored on the phone.

Not in sprint 1: study schedule suggestions, start reminders, notes and slides, quizzes, weak topics.

## Run the server

Requires Node.js 22 or later.

```bash
cd server
npm install
cp .env.example .env        # then set CUE_SECRET_KEY (see below)
npm run dev                 # http://localhost:3000
npm test                    # 21 tests, uses a fake Canvas
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
npm test                    # 13 tests
```

4. Scan the QR code: on iPhone with the Camera app, on Android from inside Expo Go. The app opens and reloads when you save a file.

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

### Getting a Canvas token

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
- Canvas stays on the internet only while that window is open. Ctrl+C takes it off again; Canvas keeps running on the Mac.

A free ngrok account allows one tunnel at a time. While it runs, anyone with the address can reach your Canvas login page, so give the Canvas admin a strong password. The first time a phone opens the address, ngrok shows a warning page; tap **Visit Site**.

If setup put Canvas on an external drive, plug the drive in before starting Docker Desktop: Docker keeps its disk there.

To use it with Cue, log in to Canvas, start a course (Dashboard → **Start a New Course**, so you're enrolled), add assignments and calendar events, and create a token under **Account → Settings → New Access Token**. In Cue, connect with the ngrok address. Without ngrok, use `http://canvas.docker` and start Cue's server with `CUE_ALLOW_INSECURE_CANVAS=1`; that only works while Cue's server runs on the same Mac.

## How the code is organised

The structure follows the P2 design document.

```
server/src/
  api/app.ts                     API layer: routes, validation, errors
  accounts/                      anonymous device accounts
  canvas/CanvasClient.ts         adapter interface (read-only)
  canvas/HttpCanvasClient.ts     real Canvas REST client
  canvas/FakeCanvasClient.ts     in-memory Canvas for tests
  canvasReader/                  Canvas Reader: connect, preview, confirm (UC1)
  schedule/                      Schedule Manager: courses, items, weekly view (UC2)
  db.ts                          SQLite schema
  crypto.ts                      token encryption and hashing

app/src/
  api/                           API client and types
  viewmodels/                    hooks holding screen logic (MVVM)
  screens/                       Connect, Review, Week, ItemEditor
  ui/                            shared components and theme
```

Each subsystem reads and writes only its own data through a repository (Repository pattern). Canvas is reached only through the `CanvasClient` interface (Adapter pattern), so tests use a fake and the access route can change in one place.

## API (sprint 1)

All `/api` routes except `POST /api/devices` need `Authorization: Bearer <device token>`.

| Method and path | Purpose |
| --- | --- |
| `POST /api/devices` | Create an anonymous account; returns `deviceToken` |
| `DELETE /api/account` | Delete the account and all its data |
| `GET /api/canvas/connection` | Connection status |
| `PUT /api/canvas/connection` | Save `{ baseUrl, token }` after checking it with Canvas |
| `DELETE /api/canvas/connection` | Forget the Canvas token |
| `POST /api/canvas/sync` | Read Canvas and return items to confirm (stores nothing) |
| `POST /api/canvas/sync/confirm` | Save `{ syncId, accept: [keys], dates?: { key: ISO date } }` |
| `GET /api/courses` · `POST /api/courses` | List or add courses |
| `GET /api/schedule/week?from=<ISO date>` | Items due in the 7 days from `from`, plus undated items |
| `POST /api/items` · `PATCH /api/items/:id` · `DELETE /api/items/:id` | Add, edit, delete items |
| `PUT /api/items/:id/status` | Set `not_started`, `in_progress`, `done` or `postponed` |
