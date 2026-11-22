# Sync without a new page when nothing changed (short design)

Date: 2026-11-22
Status: approved in discussion

## Why

Every Sync button opened "Check what Cue found" at once, and that page read Canvas. A student who syncs and finds nothing new still lands on a new page. Sync should work in place, and open the review only when there is something to review.

## Goals

- While Cue reads Canvas, the header's sync icon spins (still when the phone asks to reduce motion). Screen readers hear "Syncing…"; the line under Today's title says "Syncing…".
- Something new, changed or removed: "Check what Cue found" opens with what was just read. Canvas is not read a second time.
- Nothing to review (skipped items alone don't count): the student stays on the page. The Sync button shows a check mark for 2 seconds (the soft one also says "In sync"); a screen reader hears "In sync with Canvas"; the "synced" time updates. No pop-up (decided: a toast was tried and dropped).
- The header icons and the empty-state buttons work this way, and so does finishing a Canvas login started from them (a first login brings everything in, so the review opens).
- Settings → **Sync now** always opens the review, which reads Canvas itself: it is the way to items skipped before ("Show N skipped").
- The read fails (offline, Canvas wants a new login, …): the review page opens as before; it reads again and explains, with Try again or Log in with Canvas.
- Every page with a Sync button shows Today's status line under its title: "Syncing…", "✓ Canvas synced just now / 12 min ago", or a Connect Canvas link. Schedule: under the month, above the view controls. Courses: instead of "Your courses · synced from Canvas". A course's page has no Sync button and no line.

## Non-goals

- No change to the review page itself, to what Save does, or to the server.
- The soft Sync button in the empty states keeps its spinner and words while busy.

## Approaches

1. **useSync reads the preview itself and hands it to the review page (chosen).** One read; the review page takes the result as a route parameter and skips its own first read.
2. Open the review page invisibly and close it when nothing is listed. Rejected: a page still flashes, and back navigation gets confusing.
3. A separate "is anything new?" request to the server. Rejected: a second read of Canvas per sync, and a server change.

## Design

- `Review` route params become `{ preview?: SyncPreview } | undefined`. `useSyncReview(initial?)` starts from `initial` when given (no first read; Try again still reads).
- A pure `toReview(p)` (new, changed or removed > 0) is shared by `useSync` and `useSyncReview`'s "nothing listed".
- `useSync.sync()`: busy while reading; then review with the preview, or `inSync` for 2 s with an accessibility announcement (and a fresh connection read for the synced time), or, on failure, the review page without a preview. Ignores taps while busy; no state updates after the screen goes away.
- `SyncButton` takes `inSync`: a check mark instead of the sync icon, labelled "In sync".
- `SyncButton` icon variant: while busy, the sync icon rotates (Animated loop, native driver); with reduce motion on, it stays still.

## Left to the builder

- Spin speed (about one turn a second).
