# App Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Cue's app UI as a clean, minimal app in the style of Notion Calendar and Todoist, for the features that exist today.
- **Structure:** tabs for Today, Schedule and Courses; a small design system with contrast-checked colours; native date pickers.
- **Sync:** always obvious.
- **Also:** a first-launch Welcome screen, Settings with Disconnect and Delete, and one read-only server endpoint for the overview screens.

**Architecture:** React Navigation provides the shell: a root native stack containing Welcome, the tabs (bottom tabs), the pushed screens, and the full-screen modals.
- **Tokens and shared components** live in `app/src/ui/`; screens are assembled from them.
- **Sheets** for an item and a study block stay as React Native `Modal` components owned by the screen that opens them (page sheet on iOS). This keeps today's tested behaviour, such as an open block sheet following its block across re-plans.
- **Data:** Today, Courses and a course read `GET /api/schedule/overview`. Schedule keeps the week endpoint. Screens reload when focused and after their own changes.

**Tech Stack:** Expo SDK 58 (Expo Go), React Native 0.88, React 19.3; `@react-navigation/native`, `@react-navigation/bottom-tabs`, `@react-navigation/native-stack` and `react-native-screens`; `@expo/vector-icons` (Ionicons); `@react-native-community/datetimepicker`; jest-expo with react-test-renderer. Server: Node 22, Express 5, vitest.

**Spec:** `docs/superpowers/specs/2026-11-21-app-redesign-design.md`

## Global Constraints

**Expo Go:**
- Only libraries that Expo Go SDK 58 includes, added with `npx expo install`.
- No custom fonts: use the system font.

**Colour tokens, light** (exact values; dark mode uses the same names, with the builder's values under the same contrast rules):
- `text` #1D1D1F, `text2` #5B5B63, `text3` #6E6E77, `line` #E6E6EA;
- `bg` #FFFFFF, `bg2` #F5F5F7;
- `accent` #4338CA, `onAccent` #FFFFFF, `accentTint` #EEF0FF;
- `exam` #B42340, `examTint` #FDECEF;
- `ok` #1E7A43, `okTint` #E6F4EC, `warn` #A15C00, `danger` #C0262D, `dangerTint` #FDECEA;
- `now` #E5484D.

**Course palette** (light, as `{ mark, tint, text }`):
- violet: `#6D5BD0`, `#EFEDFC`, `#4B3DB8`;
- teal: `#0F9F84`, `#E2F4EF`, `#0A6B59`;
- amber: `#C47A0A`, `#FCF0DC`, `#8A5300`;
- plus 3 more of the builder's choosing.
- For an unknown course, a neutral grey: mark `#8E8E96`, tint `#F0F0F3`, text `#5B5B63`.

**Contrast:** every text colour on its background must be at least 4.5:1, and course marks against `bg` at least 3:1. This holds in light and dark, and a test enforces it.

**Sizes:** touch targets of at least 44 pt. Text scales with the phone's text size setting: no fixed heights around text.

**Icons (Ionicons):**
- tabs: `today-outline`, `calendar-outline`, `library-outline`;
- sync: `sync`; settings: `settings-outline`; add: `add`; jump to today: `locate-outline`; back: the platform default.

**No typed dates or times anywhere.** Every date or time uses `DateTimeField`, which opens `@react-native-community/datetimepicker`.

**Every behaviour the current tests check must still be tested after the task that replaces its screen.** The current test files are `app/__tests__/App.test.tsx`, `planner.test.tsx` and `logic.test.ts`. Behaviours may move to new files and labels, but none is deleted.

**Exact copy that tests check:**

| Where | Text |
| --- | --- |
| Welcome | `Know what to study, and when.`, `Log in with Canvas` (or `Connect Canvas` in token mode), `Skip for now · add dates by hand` |
| Today | title `Today`; sync button `Sync` (`Syncing…` while busy); `Canvas synced {relative}` (e.g. `just now`, `12 min ago`); `Up next`; `Start`; `Move`; `Due soon`; `No date`; `Add date`; `Marked done`; `Undo` |
| Schedule | segments `Day`, `3 days`, `Week`; `Accept all` |
| Settings | `Settings`, `Done`, `Sync now`, `Disconnect Canvas`, `Delete all my data`, `Study times`, `What Cue keeps` |
| Alerts | `Disconnect Canvas?`, `Delete all your data?` |
| Review | `Check what Cue found`, `Save {n} items` (`Save 1 item`) |

**Never write the banned iteration label.** No server changes beyond Task 1.

## Review Focus

1. **The next accepted study block is more than 7 days away.**
   - Expected: Up next still shows it, because the overview covers 200 days.
   - Test: Task 8, `pickUpNext` with a block 12 days out.
2. **Done, then Undo, on an item that was In progress.**
   - Expected: Undo restores In progress, not Not started.
   - Test: Task 8.
3. **Day boundaries.** An item due at 23:59 tomorrow, a week strip at the end of a week, and a run at 23:30.
   - Expected: windows and the day strip use the phone's local days.
   - Tests: Task 8, with fixed clocks.
4. **Delete all my data fails** (no server).
   - Expected: an error, the student stays signed in, and the device token is kept.
   - Test: Task 10.
5. **Sync or Sync now while Canvas isn't connected.**
   - Expected: the button reads `Connect Canvas` and opens the login (or the token form), not a failing sync.
   - Test: Task 8 (Today) and Task 10 (Settings).

---

### Task 1: Overview endpoint and the API calls the redesign needs

**Files:**
- Modify: `server/src/schedule/ScheduleService.ts`, `server/src/api/app.ts`
- Test: `server/test/overview.test.ts`
- Modify: `app/src/api/types.ts`, `app/src/api/client.ts`, `app/test-support/fakeServer.ts`
- Test: `app/__tests__/logic.test.ts` (client calls)
- Modify: `README.md` (API table)

**Interfaces:**
- Server: `ScheduleService.getOverview(studentId: string, now: Date): { items: ItemView[]; undated: ItemView[]; blocks: BlockView[] }`.
  - `items`: due from `now − 30 days` to `now + 200 days`.
  - `undated`: every undated item.
  - `blocks`: proposed and accepted blocks overlapping `[now, now + 200 days]`.
  - Reuse `itemsDueBetween`, `undatedItems`, `blocksBetween` and `present`.
- Route `GET /api/schedule/overview` calls `planner.replanIfNewDay`, then returns `{ ...getOverview(sid, now), shortfalls: planner.shortfalls(sid) }`. It changes no data.
- App: `export interface Overview { items: Item[]; undated: Item[]; blocks: StudyBlock[]; shortfalls: Shortfall[] }`.
- App client calls:
  - `ApiClient.getOverview(): Promise<Overview>`;
  - `ApiClient.deleteAccount(): Promise<void>` (`DELETE /api/account`, and only after success removes the stored device token, so the next `ensureAccount()` creates a new account);
  - `ApiClient.forgetDevice(): Promise<void>` (removes the stored device token).
- fakeServer: `GET /api/schedule/overview` returns its items, undated, blocks and shortfalls. `DELETE /api/account` returns 204, and resets `connected` and items when `state.deleteFails` is false; when it's true, it returns `500`.

- [ ] **Step 1: Write the failing tests**:
  - server `overview.test.ts`: `"returns items 30 days back to 200 days ahead, all undated items, and blocks that haven't ended"` (seed items at −40, −20, +150 and +210 days, plus undated; blocks in the past and the future); `"only the student's own data"`; `"changes nothing"` (row counts before and after).
  - app `logic.test.ts`: `"getOverview calls GET /api/schedule/overview"`; `"deleteAccount forgets the device token only after the server agrees"` (a failing `fetchImpl` keeps the token in the memory store).
- [ ] **Step 2: Run to see them fail.** `cd server && npx vitest run test/overview.test.ts`; `cd app && npx jest __tests__/logic.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cd server && npm test && npm run typecheck`, then `cd app && npm test && npm run typecheck`. All pass.
- [ ] **Step 5: Commit** `"Add the schedule overview endpoint and the app calls the redesign needs"`.

### Task 2: Design tokens, course colours, contrast test, libraries

**Files:**
- Modify: `app/package.json` and `package-lock.json` (with `npx expo install @react-navigation/native @react-navigation/bottom-tabs @react-navigation/native-stack react-native-screens @react-native-community/datetimepicker`)
- Create: `app/src/ui/tokens.ts`, `app/src/ui/contrast.ts`, `app/src/ui/courseColors.ts`, `app/src/prefs.ts`
- Modify: `app/jest.setup.js` (mocks: `@react-native-community/datetimepicker`, as a `DateTimePicker` host element passing its props through; anything React Navigation needs under jest)
- Test: `app/__tests__/design.test.ts`

**Interfaces:**
- `tokens.ts` exports:
  - `type Colors = { text; text2; text3; line; bg; bg2; accent; onAccent; accentTint; exam; examTint; ok; okTint; warn; danger; dangerTint; now: string }`;
  - `lightColors: Colors`, `darkColors: Colors`;
  - `type CourseColor = { mark: string; tint: string; text: string }`, `lightCourses: CourseColor[]` and `darkCourses: CourseColor[]` (6 each), `lightUnknown` and `darkUnknown: CourseColor`;
  - `space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }`, `radius = { sm: 8, md: 10, lg: 14, pill: 999 }`;
  - `type` styles `largeTitle` (26/700), `title` (20/700), `section` (12/700), `body` (14/500), `bodyStrong` (14/600), `meta` (11.5/400);
  - `useTokens(): { colors: Colors; courses: CourseColor[]; unknown: CourseColor; dark: boolean }`.
- The existing `ui/theme.ts` `useTheme()` stays until Task 11, so unconverted screens keep compiling.
- `contrast.ts`: `contrastRatio(foreground: string, background: string): number` (WCAG 2.1).
- `courseColors.ts`: `courseColorFor(courseName: string | null, courses: Course[], palette: CourseColor[], unknown: CourseColor): CourseColor`. It returns the colour at the course's index in `courses` (in the order given), wrapping after the palette's length, and `unknown` when the name matches no course.
- `prefs.ts`: `getSkippedCanvas(store): Promise<boolean>`, `setSkippedCanvas(store, value: boolean): Promise<void>` (key `cue.skippedCanvas`; `store` is the same `TokenStore` shape as `ApiClient`'s).

- [ ] **Step 1: Write the failing tests** in `design.test.ts`:
  - `"every text colour passes 4.5:1 on its background, light and dark"`. Pairs to check:
    - `text`, `text2`, `text3`, `accent` on `bg` and on `bg2`;
    - `onAccent` on `accent`; `accent` on `accentTint`; `exam` on `examTint`;
    - `ok`, `warn`, `danger` on `bg`; `danger` on `dangerTint`;
    - each course `text` on its `tint`, and the unknown course's text on its tint.
  - `"course marks pass 3:1 on bg"`.
  - `"contrastRatio matches known values"`: black on white is 21; `#8A8A8E` on white is 3.44 (to 2 decimals).
  - `"courseColorFor"`: by index, wrapping after 6, unknown name → `unknown`, null → `unknown`.
  - `"skipped Canvas is remembered"`: the round trip through a memory store.
- [ ] **Step 2: Run to see them fail.** `cd app && npx jest __tests__/design.test.ts`.
- [ ] **Step 3: Install the libraries, then implement.** Choose the 3 extra course colours and all dark values so the tests pass.
- [ ] **Step 4: Run** `cd app && npm test && npm run typecheck && npm run lint`. All pass, with no lint errors.
- [ ] **Step 5: Commit** `"App: design tokens, course colours and a contrast test"`.

### Task 3: Shared components

**Files:**
- Create: `app/src/ui/kit/` with one file per component, and `app/src/ui/kit/index.ts`
- Test: `app/__tests__/kit.test.tsx`

**Interfaces** (all use `useTokens()`, have at least 44 pt touch targets, and set accessibility roles):
- `Button({ title, onPress, variant?: 'primary'|'secondary'|'danger'|'plain', busy?, disabled?, icon? })`;
- `IconButton({ icon: IoniconName, label: string, onPress, tone?: 'plain'|'soft' })`;
- `SyncButton({ busy: boolean, connected: boolean, onSync, onConnect, variant?: 'filled'|'soft' })`, which shows `Sync`, `Syncing…` while busy, or `Connect Canvas` when not connected (calling `onConnect`);
- `ListRow({ title, meta?, onPress?, leading?: ReactNode, trailing?: ReactNode, tag?: ReactNode, dimmed? })`;
- `CheckCircle({ checked, exam?: boolean, onPress, label })`;
- `Card({ children, tint?: string, onPress? })`, `Tag({ label, tone: 'exam'|'ok'|'warn' })`, `CourseDot({ color: CourseColor, size? })`;
- `SectionHeader({ title, actionLabel?, onAction? })`;
- `SegmentedControl<T extends string>({ options: { value: T; label: string }[], value: T, onChange })`;
- `DayStrip({ weekOf: Date, today: Date, marks: Record<string /*YYYY-MM-DD*/, string /*colour*/>, onDay(day: Date) })`, Monday first;
- `Stepper({ value: string, onMinus, onPlus, minusDisabled?, plusDisabled?, label })`;
- `DateTimeField({ label, value: string | null /*ISO*/, mode: 'datetime'|'date'|'time', onChange(iso: string | null), allowClear?: boolean, clearLabel?: string })`. It shows the value formatted with `dayLabel`/`timeLabel` (or `clearLabel`, default `No date`). Pressing opens the picker; on iOS a modal with Done, on Android the dialog (date, then time for `datetime`).
- `ToastProvider` and `useToast(): { show(message: string, action?: { label: string; onPress(): void }): void }`. A toast shows for 4 s; a new one replaces the old.
- `EmptyState({ icon, title, message?, action? })`;
- `ErrorBanner({ message, onRetry? })`, which shows `Try again` when `onRetry` is given.

- [ ] **Step 1: Write the failing tests** in `kit.test.tsx` (react-test-renderer):
  - SyncButton's three states and which callback each calls;
  - SegmentedControl calls `onChange` with the option's value;
  - DayStrip shows 7 days starting Monday, marks today, shows a dot only on marked days, and `onDay` gets the right date;
  - Stepper's disabled ends;
  - DateTimeField: pressing renders `DateTimePicker`, its `onChange({ type: 'set' }, date)` gives an ISO string, and clear gives null when `allowClear`;
  - Toast: `show` renders the message and action, and the action runs and hides it;
  - ErrorBanner shows `Try again` only with `onRetry`.
- [ ] **Step 2: Run to see them fail.** `cd app && npx jest __tests__/kit.test.tsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cd app && npm test && npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** `"App: shared components for the redesign"`.

### Task 4: Navigation shell, Welcome, start-up, Canvas login and token screens

**Files:**
- Create: `app/src/navigation/RootNavigator.tsx` (and `types.ts`), `app/src/screens/welcome/WelcomeScreen.tsx`, `app/src/screens/connect/TokenConnectScreen.tsx`
- Modify: `app/App.tsx`, `app/src/screens/CanvasLoginScreen.tsx`
- Test: `app/__tests__/App.test.tsx` (moved and updated)

**Interfaces:**
- `RootStackParamList` has:
  - `Welcome: undefined`;
  - `Tabs: NavigatorScreenParams<TabParamList>`;
  - `Course: { courseId: string }`;
  - `Settings: undefined` (modal);
  - `StudyTimes: undefined`;
  - `WhatCueKeeps: undefined`;
  - `Review: undefined` (modal);
  - `TokenConnect: undefined` (modal).
- `TabParamList`: `Today: undefined`, `Schedule: { date?: string; view?: 'day'|'3days'|'week' } | undefined`, `Courses: undefined`.
- **Start-up** (in `App`): `ensureAccount`, `syncTimeZone` (not awaited, as today), `getConnection`, and the skipped flag. While loading, a spinner; on failure, the existing message and `Try again`. Then the initial route is `Welcome` when not connected and not skipped, otherwise `Tabs`.
- `App` keeps its `client` prop, and the `ToastProvider` wraps everything.
- **Welcome** copy as in Global Constraints:
  - **Log in with Canvas** uses `useCanvasLogin`; on success, it goes to `Review`, and saving there lands on Today.
  - In token mode, **Connect Canvas** goes to `TokenConnect`.
  - **Skip** sets the skipped flag, then resets to `Tabs`.
- **Canvas login sheet:** add the host strip (a lock icon and `new URL(authorizeUrl).host`) under the header, and restyle with tokens. All of today's web view behaviour stays.
- **TokenConnect:** today's token form (`useConnectCanvas`), restyled. On success it goes to `Review`.
- **Temporary placeholders, until their tasks:**
  - the Today and Courses tabs render a short placeholder (replaced in Tasks 8 and 9);
  - the Schedule tab renders the existing `WeekScreen`;
  - the Settings and Review routes render the existing `SettingsMenu`/`StudyTimesScreen` and `ReviewScreen`, wired to navigation.

- [ ] **Step 1: Update and add the tests** in `App.test.tsx` for the new start-up and Welcome:
  - first launch shows Welcome with the three copy strings;
  - **Skip** shows the tabs (`Today`, `Schedule` and `Courses` tab labels), and a restart with the same store skips Welcome;
  - a connected start goes straight to the tabs;
  - token mode shows **Connect Canvas** → the token form → `Review`;
  - the login sheet shows the host strip;
  - **all existing login tests** move here unchanged in substance: the spinner, the user agent, finishing once, `onNavigationStateChange` alone, denying, Cancel, Cancel disabled while finishing, the token-page `openBrowserAsync`, and starting without waiting for the time zone.
- [ ] **Step 2: Run to see the new ones fail.** `cd app && npx jest __tests__/App.test.tsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cd app && npm test && npm run typecheck && npm run lint`. All tests, old and new, pass.
- [ ] **Step 5: Commit** `"App: navigation shell, Welcome and first launch"`.

### Task 5: Check what Cue found

**Files:**
- Create: `app/src/screens/review/ReviewScreen.tsx` (it replaces `app/src/screens/ReviewScreen.tsx`; delete the old one)
- Modify: `app/src/viewmodels/useSyncReview.ts` (if needed: `groups` and `savedCount`)
- Test: `app/__tests__/review.test.tsx`

**Interfaces:**
- `groupByCourse(items: ProposedItem[]): { courseName: string; items: ProposedItem[] }[]`, in first-seen order. It's pure, in `useSyncReview.ts` or `viewmodels/review.ts`.
- The screen shows:
  - the title and `"{n} items from {m} courses. Untick anything you don't want."`;
  - a header per group with a `CourseDot` and the name in uppercase;
  - each item with a square check, its title, the Exam tag and its date;
  - for `needsDate`: `Canvas has no date for this exam`, a `DateTimeField` (`clearLabel` `Add date`), and `or add it later`;
  - a sticky bar with `Cancel` and `Save {n} items`.
- **Saving:** `confirm()` with the picked ISO dates, then navigate to `Tabs/Today`, then `toast.show("{n} items saved from Canvas")`.
- It keeps the refused-sync behaviour: the `Log in with Canvas` or `Connect Canvas` button, from the earlier change.

- [ ] **Step 1: Write the failing tests:**
  - grouping;
  - the count in the button follows the ticks;
  - an exam's date picked through `DateTimePicker`'s `onChange` is sent;
  - saving navigates to Today and shows the toast.
  - **Move here:** the existing App tests for confirming items and a missing exam date, and the "logging in again from the sync screen" tests.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cd app && npm test && npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** `"App: Check what Cue found, redesigned"`.

### Task 6: Item sheet and study block sheet

**Files:**
- Create: `app/src/screens/sheets/ItemSheet.tsx` and `app/src/screens/sheets/BlockSheet.tsx` (they replace `app/src/screens/ItemEditor.tsx` and `app/src/screens/BlockSheet.tsx`; delete those)
- Create: `app/src/viewmodels/useItemActions.ts`
- Modify: `app/src/screens/WeekScreen.tsx` (use the new sheets until Task 7)
- Test: `app/__tests__/sheets.test.tsx` (moved from `planner.test.tsx`: block sheet and item editor)

**Interfaces:**
- `ItemSheet({ visible, item: Item | null, courses: Course[], onSave(input: ItemInput): Promise<boolean>, onStatus(s: ItemStatus): Promise<boolean>, onDelete(): Promise<boolean>, onClose })`. It's a page-sheet `Modal`.
  - Fields: title; type `SegmentedControl` (`Assignment`, `Exam`, `Event`); course (chips or a list, `None` first); due `DateTimeField` with `allowClear` (`No date`); for events, an `Ends` `DateTimeField`; study time `Stepper` for assignments and exams; status `SegmentedControl` (the `STATUSES` labels); `Save`; and `Delete` (confirmed with an alert) for existing items.
  - The validation and study-minutes rules are today's.
- `BlockSheet({ block, studyHours, error, onAccept, onReject, onMove(startsAtIso: string): Promise<boolean>, onStudyHours, onClose })`. `onMove` now takes an ISO time from a `DateTimeField` (mode `datetime`) instead of typed text.
  - Shows: the title, course, day and time, `Suggested`/`Accepted`, and the clash warning.
  - Buttons: `Accept` (when suggested), `Move`, `Not this time`, and a study hours `Stepper`.
- `useItemActions(reload: () => Promise<void>)` returns:
  - `saveItem(id: string | null, input: ItemInput)`, `setStatus(id, status)`, `deleteItem(id)`;
  - `acceptBlock(id)`, `rejectBlock(id)`, `moveBlock(id, iso)`, `setStudyHours(itemId, hours)`.
  - Each returns `Promise<boolean>`, sets an error message on failure, and calls `reload` on success.
  - **Use it** from WeekScreen now, and from Today, Schedule and a course later.
- `useWeek.moveBlock` takes an ISO string (update the caller and its tests).

- [ ] **Step 1: Move and update the tests** for the block sheet and the item editor from `planner.test.tsx` into `sheets.test.tsx`:
  - accept; reject; move (now through `DateTimePicker` `onChange`, asserting the ISO sent);
  - study hours stepping across a re-plan, and following the re-planned block;
  - block already gone;
  - editing an exam's study time; the default after switching type; an event end that isn't after its start; adding an event with an end.
- **Add:**
  - deleting an item asks first;
  - clearing the due date with `No date` sends null.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cd app && npm test && npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** `"App: item and study block sheets with date pickers"`.

### Task 7: Schedule

**Files:**
- Create: `app/src/screens/schedule/ScheduleScreen.tsx`, `app/src/viewmodels/useSchedule.ts` (they replace `WeekScreen.tsx` and `useWeek.ts`; delete those, and `SettingsMenu.tsx` if nothing uses it any more)
- Modify: `app/src/screens/TimeGrid.tsx` (any number of days; tokens; course colours; dashed suggestions; the deadline lane; the `now` line)
- Test: `app/__tests__/schedule.test.tsx` (moved from `planner.test.tsx`: grid, accept all, time zone)

**Interfaces:**
- `useSchedule({ view: 'day'|'3days'|'week', date: Date })` covers what `useWeek` does with `days = 1 | 3 | 7`.
  - Paging moves by `days`. In `week` view, a page starts on Monday.
  - `acceptVisible` covers the visible days.
- `ScheduleScreen` shows:
  - the month as title; a soft `SyncButton`; an `IconButton` `locate-outline` (label `Today`);
  - a `SegmentedControl` of `Day`/`3 days`/`Week`;
  - previous and next (chevron buttons, labels `Previous days` and `Next days`, as today);
  - when there are suggestions: `"{n} suggested blocks"` and `Accept all`;
  - the shortfall warnings; the grid; the + button (accent, label `Add`); and the sheets through `useItemActions`.
- Route params `{ date, view }` set the visible page, which is how Today opens a day.

- [ ] **Step 1: Move and update the tests:**
  - suggested blocks and shortfalls; the requested range (now per view: 1, 3 or 7 days, up to midnight after the last); accept all on screen; the time zone sent on return to the app, then a reload.
  - **Add:** switching to `Week` asks for 7 days from Monday; route params open `Day` on a given date.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** Wire `Schedule` into the tab bar in place of WeekScreen.
- [ ] **Step 4: Run** `cd app && npm test && npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** `"App: Schedule with day, 3-day and week views"`.

### Task 8: Today

**Files:**
- Create: `app/src/viewmodels/today.ts` (pure), `app/src/viewmodels/useToday.ts`, `app/src/screens/today/TodayScreen.tsx`
- Create: `app/src/viewmodels/useSync.ts` (shared by Today, Schedule, Courses and Settings)
- Test: `app/__tests__/today.test.ts` (pure) and `app/__tests__/todayScreen.test.tsx`

**Interfaces** (`today.ts`):
- `pickUpNext(blocks: StudyBlock[], items: Item[], now: Date): { kind: 'block'; block: StudyBlock } | { kind: 'suggested'; count: number; first: StudyBlock } | { kind: 'plan' } | null`. In order:
  - the first accepted block with `endsAt > now`, by `startsAt`;
  - else, if proposed blocks exist, `suggested`;
  - else, if any non-done assignment or exam is due within 30 days, `plan`;
  - else `null`.
- `dueSoon(items: Item[], now: Date): Item[]`: due in `[now, now + 7 days)`, status not `done`, by `dueAt`.
- `noDate(undated: Item[]): Item[]`: not `done`, exams first, then by title.
- `weekMarks(items: Item[], blocks: StudyBlock[], weekOf: Date, colorFor: (courseName: string | null) => string): Record<string, string>`.
- `syncedLabel(lastSyncedAt: string | null, now: Date): string`: `just now` (under 1 minute), `{n} min ago`, `{n} h ago`, else `on {dayLabel}`.

**Interfaces** (`useSync()`):
- Returns `{ connected, loginAvailable, lastSyncedAt, busy, sync(): void, connect(): void }`.
- `sync` navigates to `Review`. `connect` starts the Canvas login (when `loginAvailable`) or goes to `TokenConnect`.
- It reads `getConnection()` on focus.

**TodayScreen** (layout per the spec):
- **Header:** title `Today`; filled `SyncButton`; `IconButton` `settings-outline` (label `Settings`) → `Settings`.
- **Under the title:** the date, and `Canvas synced {syncedLabel}` or a `Connect Canvas` link.
- **Pull to refresh:** syncs when connected, otherwise reloads.
- **`DayStrip`:** `onDay` → `navigate('Tabs', { screen: 'Schedule', params: { date, view: 'day' } })`.
- **Up next card**, by kind:
  - `block`: `Up next · HH:MM`, `Study for {itemTitle}`, course · length · due, `Start` → `setStatus(itemId, 'in_progress')`, `Move` → BlockSheet in move mode;
  - `suggested`: `"{n} suggested study blocks"` and `Review` → Schedule on the first block's day;
  - `plan`: `Plan your studying` and `Set study times` → `StudyTimes`.
- **Shortfalls**, then `Due soon` (rows with a `CheckCircle`), then `No date`.
- **Ticking a row:** `setStatus(id, 'done')`, then `toast.show('Marked done', { label: 'Undo', onPress: () => setStatus(id, previousStatus) })`.
- **Tapping a row** opens the ItemSheet. The + button opens ItemSheet in add mode.
- **States:** loading, error (`ErrorBanner` with `Try again`), and empty (`Nothing due this week`).

- [ ] **Step 1: Write the failing tests:**
  - `today.test.ts`:
    - `pickUpNext` for each branch, including a block 12 days out (Review Focus 1) and a past accepted block skipped;
    - `dueSoon`'s window edges and that done items are excluded, with fixed clocks at 23:30 (Review Focus 3);
    - `noDate` order;
    - `weekMarks` from Monday to Sunday;
    - `syncedLabel`.
  - `todayScreen.test.tsx`:
    - Up next `Start` sends `in_progress`; `Move` opens the sheet's picker and sends the ISO;
    - ticking shows `Marked done`, and `Undo` restores the previous status, including `in_progress` (Review Focus 2);
    - `Sync` navigates to Review; when not connected the button reads `Connect Canvas` and starts the login (Review Focus 5);
    - a day in the strip opens Schedule in Day view;
    - a No date row's `Add date` opens the sheet;
    - the empty state.
  - **Move** the existing App test "lets a student skip Canvas and add an exam by hand" to the new flow: Welcome → Skip → Today → + → ItemSheet.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** Put Today in its tab, and remove the placeholder.
- [ ] **Step 4: Run** `cd app && npm test && npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** `"App: Today with Up next, due soon and a clear Sync"`.

### Task 9: Courses and a course

**Files:**
- Create: `app/src/viewmodels/courses.ts` (pure), `app/src/viewmodels/useOverview.ts`, `app/src/screens/courses/CoursesScreen.tsx`, `app/src/screens/courses/CourseScreen.tsx`
- Test: `app/__tests__/courses.test.ts` and `app/__tests__/coursesScreen.test.tsx`

**Interfaces** (`courses.ts`):
- `courseSummaries(courses: Course[], overview: Overview, now: Date): { course: Course; next: Item | null; exams: ExamPlan[]; undatedExams: Item[] }[]`, in the order of `courses`.
- `type ExamPlan = { exam: Item; accepted: number; suggested: number; total: number; firstBlockStart: string | null }`, for upcoming, non-done exams, matched by `block.itemId`.
- `courseDetail(course: Course, overview: Overview, now: Date): { upcomingExams: ExamPlan[]; pastExams: Item[]; work: Item[] }`.
  - `work` is assignments and events, dated by `dueAt` with undated last.
  - Items are matched by `courseId`.
- `useOverview()`: `getOverview()` and `listCourses()` on focus. Returns `{ overview, courses, loading, error, reload }`.

**Screens:**
- **Courses:**
  - the title `Courses` and the subtitle `Your courses · synced from Canvas`; a soft `SyncButton`;
  - a card per course: a `CourseDot`, the code, the name, `Next: {title} · {day}`, `{exam} {date} · study plan {accepted} of {total} blocks` with a progress bar in the course mark colour, and the tag `{exam} needs a date`;
  - the empty state `No courses yet`, with Sync or Connect Canvas;
  - tapping a card → `Course`.
- **Course:**
  - back, the dot, code and name;
  - a `SegmentedControl` of `Exams`/`Work`;
  - **exam cards:** the date or `Add date` (opens the ItemSheet), a progress bar, `{accepted} accepted · {suggested} suggested`, and `View in Schedule` → `Tabs/Schedule` with `{ date: firstBlockStart ?? exam.dueAt, view: 'day' }`;
  - past exams dimmed; Work rows with a status `CheckCircle`; the sheets through `useItemActions`.

- [ ] **Step 1: Write the failing tests:**
  - `courseSummaries`: next item, exam counts, undated exams, and course order;
  - `courseDetail`: the upcoming/past split and the order of work;
  - screen tests: cards show the plan line; tapping opens the course; `View in Schedule` navigates with the right params; `Add date` opens the sheet; the empty state.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** Put Courses in its tab, and remove the placeholder.
- [ ] **Step 4: Run** `cd app && npm test && npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** `"App: Courses and a course's exams and work"`.

### Task 10: Settings, Study times, What Cue keeps

**Files:**
- Create: `app/src/screens/settings/SettingsScreen.tsx`, `app/src/screens/settings/StudyTimesScreen.tsx` (it replaces `app/src/screens/StudyTimesScreen.tsx`; delete the old one), `app/src/screens/settings/WhatCueKeepsScreen.tsx`
- Modify: `app/src/viewmodels/useStudyTimes.ts` (if needed: a summary)
- Test: `app/__tests__/settings.test.tsx` (moved from `planner.test.tsx`: study times)

**Interfaces:**
- `studyTimesSummary(windows: StudyWindow[]): string`. For example `Weekdays 18–22`, `Every day 10–16`, or `5 days` when the days differ. Pure, with tests.
- **Settings** (the modal: header `Settings` with `Done`; grouped lists on `bg2`):
  - **Canvas, connected:** the Canvas row, `Connected`, `Synced {syncedLabel} · read-only`, `Sync now`, `Disconnect Canvas`. Disconnecting shows an alert (`Disconnect Canvas?`, a message saying the schedule and study plans stay, and buttons `Disconnect` and `Cancel`), then calls `disconnectCanvas`, then shows `Not connected` with `Log in with Canvas` or `Connect Canvas`.
  - **Study plan:** `Study times` (value `studyTimesSummary`) and `Daily limit` (value `{n} hours`), both → `StudyTimes`.
  - **Privacy:** `What Cue keeps` → `WhatCueKeeps`. `Delete all my data` shows an alert (`Delete all your data?`, a can't-be-undone message, `Delete everything` and `Cancel`), then calls `deleteAccount()`, clears the skipped flag, and resets the root to `Welcome`. On failure it shows an error and changes nothing (Review Focus 4).
  - **About:** the version from `expo-constants`.
- **StudyTimes:** a row per day with start and end chips, each a `DateTimeField` in mode `time` (stored as `HH:MM`), a switch, and the daily limit `Stepper`. `Save` uses today's rules and validation, then goes back.
- **WhatCueKeeps:** static text. No name or email; the Canvas access is encrypted on Cue's server, not the phone; Cue only reads Canvas; Delete all my data removes everything.

- [ ] **Step 1: Write the failing tests:**
  - **Moved:** study times saving with the phone's time zone; switching Friday off and saving (now through the switch).
  - **Add:**
    - `studyTimesSummary`;
    - Disconnect's confirm, then the call, then `Not connected` (drive the alert by mocking `Alert.alert` and calling the destructive button's `onPress`);
    - Delete success → Welcome, with the token and skipped flag cleared;
    - Delete failure → an error, with the token kept;
    - `Sync now` when not connected reads `Log in with Canvas`;
    - a start time picked through `DateTimePicker` is saved as `HH:MM`.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** Wire the Settings, StudyTimes and WhatCueKeeps routes, and remove the temporary SettingsMenu wiring.
- [ ] **Step 4: Run** `cd app && npm test && npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** `"App: Settings with disconnect, delete and study times"`.

### Task 11: Remove the old UI, finish dark mode, README

**Files:**
- Delete: any old screens or components still present (`app/src/ui/theme.ts`, `app/src/ui/components.tsx`, old screens), once nothing imports them.
- Modify: `README.md` (the app section: tabs, screens, what's where; no banned label)
- Test: all suites

- [ ] **Step 1: Check for leftovers.** `grep -rn "ui/theme\|ui/components\|WeekScreen\|ItemEditor\|SettingsMenu" app/src app/App.tsx` must print nothing. Delete the dead files.
- [ ] **Step 2: Check dark mode.** Run every screen test once with `useColorScheme` mocked to `dark`, as a `describe.each(['light', 'dark'])` around a smoke render of each screen, with no crash; the contrast test already covers the colours.
- [ ] **Step 3: Update the README.**
- [ ] **Step 4: Run everything.** `cd app && npm test && npm run typecheck && npm run lint`, `cd server && npm test && npm run typecheck`, `bash scripts/local-canvas.test.sh`. All pass.
- [ ] **Step 5: Commit** `"App: remove the old screens; README for the new layout"`.

### Task 12: By hand, in Expo Go

- [ ] Check, on an iPhone and an Android phone, with Canvas through ngrok:
  - first launch and logging in; Check what Cue found with a date picked; Today (Up next Start and Move, tick and Undo, a day strip tap); Schedule in each view, Accept all, the block sheet's move picker;
  - Courses and a course; Settings: Sync now, Disconnect then log in again, Study times, Delete all my data;
  - everything in dark mode and at the largest text size.
- [ ] Report the results with screenshots of anything wrong.
