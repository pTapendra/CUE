# App redesign: design

## Why

The team finds Cue's current screens unprofessional. Navigation is a single screen swapped by a variable, the main actions sit in a row of outlined buttons, icons are typed characters (‹ › ⚙), secondary text fails contrast (#8A8A8E on white is 3.4:1), and dates are typed as `YYYY-MM-DD HH:mm`. The target look is **Notion Calendar and Todoist: clean and minimal**. The layout must also leave room for the features still to come (R3 study plans, R4 reminders, R5 material, R6 quizzes, R7 weak topics) without another redesign.

The layouts below were chosen screen by screen in mockups (kept in `.superpowers/brainstorm/`, not committed): the home screen, the tab structure, colours and Sync, first launch, and settings.

## Goals

- A standard app shell: bottom tabs, screens pushed on a stack, sheets for quick actions, line icons.
- One small design system (tokens and shared components) that every screen is built from.
- Every feature that works today is still reachable, in the new layout.
- Every text colour passes WCAG AA (4.5:1 for text; 3:1 for graphics such as course dots), in light and dark mode.
- No typed dates or times anywhere: native date and time pickers.
- Sync is always obvious: a labelled button and the last sync time.

## Non-goals

- Features not built yet: the **Study** tab (R6), a course's **Notes** (R5) and **Topics** (R7) sections, reminder settings and quiet hours (R4, N2). Each arrives with its feature, into the place this design leaves for it.
- Accounts based on the Canvas login (the next project, after this one).
- Server changes, apart from one read-only endpoint the overview screens need (see Data).
- Adding a course by hand. It comes right after this redesign, as its own change: a ＋ in the Courses header and its empty state, "＋ New course" in the item sheet's course picker, and a sheet with a name (required) and a code (optional). The server already supports creating a course. Renaming and deleting courses come later still, because the server can't do either yet.
- Tablet layouts, custom fonts, animations beyond the platform defaults.

## Anti-goals

- Losing any working feature or any behaviour the current tests cover.
- Empty "coming soon" tabs or sections.
- Text below the contrast targets.
- Anything that doesn't run in Expo Go (SDK 58).
- Breaking token mode (a server without Canvas login settings).

## Approaches

1. **React Navigation and a small design system (chosen).** Bottom tabs, a native stack, and sheets presented by the stack; `@expo/vector-icons` (Ionicons); theme tokens and shared components. It's the standard toolkit, runs in Expo Go, and screens can move over one at a time while the tests keep working.
2. **Expo Router.** Also standard and runs in Expo Go, but it moves the whole app into a file-based layout at once (entry point, every screen, test setup) for little gain at Cue's size.
3. **Restyle in place.** Keeps the homemade screen switching, so the tab bar, back navigation and sheets would be hand-built: the feel being replaced.

## Design

### Libraries

Added with `npx expo install` (all in Expo Go SDK 58):
- `@react-navigation/native`, `@react-navigation/bottom-tabs`, `@react-navigation/native-stack`, `react-native-screens`;
- `@react-native-community/datetimepicker`.

`@expo/vector-icons` ships with Expo. The font is the system font (San Francisco on iOS, Roboto on Android).

### Data

The schedule endpoint returns at most 14 days, but Today's Up next, Courses and a course need every upcoming item and study block. One new read-only endpoint serves them:

- **`GET /api/schedule/overview`** returns `{ items, undated, blocks }`:
  - `items`: dated items due from 30 days ago to 200 days ahead (Canvas imports up to 180 days ahead);
  - `undated`: every undated item;
  - `blocks`: every study block that hasn't ended, suggested or accepted;
  - with the same item and block shapes as the week endpoint.
- It reads through the existing schedule and planner services, and changes nothing.
- It's added to `ApiClient` as `getOverview()` and to the fake server, with server tests.
- **Which screens use it:** Today, Courses and a course use the overview. Schedule keeps the week endpoint for its visible 1 to 7 days.
- **Refreshing:** after any change (status, block, item, sync), the screens that show it refresh.

### Design system

**Colour tokens** (light; dark has the same names). Contrast ratios are measured against the background each pair is used on:

| Token | Light | Use | Contrast |
| --- | --- | --- | --- |
| `text` | #1D1D1F | titles, body | 16.8 on white |
| `text2` | #5B5B63 | secondary text, meta lines | 6.7 |
| `text3` | #6E6E77 | small labels (hours, tab labels) | 5.1 |
| `line` | #E6E6EA | dividers, card borders | — |
| `bg` / `bg2` | #FFFFFF / #F5F5F7 | screen / grouped lists, segmented control | — |
| `accent` | #4338CA | the one action colour: primary buttons, links, selected tab, today, + | 7.9 both ways |
| `accentTint` | #EEF0FF | soft Sync button, info cards | accent on it 7.0 |
| `exam` / `examTint` | #B42340 / #FDECEF | exam tag | 5.7 |
| `ok`, `warn`, `danger` | #1E7A43, #A15C00, #C0262D | synced, weak topic, destructive | 5.4, 5.2, 5.9 |
| `now` | #E5484D | the current-time line | graphic |

**Course colours** are assigned in a fixed order from a palette of 6. The first three are violet, teal and amber. Each colour has three shades:
- a mark for dots and block edges (3:1 on white or more);
- a tint for backgrounds;
- a text shade (4.5:1 on its tint or more).

| Course colour | Mark | Tint | Text |
| --- | --- | --- | --- |
| violet | #6D5BD0 | #EFEDFC | #4B3DB8 |
| teal | #0F9F84 | #E2F4EF | #0A6B59 |
| amber | #C47A0A | #FCF0DC | #8A5300 |

The other three (for example blue, rose, slate) are chosen by the builder under the same contrast rules.

- **How a course gets its colour:** by its position in `GET /api/courses` (sorted by name), wrapping after 6.
- **Matching:** study blocks and Check-what-Cue-found items carry only a course name, so they're matched by that name; an unknown name gets a neutral grey dot.
- **Known limit:** a course's colour can change only when a new course is added that sorts before it. That's accepted.

**Dark mode** uses the same token names. The values are the builder's, under the same contrast rules on the dark backgrounds.

**Type scale:** large title 26/700, title 20/700, section 12/700, body 13–15/500–600, meta 11.5/400. Text must scale with the phone's text size setting (no fixed heights around text).

**Spacing:** a 4-point grid. Screen padding is 16. Cards have a 14 radius and a 1 px `line` border on `bg`. Buttons have a 10–13 radius and at least 44 pt height, and so does every touch target.

**Shared components** (in `app/src/ui/`):
- `Button` (primary, secondary, danger; busy state);
- `IconButton` (with an accessibility label);
- `SyncButton` (filled and soft variants; "Syncing…" while busy);
- `ListRow` (title, meta line, leading check circle or dot, trailing value or chevron);
- `Card`, `Tag` (Exam), `CourseDot`;
- `SegmentedControl`, `DayStrip`, `SectionHeader` (with an optional action link);
- `Toast` (with an optional Undo), `EmptyState`, `ErrorBanner`;
- `DateTimeField` (opens the native picker).

### App structure

- **First launch** (not connected and never skipped): the Welcome screen, outside the tabs.
- **Tabs:** **Today** (`today-outline`), **Schedule** (`calendar-outline`), **Courses** (`library-outline`). The selected tab is in `accent`. Study is added with R6.
- **Stacked screens** (back arrow): a course; Settings → Study times; Settings → What Cue keeps.
- **Sheets:**
  - **Sheets** (native stack modal presentation: a form sheet on iOS, a modal on Android): the study block, an item (add or edit), and the Canvas login (a full-screen modal).
  - **Full-screen modals:** Check what Cue found, the token Connect screen, and Settings (opened from the gear on Today).
  - **Platform alerts:** confirmations, such as Disconnect and Delete.

### Screens

**Welcome.**
- The logo mark (an indigo rounded square), "Cue", and the headline "Know what to study, and when."
- Three feature rows with icons, describing what Cue does today and the study plans to come.
- A **Log in with Canvas** primary button (in token mode, **Connect Canvas**, which opens the token form).
- A text link: "Skip for now · add dates by hand" (goes to Today, with no Canvas).
- A footnote: "No name or email needed. Your Canvas access stays on Cue's server, not this phone."

**Canvas login (sheet).**
- Header: Cancel, then "Log in to Canvas".
- A strip under the header showing the Canvas host, with a lock.
- The existing web view behaviour: private, the ngrok user agent, a spinner with "Loading Canvas…", catching the return address.

**Check what Cue found.**
- A title and "N items from M courses. Untick anything you don't want."
- Items grouped by course (course dot and name), each with a square check (ticked by default) and a date line.
- An exam without a date shows "Canvas has no date for this exam" and a **＋ Add date** `DateTimeField`, or the student can leave it for later.
- A sticky bottom bar: Cancel, and **Save N items** (counts the ticked items).
- It keeps today's behaviour, including the **Log in with Canvas** / **Connect Canvas** button when the sync is refused.
- After saving, the app goes to Today and shows the toast "N items saved from Canvas".

**Today.**
- **Header:** the large title "Today"; on the right, a filled **Sync** button and a gear (opens Settings). Under the title: the date, and "✓ Canvas synced 12 min ago", which becomes "Syncing…" and turns into a **Connect Canvas** link when not connected.
- **Pull down** also syncs.
- **The sync flow:** Sync starts a sync preview. Check what Cue found opens as a modal, and Today refreshes after saving.
- **`DayStrip`:** the current week (Monday to Sunday), with today in an accent circle and a course-coloured dot on days with work. Tapping a day opens Schedule in Day view on that date.
- **Up next card** (on the course's tint):
  - It shows the next **accepted** study block that hasn't ended: label "UP NEXT · HH:MM", the block's title ("Study for …"), and course, length and due info.
  - **Start** sets the item's status to In progress.
  - **Move** opens the study block sheet with its time picker.
  - With no accepted block but suggested ones: the card reads "N suggested study blocks" with **Review**, which opens Schedule at the first suggestion.
  - With no blocks at all but upcoming exams or assignments: "Plan your studying" with **Set study times**, which opens Study times.
  - Otherwise the card is hidden.
- **Due soon:** items due from now to 7 days ahead, not done, in time order. Each is a `ListRow` with a check circle (red outline for exams), the title, an Exam tag, and course dot · day and time.
  - Ticking an item sets it Done, removes the row, and shows the toast "Marked done · Undo".
  - Tapping a row opens the item sheet.
  - A **See all** link goes to Schedule.
- **No date** (last group): every item without a date that isn't done, exams first. Each row shows **Add date**, which opens the item sheet. This replaces today's "Needs a date" banner, so no item becomes unreachable.
- **Shortfalls** (when the planner couldn't fit enough study before a deadline): a compact warning row above Due soon.
- **The + button** (accent, bottom right) opens the item sheet to add.
- **Empty state:** "Nothing due this week", plus the Sync button.

**Schedule.**
- The large title is the month. On the right: a soft **Sync** button and an icon button that jumps to today.
- A `SegmentedControl`: **Day · 3 days · Week**. Swiping or arrows page by that many days.
- A lane of deadline pills in course tints above the hour grid. Study blocks are drawn in course tint with a 3 px course-colour edge, and suggested blocks with a dashed course-colour border. The current-time line is red.
- Above the grid, when there are suggestions on screen: a row "N suggested blocks · **Accept all**".
- Tapping a block opens the study block sheet; tapping a deadline opens the item sheet; the + button adds an item.

**Study block (sheet).**
- The title, course, day and time; "Suggested" or "Accepted"; the clash warning, if any.
- Buttons: **Accept** (if suggested), **Move** (opens the date and time picker; saving calls `moveBlock`), and **Not this time** (reject).
- "This needs N hours of study" with a stepper (the existing study hours).

**Item (sheet, add or edit).**
- Title.
- Type: a `SegmentedControl` of Assignment · Exam · Event.
- Course: a picker from the course list, or none.
- Due: a `DateTimeField`, or "No date" (any type, as today). For events, an "Ends" `DateTimeField`, as today. There's no "All day" switch: the server doesn't store it, and faking it as a 24-hour event would block a whole day of studying.
- Study time: a stepper, for assignments and exams.
- Status: a `SegmentedControl` of Not started · In progress · Done · Postponed.
- Save. For an existing item, **Delete** (red, confirmed).
- The same fields and rules as today's editor.

**Courses.**
- The large title "Courses" and the subtitle "<term or 'Your courses'> · synced from Canvas"; a soft Sync button.
- One `Card` per course, showing:
  - the course dot and code;
  - the name;
  - "Next: <next due item> · <day>";
  - each upcoming exam's study plan as "<exam> <date> · study plan A of T blocks", with a progress bar in the course colour (accepted against total blocks);
  - a red **"<exam> needs a date"** tag for undated exams.
- Tapping a card opens the course.
- Courses made outside Canvas also appear. **Empty state:** "No courses yet", with Sync or Connect Canvas.

**A course.**
- Back to Courses, the course dot and code, and the name as title.
- A `SegmentedControl` of **Exams · Work**. Notes and Topics are added with R5 and R7.
- **Exams:** one card per exam (upcoming first, then past, dimmed):
  - title, Exam tag, date or **Add date**;
  - the study plan line, with a progress bar and "A accepted · S suggested";
  - **View in Schedule**, which opens Schedule at the exam's first block, or at its date.
  - The R3 **Plan my studying** and R6 **Quiz me** buttons are added with those features.
- **Work:** assignments and events, by due date. Each is a `ListRow` with a status check; tapping opens the item sheet.

**Settings.**
- Header: "Settings" with Done. The body is a grouped list on `bg2`.
- **Canvas:**
  - Connected: a row with the Canvas mark, a "Connected" badge, and "Synced … · read-only"; **Sync now**; **Disconnect Canvas** (red). Disconnecting asks "Disconnect Canvas?" and explains that the schedule and study plans stay. It then calls `disconnectCanvas`, and the group shows "Not connected" with **Log in with Canvas** (or **Connect Canvas** in token mode).
  - Not connected: those last two rows only.
- **Study plan:** **Study times** (value: a summary, such as "Weekdays 18–22"), and **Daily limit** (value: "3 hours"), which both open Study times.
- **Privacy:**
  - **What Cue keeps** opens a short text screen: no name or email; the Canvas access is stored encrypted on the server; Cue only reads Canvas.
  - **Delete all my data** (red) asks "Delete all your data?", explains it can't be undone, then calls a new `ApiClient.deleteAccount()` (the server's `DELETE /api/account`). It clears the stored device token and returns to Welcome.
- **About:** the app version.
- Reminders and quiet hours are added with R4.

**Study times.**
- One row per weekday: the day; the start and end times as chips, each opening a time picker; and a switch (off shows "No studying").
- The daily limit as a − / ＋ stepper.
- **Save**: the existing rules, validation and "save and plan" behaviour.

**Token Connect (token mode only).** Today's address and token form and the "Open Canvas to create a token" button, restyled with the design system.

### States

Every data screen has:
- **loading:** the content's layout with a spinner, never a blank screen;
- **error:** `ErrorBanner` with **Try again**, keeping saved data visible;
- **empty:** `EmptyState`.

The existing friendly error messages are kept.

### What stays

All view models, API calls and rules stay unless a screen needs a new derived value, such as Up next, Due soon, course progress or course colours. Those are new pure functions or hooks with their own tests.

## Testing

- **Kept behaviours:** every behaviour the current tests check (`App.test.tsx`, `planner.test.tsx`, `logic.test.ts`) still has a test after the redesign. The tests are moved to the new screens and labels, not deleted.
- **Server tests** for `GET /api/schedule/overview`: its range, undated items, blocks that haven't ended, other students' data excluded, and nothing changed.
- **New logic tests:**
  - Up next selection: accepted, then suggested, then plan prompt, then hidden.
  - Due soon: the window, the order, done items excluded. No date: undated items, exams first.
  - Course progress and next item.
  - Course colours: a stable assignment, wrapping after 6.
  - The study times summary.
  - **A contrast test** that computes WCAG ratios for every text-on-background token pair in light and dark, and fails below 4.5 (3 for marks).
- **New screen tests:**
  - Welcome: Log in, Skip, token mode.
  - Today: Up next Start and Move; ticking Done, then Undo; Sync opens the review; a day opens Schedule.
  - Courses, and a course.
  - Settings: Disconnect, and Delete (which returns to Welcome).
  - Pickers: driven through their props.
- **By hand, in Expo Go on iPhone and Android:** every screen in light and dark mode, the largest text size, and the first-launch flow against the local Canvas.

## Left to the builder

- File layout under `app/src/` (for example `navigation/`, `screens/today/`, `ui/`).
- Exact icon choices within Ionicons.
- The three extra course colours and the dark values, under the contrast rules.
- Sheet heights.
- Paging gestures in Schedule.
- The wording of empty states.
- Whether a screen's tests live in one file or several.

## Calls made after review

Decided by the designer, open to change:

- One read-only server endpoint (`/api/schedule/overview`), instead of paging the 14-day endpoint about 13 times per screen.
- No "All day" switch.
- Course colours by name order, matched by course name.
- Undated items of any type are allowed and listed under "No date" on Today.
- Adding courses by hand is deferred to the change right after this one, at the team's request: this redesign changes the layout of existing features only.
