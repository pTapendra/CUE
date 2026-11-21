# Skip ngrok's warning page in the login screen: design

## Why

With a free ngrok address, ngrok answers browser requests with a warning page ("Visit Site") until the visitor clicks through, and Cue's private login screen forgets that click after every login. Students see it on every login. Sending the `ngrok-skip-browser-warning` header was tried: the web view sends it only with the page itself, so ngrok answered the stylesheets with its warning page and the login showed unstyled.

## What was checked

Against the team's tunnel, ngrok showed its warning to user agents starting with "Mozilla" (every normal browser's, including Safari's with an app name appended), and served Canvas's login page directly to a user agent starting with `CueApp/0.1`. Canvas served its normal login page to that user agent, with no unsupported-browser notice.

## Goals

- The login screen's web view sends a Cue user agent when the Canvas address is an ngrok address (`*.ngrok-free.dev`, `*.ngrok-free.app`, `*.ngrok.io`), on every request, so the warning never appears and stylesheets load.
- Any other Canvas address keeps the web view's default user agent.

## Non-goals

- A paid ngrok plan, or a different tunnel.
- Remembering cookies in the login screen.

## Approaches

1. **A Cue user agent for ngrok addresses only (chosen).** The web view applies it to every request, so it fixes the page and its stylesheets. Real schools' Canvases and sign-in pages are unaffected.
2. **A paid ngrok plan** removes the warning for everyone, but costs money each month.
3. **A login screen that keeps cookies** shows the warning about once a week, but keeps Canvas logged in inside Cue, undoing the private login screen.

## Design

- `loginUserAgent(authorizeUrl, platform)` in `app/src/viewmodels/canvasLogin.ts` returns the Cue user agent for an ngrok host and `undefined` otherwise.
  - iOS: `CueApp/0.1 (iPhone; CPU iPhone OS like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148`.
  - Android: `CueApp/0.1 (Linux; Android) AppleWebKit/537.36 (KHTML, like Gecko) Mobile`.
  - Neither starts with "Mozilla", and both say "Mobile" so Canvas keeps its phone layout.
- `CanvasLoginScreen` passes it as the `WebView`'s `userAgent`.

## Testing

- Logic tests: an ngrok address gets the user agent (iOS and Android); another host, or a lookalike such as `ngrok-free.dev.evil.test`, gets none.
- App test: with an ngrok login address, the web view's `userAgent` is the Cue one.
- By hand: the login opens straight onto a styled Canvas page.
