# Planner: study blocks before deadlines (design)

Date: 2026-11-17
Status: draft for approval
Builds on: *Cue Architecture and Design* (repo root PDF) and the current code on `main`.

Marked **(decided)** = chosen by the team in discussion. Marked **(my call)** = a proposal in this document; check these while reading.

## 1. Intent

Cue's promise is "plans the work, tells you when to start it, and tests whether you know it." Cue already reads deadlines from Canvas and shows them. The Planner is the first half of "tells you when to start": for every upcoming exam and assignment, Cue proposes **timed study blocks** inside the hours the student says they can study, and the student accepts, moves or rejects each one. The design document's gap analysis (section 4) names this as what no other Canvas tool does.

The Reminder Service, built after this, will send start reminders for **accepted** blocks, so this work must leave accepted blocks in a form it can read.

## 2. Goals, non-goals, anti-goals

**Goals**
- The student sets their study times once (per weekday), plus a daily study limit.
- Cue proposes 1-hour study blocks for every dated exam and assignment that is not done, spread before its deadline, avoiding Canvas events and blocks already accepted.
- Several exams and assignments share the same free time fairly: nearest deadline first.
- When there is not enough free time, Cue says so per item.
- The week is shown as a **time grid**, three days at a time.
- The student can accept a block, accept all visible suggestions, move a block, reject a block ("not this time") and change how much study an item needs.

**Non-goals**
- Reminders and push notifications (the Reminder Service, built next).
- Ordering study by quiz results or weak topics (needs the quiz subsystems).
- Learning from past behaviour, or importing the student's class timetable.
- Writing blocks to the phone's calendar or to Canvas (Cue never writes to Canvas).
- Drag-and-drop on the grid. **(my call)**
- More than one study time range per weekday. **(my call)**

**Anti-goals** (would make it a failure even if it "works")
- Suggestions that jump around every time the app opens.
- An accepted block moving without the student doing it.
- More study in a day than the student's limit, or study at times outside their study hours (unless the student moved it there).
- Blocks in the past, after the deadline, or on top of a Canvas event.
- Silently planning less than an item needs.
- Storing anything personal beyond the student's time zone.

## 3. Constraints

- **Architecture (from the design doc):** the app reaches the server only through the API layer; rules live on the server; each subsystem reads and writes only its own data through a repository; the planning rule is a replaceable **Strategy**; subsystems are decoupled with **Observer** where one reacts to another's changes.
- **Ownership (Table 1):** the Schedule Manager *stores* events, start dates and study blocks; the Planner *proposes* them. So study blocks live in the Schedule Manager's data, and the Planner writes them through `ScheduleService` operations.
- **App:** must keep running in Expo Go (SDK 58). Only libraries Expo Go ships, or pure JavaScript.
- **Privacy:** the only new personal data is the time zone (an IANA name such as `America/Chicago`) and the study times.
- **Existing databases:** `db.ts` uses `CREATE TABLE IF NOT EXISTS`, so new columns on existing tables (`items`) need a small migration step that works on databases created by the current code.
- **Time:** the server stores UTC ISO strings (`normalizeDate`). Study times are local wall-clock times in the student's zone and must stay correct across daylight-saving changes.
- **Tests:** server tests use Vitest with an in-memory database and `FakeCanvasClient`; app tests use Jest with `jest-expo`. Every rule below must be covered by a server test.

## 4. Approaches considered

| Approach | Trade-off | |
| --- | --- | --- |
| **1. Planner on the server, suggestions saved** in a `study_blocks` table; re-planned when something changes | Suggestions stay put between app opens; the Reminder Service reads accepted blocks straight from the table; matches the design doc. Costs: deciding exactly when to re-plan. | **Chosen (decided)** |
| 2. Planner on the server, suggestions recomputed on every week load; only accepted/rejected blocks saved | Nothing to keep in sync, but suggestions shift as time passes, which breaks "2 of 6" and Accept all. | Rejected |
| 3. Planner in the app | Breaks "rules on the server"; reminders need the server to know the plan anyway. | Rejected |

Earlier decisions in the same discussion:
- **Timed slots inside a study window** rather than day-only blocks **(decided)**.
- **Time grid** layout for the week rather than a day list **(decided)**; mockup approved.

## 5. Planning rules (the default strategy)

Defaults are starting values to tune after testing; they live in one config object of the strategy. **(my call: the numbers; the shape was shown in discussion and the mockup was approved)**

| Setting | Default |
| --- | --- |
| Study needed per exam | 6 h |
| Study needed per assignment | 2 h |
| Block length | 60 min |
| Most study in one day (student can change) | 3 h |
| Lead time, exams | 10 days before |
| Lead time, assignments | 5 days before |
| Default study times (until the student changes them) | Mon–Fri 6–10 pm, Sat–Sun 10 am–4 pm |

**What gets planned:** items of kind `exam` or `assignment` with a `due_at` in the future and status other than `done`. `postponed` and `in_progress` are still planned. **(my call)** Items of kind `event` are never planned; they are busy time. A student can set an item's study time to 0 h to mean "no study needed".

**Busy time** (no suggested block may overlap it): Canvas and manual `event` items and `exam` items, from their start to their end (end = stored end time, or start + 1 h if unknown); accepted blocks of any item. **All-day Canvas events** (Canvas `all_day`) are not busy time: they show in the deadline row only, since they are usually markers ("No class", "Break"). A student who won't study on such a day switches that day off. **(my call)**

**Free slots:** for each day, the student's study range for that weekday, in their time zone, cut into 1-hour slots aligned to the start of the range; minus busy time; minus slots that start before *now*.

**Ranges past midnight:** a range may end after midnight (for example Mon 10 pm – 1 am), up to 12 hours long. It belongs to the day it starts on: the daily limit and "one block per item per day" count against that day. In settings, an end time earlier than the start time means "the next day". **(my call)**

**Algorithm**
1. Keep accepted blocks. Delete all proposed blocks (they will be recomputed). Delete accepted blocks that now end after their item's deadline or belong to an item that is done or deleted. Keep rejected slots as a per-item "not these times" list.
   - An accepted block that now **clashes** with busy time (a sync added an event on top of it, an exam moved onto it) is **kept and flagged**, never moved or deleted automatically. The week read marks it as clashing, with the name and time of what it clashes with; the student moves or rejects it. **(my call)**
2. For each item, needed blocks = ceil((study minutes − minutes of its accepted blocks) / 60). Skip if ≤ 0.
   - If the student lowered the study time below what is already accepted, delete the extra **future** accepted blocks, earliest first, so the blocks closest to the deadline stay. Setting 0 h ("no study needed") deletes all its future blocks. Past accepted blocks are never deleted. **(my call)**
3. Order items by deadline, nearest first; on a tie, exams first.
4. For each item in that order, choose its blocks:
   - Eligible days run from the start of its lead window up to its deadline; a block must end before the deadline.
   - At most **one block per item per day**, never more than the **daily limit** across all items (accepted blocks count toward it), never in a slot the student rejected for this item.
   - Spread the blocks across the eligible days that still have a free slot, as evenly as possible, keeping the last block as close to the deadline as allowed. Within a chosen day, take the earliest free slot.
   - If the lead window does not have enough days, extend it earlier, back to today.
   - If it still does not fit, place what fits and record a **shortfall** for the item (needed vs placed).
5. Save the new proposed blocks.

The strategy is a pure function: `(now, settings, items, busy, accepted, rejected) → { blocks, shortfalls }`. All rules are unit-tested through it without the database.

**When re-planning happens (my call)**
- After a Canvas sync is confirmed, an item is added, edited, deleted or has its status or study time changed, the study times change, or a block is rejected or moved.
- Once per local day, on the first week load of that day, so suggestions that have passed get replaced.
- Never on a plain week load otherwise. This is what keeps suggestions stable.

`ScheduleService` announces "this student's schedule changed" to listeners (**Observer**); the Planner listens and re-plans. The Reminder Service will subscribe the same way when it is built. **(my call)**

**Block numbering** ("2 of 6"): position of the block among the item's accepted and proposed blocks, by start time, out of the item's needed blocks.

## 6. Student actions

| Action | Result |
| --- | --- |
| **Accept** a block | It becomes accepted. No re-plan needed. |
| **Accept all** | Accepts every proposed block in the days on screen. **(my call: on screen, not the whole term)** |
| **Not this time** (reject) | That slot is remembered as rejected for this item; re-plan, so Cue offers another slot. |
| **Move to another time** | The student picks a new start time; the block becomes **accepted** at that time. Allowed anywhere in the future and before the deadline that doesn't overlap busy time or another **accepted** block. It may land on another item's *suggested* block; that suggestion is re-planned elsewhere. The daily limit, "one per item per day" and study hours do not block a move (the student chose it), but the moved block counts toward them when planning everything else. The slot it left is remembered as rejected for that item, so Cue doesn't suggest it straight back. **(my call)** Re-plan the rest. |
| **Change study time** for an item (stepper, 0–40 h in 1 h steps) | Saved on the item; re-plan. Lowering it below the accepted hours removes extra future accepted blocks (section 5, step 2). |
| **Change study times / daily limit** | Saved; re-plan. Accepted blocks stay even if now outside the new hours. |

## 7. Data

All in the Schedule Manager's database, except study settings, which belong to the Planner. **(my call)**

- `items`: add `ends_at` (nullable; filled for Canvas events from Canvas `end_at`) and `study_minutes` (nullable; null = default for its kind).
- New `study_blocks`: `id`, `student_id`, `item_id` (deleted with the item), `starts_at`, `ends_at` (UTC ISO), `state` (`proposed` / `accepted` / `rejected`), `created_at`, `updated_at`. Rejected rows keep the slot the student turned down.
- New `planner_settings`: `student_id`, `time_zone`, `daily_limit_minutes`, `windows` (seven entries: weekday, enabled, start `HH:mm`, end `HH:mm`; end earlier than start = next day), `last_planned_on` (local date, for the once-a-day re-plan).
- Until the app has sent a time zone, the server plans nothing and the week shows no suggestions.
- Deleting the account deletes all of it (existing `ON DELETE CASCADE` pattern).

Canvas adapter: `CanvasEvent` gains `endAt` and `allDay`, read from `end_at` and `all_day` in `HttpCanvasClient`; the fake gains them too. `items` stores all-day as a flag alongside `ends_at`.

## 8. API (shape is the builder's; these are the needs)

- Read and save study settings (time zone, daily limit, seven day ranges). The app sends the phone's time zone on first launch and whenever it changes.
- Week read gains: blocks in range (with item title, course, kind, "n of N", state, and any clash), shortfalls, and a way to ask for a 3-day range.
- Accept one block; accept all proposed blocks in a range; reject a block; move a block (new start).
- Item edit gains `studyMinutes`.
- Errors reuse the existing `{ error, message }` style.

## 9. App

**Week screen → time grid (decided)** — see the approved mockup ([2026-11-17-planner-mockup.html](2026-11-17-planner-mockup.html), option B; it is a page fragment, so open it in a browser for the layout, not the styling of the frame):
- Three days per page; ‹ › move by three days; tapping the title returns to today.
- Hours down the side; vertical scroll covering the study ranges and any events on those days.
- Proposed blocks dashed, accepted blocks filled, Canvas events grey; an accepted block that clashes gets a warning outline, and its sheet says what it clashes with.
- A row above the grid for deadlines and all-day events on each day.
- Banners on top: "Needs a date" (as now), one shortfall warning per short item ("DB final: 5 of 6 hours fit before Mon 7 Dec. Add study times or lower the hours."), and "N suggested blocks · Accept all".
- Footer as now: Add, Sync Canvas, ⚙. **⚙ opens a small menu: Study times, Canvas connection. (my call)**

**Block sheet** (tap a block): title, date and time, "Block 2 of 6 before the exam on Thu 3 Dec, 9:00 am", Accept, Move to another time, Not this time, and the item's study-time stepper.

**Study times screen**: one row per weekday with a range and an on/off switch, the daily limit stepper, the time zone shown read-only, Save and plan. A range ending after midnight shows as "10:00 pm – 1:00 am (next day)".

**Item editor**: gains the study-time stepper for exams and assignments, and an end time for events.

All screen logic stays in view-model hooks (MVVM), as in the existing screens.

## 10. Tests that must exist

- Strategy (pure): one exam alone; two exams in the same week; an assignment and an exam competing; daily limit respected; one block per item per day; nothing in the past or after the deadline; nothing on top of an event; rejected slot not reused; lead window extends when crowded; shortfall reported; a daylight-saving change inside the window (US, 1 Nov 2026 and 14 Mar 2027); a range past midnight counts against the day it starts; all-day events are not busy.
- Service and API: re-plan after sync/edit/status/settings; accepted blocks unchanged by re-plans; an accepted block that gains a clash is kept and flagged; lowering study time removes extra future accepted blocks earliest first, and 0 h removes all future ones; done item clears its blocks; once-a-day re-plan; move rules (onto a suggestion allowed, onto an accepted block or event refused, old slot remembered); reject; nothing planned before a time zone is known; account deletion removes blocks and settings; a database created before this change upgrades.
- App: grid view model (3-day paging, placing blocks by hour), block sheet actions, study-times form.

## 11. Left to the builder

- The exact spreading method, as long as section 5's rules hold.
- How to convert local times to UTC across daylight saving (a small pure-JS library is fine on the server).
- How "move" picks a time (a list of free slots from the server, or a typed time like the item editor uses today).
- API paths and payload names; migration mechanics.
- Grid drawing details (hour height, colours) within the existing theme.
