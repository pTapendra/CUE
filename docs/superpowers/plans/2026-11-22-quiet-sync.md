# Quiet Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync reads Canvas in place with a spinning icon, opens the review only when something is new, changed or removed, and otherwise shows "In sync with Canvas".

**Architecture:** `useSync` calls `previewSync` itself and either navigates to `Review` with the result as a route param or shows a toast; `useSyncReview` starts from that param. `SyncButton`'s icon variant rotates while busy.

**Tech Stack:** Expo SDK 58, React Native Animated, React Navigation 7, jest-expo + react-test-renderer.

**Spec:** `docs/superpowers/specs/2026-11-22-quiet-sync-design.md`

## Global Constraints

- Toast text exactly: `In sync with Canvas`; with skipped: `In sync with Canvas · N skipped`, action label `Show`.
- No server change. No new dependencies (Expo Go).
- Never write "Sprint 1/2" anywhere.

## Review Focus

1. A tap while a read is running must not start a second read (button disabled; `sync()` also ignores it).
2. Leaving the screen while reading must not update that screen's state afterwards or crash; the review may still open, since the student asked for the sync.
3. Settings → Sync now with nothing new: stays in Settings with the toast; with something new: opens the review over Settings as before.
4. The review page opened with a preview must not read Canvas again, but Try again on it must.
5. A login finished from a header Sync with nothing new shows the toast instead of an empty review.

---

### Task 1: useSync reads first; the review takes the result

**Files:**
- Modify: `app/src/navigation/types.ts`, `app/src/navigation/RootNavigator.tsx`, `app/src/viewmodels/useSync.ts`, `app/src/viewmodels/useSyncReview.ts`, `app/src/screens/review/ReviewScreen.tsx`, `app/src/screens/settings/SettingsScreen.tsx`
- Test: `app/__tests__/sync.test.tsx`, `app/__tests__/review.test.tsx`, `app/__tests__/settings.test.tsx`

**Interfaces:**
- Produces: `toReview(p: SyncPreview): boolean` in `useSyncReview.ts`; `useSyncReview(initial?: SyncPreview)`; `ReviewScreen` prop `initialPreview?: SyncPreview`; `RootStackParamList['Review']` = `{ preview?: SyncPreview } | undefined`.

- [ ] **Step 1: Write the failing tests**
  - `sync.test.tsx` (wrap `open()` in `ToastProvider`; Review marker shows `preview given`/`preview none` from its params):
    - `it('when Canvas has something new, sync reads it once and opens Review with it')`: one `POST /api/canvas/sync`; `Review screen`, `preview given`.
    - `it('when nothing is new, sync stays and says In sync with Canvas')`: preview with empty newItems/changed/removed → no `Review screen`; toast text `In sync with Canvas`; connection read again.
    - `it('with only skipped items, the toast offers Show, which opens Review with them')`: toast `In sync with Canvas · 2 skipped`; press `Show` → `Review screen`, `preview given`; still one sync call.
    - `it('is busy while it reads, and a second tap does nothing')`: gate the sync request; `busy true`; press `sync` again; release; one sync call; `busy false`.
    - `it('when the read fails, sync opens Review, which explains')`: `syncError` 409 → `Review screen`, `preview none`.
    - Change `'… a finished login opens Review'` to also expect `preview given` and one sync call.
  - `review.test.tsx`:
    - `it('opened with a result, the review does not read Canvas again; Try again does')`: via header Sync → one sync call; make the review show an error on a second read? Simpler: assert one sync call after opening (Review Focus 4).
    - Change `'when nothing is new, says Cue is up to date and Done closes without saving'` to `'when nothing is new, Sync stays on Schedule and says In sync with Canvas'`: no `Check what Cue found`, toast text shown, no confirm call.
    - `'Show 2 skipped …'`: reach the review through the toast's `Show`.
  - `settings.test.tsx`: `it('with nothing new, stays in Settings and says In sync with Canvas')` (Review Focus 3).

- [ ] **Step 2: Run them to see them fail**
  Run: `cd app && npx jest __tests__/sync.test.tsx __tests__/review.test.tsx __tests__/settings.test.tsx`
  Expected: FAIL — sync opens Review at once with no preview; no toast.

- [ ] **Step 3: Implement** per the spec's Design section. `useSync.busy` = login busy or reading. `useCanvasLogin`'s done callback runs the same sync. Settings' Sync now calls `sync.sync` and shows busy.

- [ ] **Step 4: Run the tests** — same command. Expected: PASS.

- [ ] **Step 5: Commit** `App: Sync reads in place and opens the review only when something changed`

### Task 2: The header icon spins while syncing

**Files:**
- Modify: `app/src/ui/kit/SyncButton.tsx`
- Test: `app/__tests__/kit.test.tsx`

- [ ] **Step 1: Write the failing tests** in `kit.test.tsx`:
  - `it('as an icon spins while busy')`: busy icon variant shows the `sync` icon (no ActivityIndicator) inside a node whose flattened style has a `rotate` transform.
  - `it('as an icon stays still while busy when the phone reduces motion')`: mock `AccessibilityInfo.isReduceMotionEnabled` → `true`; busy shows the `sync` icon with no `rotate` transform.

- [ ] **Step 2: Run them to see them fail** — `cd app && npx jest __tests__/kit.test.tsx`. Expected: FAIL (ActivityIndicator, no rotate).

- [ ] **Step 3: Implement**: `Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true }))` while busy and motion allowed; `rotate` interpolated `0deg → 360deg`; stop and reset when not busy.

- [ ] **Step 4: Run the whole app suite, typecheck and lint** — `cd app && npm test && npm run typecheck && npm run lint`. Expected: all pass; only the two existing `no-void` warnings.

- [ ] **Step 5: Commit** `App: the header Sync icon spins while Cue reads Canvas`; README Today line mentions the in-place sync.
