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

In Canvas: **Account → Settings → Approved Integrations → New Access Token**. Paste it into the app with your school's Canvas address (for example `yourschool.instructure.com`). You can delete the token in Canvas at any time.

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
