# Cue

Cue is a study app for university students who use Canvas. It plans the work, tells students when to start it, and tests whether they know it.

The repository has two parts: `server/` (Node.js, Express, SQLite) and `app/` (React Native with Expo).

## Requirements

- Node.js 22 or later
- **Expo Go** on your phone (App Store or Google Play), on the same Wi-Fi as your computer

## Run the server

```bash
cd server
npm install
cp .env.example .env
npm run dev                 # http://localhost:3000
```

Set `CUE_SECRET_KEY` in `server/.env` to a key made with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Without it, saved Canvas logins stop working when the server restarts.

To turn on **Log in with Canvas**, also set `CUE_CANVAS_URL`, `CUE_CANVAS_CLIENT_ID` and `CUE_CANVAS_CLIENT_SECRET` (all three or none) from a Canvas developer key. Without them, students connect with a Canvas access token instead. For a local Canvas, `scripts/local-canvas.sh start` sets all three for you (see [Local Canvas](#local-canvas-optional)).

## Run the app

With the server running, in a second terminal:

```bash
cd app
npm install
npm start                   # shows a QR code
```

Scan the QR code (iPhone: Camera app; Android: inside Expo Go). The app finds the server on the same computer. To use a server elsewhere, copy `app/.env.example` to `app/.env` and set `EXPO_PUBLIC_SERVER_URL`.

If the phone can't connect, try `npx expo start --tunnel`, and check that your firewall allows Node on port 3000.

## Run the tests

```bash
cd server && npm test
cd ../app && npm test
```

## Local Canvas (optional)

To try Cue without a school's Canvas, run Canvas in Docker on a Mac:

```bash
scripts/local-canvas.sh setup   # first time only; takes an hour or more
scripts/local-canvas.sh start   # offers to add demo courses and accounts
scripts/local-canvas.sh stop
```

Demo logins are written to `seed/local-canvas-accounts.csv`.
