# Log in again from the sync screen: design

## Why

When a sync fails because Canvas no longer accepts Cue's access (the student revoked Cue, or renewal was refused) or Canvas isn't connected, the **Check what Cue found** screen shows the message but only offers **Cancel**. Getting connected again takes Cancel → ⚙ → Canvas connection → Log in with Canvas. The way back should be on the screen that shows the problem.

## Goals

- When the sync fails with `canvas_token_rejected` or `canvas_not_connected`, a button appears under the message on that screen.
  - Server has login settings: **Log in with Canvas**. It opens the same Canvas login screen inside Cue. After Authorize, the sync runs again right there, and the items appear in place of the error.
  - Server without login settings: **Connect Canvas**. It opens the Connect screen (the token form), the only way to connect there.
- Login problems (the student tapped Cancel on Authorize, an expired login) show their message on the same screen, as on the Connect screen.

## Non-goals

- A button for other errors (Canvas not responding, an expired sync, no server). Logging in again wouldn't fix them; **Try again** stays for those.
- Changes to the server.

## Approaches

1. **Log in in place, then sync again (chosen).** It's one tap, and the student stays on the screen they were on. It reuses the login view model and screen from the Connect screen.
2. **A button that jumps to the Connect screen.** It's simpler but still takes two taps and a screen change, and the student has to sync again afterwards.

## Design

- `useSyncReview` exposes `needsConnect`: true when the preview failed with one of the two error codes.
- `ReviewScreen` takes `loginAvailable` and `onConnect` from `App` and uses `useCanvasLogin(reload)`. When `needsConnect` is true, it shows the button under the error banner (and the login's own error, if any) and renders `CanvasLoginScreen` while a login is open.
- `App` passes `loginAvailable` (already known from startup) and `onConnect` → the Connect screen.

## Testing

App tests, through the fake server:
- a refused sync shows **Log in with Canvas**; logging in brings up the items with no error;
- in token mode the button reads **Connect Canvas** and opens the token form;
- a "Canvas not responding" failure shows no login button.
