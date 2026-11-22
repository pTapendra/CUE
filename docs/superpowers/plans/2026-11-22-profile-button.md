# Profile Button and Schedule Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A profile icon that opens Settings on Today, Schedule, Courses and a course's page; Schedule without its locate button, returning to today when its tab is tapped again.

**Architecture:** One kit button (`ProfileButton`) placed in four headers, each navigating to the existing Settings modal. Schedule listens for `tabPress` on its own tab and calls the view model's existing `goToday` when already focused.

**Tech Stack:** Expo SDK 58, React Native, React Navigation 7, jest-expo + react-test-renderer.

**Spec:** `docs/superpowers/specs/2026-11-22-profile-button-design.md`

## Global Constraints

- Icon: Ionicons `person-circle-outline`. Accessibility label: `Settings`.
- The icon is generic: no name, initials or photo.
- The red now line is unchanged; no grid scrolling.
- The app must keep running in Expo Go: no new dependencies.
- Never write "Sprint 1/2" anywhere.

## Review Focus

1. Arriving on Schedule from another tab must keep the page the student left (`tabPress` also fires then): only a tap while Schedule is focused goes to today.
2. Settings opened from a course's page: Done must return to that course's page (Settings uses `goBack`).
3. A course's page while its course is still loading or failed: the header still shows Back and the profile icon.
4. Narrow phones: Schedule's header (month, Sync, profile) and Courses' header must not push the buttons off screen; the title shrinks rather than the buttons.
5. The Today tab button's own label ("Today, tab, 1 of 3" on iOS) must not be mistaken for the removed locate button in tests.

---

### Task 1: Profile button on every page

**Files:**
- Create: `app/src/ui/kit/ProfileButton.tsx`; export from `app/src/ui/kit/index.ts`
- Modify: `app/src/screens/today/TodayScreen.tsx`, `app/src/screens/schedule/ScheduleScreen.tsx`, `app/src/screens/courses/CoursesScreen.tsx`, `app/src/screens/courses/CourseScreen.tsx`
- Test: `app/__tests__/kit.test.tsx`, `app/__tests__/settings.test.tsx`

**Interfaces:**
- Produces: `ProfileButton({ onPress }: { onPress: () => void })`.

- [ ] **Step 1: Write the failing tests**
  - `kit.test.tsx`, `describe('ProfileButton')`, `it('is a Settings button with the person icon')`: render `<ProfileButton onPress={fn} />`; the node with `accessibilityLabel === 'Settings'` and `accessibilityRole === 'button'` contains an `Ionicons` with `name === 'person-circle-outline'`; tapping it calls `fn` once.
  - `settings.test.tsx`, `it.each(['Today', 'Schedule', 'Courses'])('the profile icon on %s opens Settings')`: open the app on that tab (press the tab), the `Settings` control's icon is `person-circle-outline`, tap it → texts contain `Settings` and `Done`; tap `Done` → back on that tab.
  - `settings.test.tsx`, `it('the profile icon on a course page opens Settings, and Done comes back to the course')`: open Courses, press a course, tap `Settings` → Settings shown; tap `Done` → the course's name is shown again.
  - `settings.test.tsx`, `it('a course page that failed to load still has the profile icon')`: make the course detail request fail; the `Settings` control is on screen (Review Focus 3).

- [ ] **Step 2: Run them to see them fail**
  Run: `cd app && npx jest __tests__/kit.test.tsx __tests__/settings.test.tsx`
  Expected: FAIL — `ProfileButton` not exported; no `Settings` control on Schedule, Courses or the course page; Today's icon is `settings-outline`.

- [ ] **Step 3: Implement**
  - `ProfileButton`: `<IconButton icon="person-circle-outline" label="Settings" onPress={onPress} />`.
  - Today: replace the gear `IconButton` with `ProfileButton`.
  - Schedule, Courses: add `ProfileButton` as the last header action, `onPress={() => navigation.navigate('Settings')}`.
  - Course page: add it as the last item of the header row, pushed to the right end (e.g. `marginLeft: 'auto'` on a wrapper), outside the `course ?` condition.
  - Titles in rows with buttons shrink before the buttons do (Review Focus 4).
  - Update the doc comments that mention the gear (`TodayScreen.tsx`, `RootNavigator.tsx`, the `openSettings` comment in `settings.test.tsx`).

- [ ] **Step 4: Run the tests**
  Run: `cd app && npx jest __tests__/kit.test.tsx __tests__/settings.test.tsx`
  Expected: PASS

- [ ] **Step 5: Commit**
  `git add` the files above; `git commit -m "App: a profile icon on every page opens Settings"`

### Task 2: Schedule without the locate button

**Files:**
- Modify: `app/src/screens/schedule/ScheduleScreen.tsx`, `README.md`
- Test: `app/__tests__/schedule.test.tsx`

**Interfaces:**
- Consumes: `useSchedule(...).goToday` (exists).

- [ ] **Step 1: Write the failing tests** in `schedule.test.tsx`
  - Change `it('Day asks for one day, and Today comes back to today')` to `it('Day asks for one day, and tapping the Schedule tab again comes back to today')`: replace `tap(root, 'Today')` with `press(root, 'Schedule')`; same expectations (`lastRange` = `{ from: nov(2), to: nov(3) }`, headers `['Mon 2 Nov, today']`).
  - `it('has no locate button')`: no on-screen node with `accessibilityLabel === 'Today'` and an `onPress` (Review Focus 5: the tab's own label differs).
  - `it('coming back from another tab keeps the page the student left')`: tap `Next days`, press `Today` (the tab, by text), press `Schedule`; `lastRange` is still `{ from: nov(5), to: nov(8) }` (Review Focus 1). This guards the new listener; it may pass before the change.

- [ ] **Step 2: Run them to see them fail**
  Run: `cd app && npx jest __tests__/schedule.test.tsx`
  Expected: FAIL — the renamed test still pages from Thu 6 (no listener); `has no locate button` finds the locate button.

- [ ] **Step 3: Implement**
  - Remove the locate `IconButton`.
  - In `ScheduleScreen`, `useEffect(() => navigation.addListener('tabPress', () => { if (navigation.isFocused()) goToday(); }), [navigation, goToday])`.
  - README: Schedule line — "tapping the Schedule tab again returns to today" replaces "the locate button returns to today"; Today and Settings lines — the profile icon on every page opens Settings (no more gear).

- [ ] **Step 4: Run the whole app suite, typecheck and lint**
  Run: `cd app && npm test && npm run typecheck && npm run lint`
  Expected: all pass; lint shows only the two existing `no-void` warnings in `test-support/fakeServer.ts`.

- [ ] **Step 5: Commit**
  `git commit -m "App: Schedule drops the locate button; tapping its tab again returns to today"`
