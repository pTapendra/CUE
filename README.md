# Cue

Cue is a study app for university students who use Canvas. It plans the work, tells you when to start it, and tests whether you know it.

This repository holds two parts:

| Folder | What it is |
| --- | --- |
| `server/` | Back-end server: Node.js, Express, TypeScript, SQLite |
| `app/` | Mobile app: React Native (bare CLI), TypeScript |

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

## Run the app

Bare React Native needs the native tool chains on your computer. Follow the official [environment setup](https://reactnative.dev/docs/set-up-your-environment) for Android (Android Studio, JDK 17) and, on a Mac, iOS (Xcode, CocoaPods).

```bash
cd app
npm install
npm start                   # Metro bundler, keep it running
npm run android             # in a second terminal, with an emulator open or a phone plugged in
# iOS, on a Mac:
cd ios && bundle install && bundle exec pod install && cd .. && npm run ios
npm test                    # 10 tests
```

The app looks for the server at `http://10.0.2.2:3000` on the Android emulator and `http://localhost:3000` on the iOS simulator. On a real phone, set your computer's LAN address in `app/src/config.ts`.

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
