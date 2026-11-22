# Sync Shows What Changed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sync lists only what's new, changed or removed in Canvas since the student last saved, remembers skipped items, and applies Canvas's values on Save without touching what belongs to the student.

**Architecture:** A pure `diffCanvas` function sorts every Canvas item the server read into new, skipped, changed and removed, against the student's saved Canvas items and a new skipped list. The preview stores those groups; confirm applies them in one transaction through a new `ScheduleService.applyCanvasSync`, recording skips alongside. The app's review screen shows the groups as sections.

**Tech Stack:** Server: TypeScript, Express, better-sqlite3, zod, vitest + supertest. App: Expo, React Native, React Navigation, jest-expo + react-test-renderer.

**Spec:** `docs/superpowers/specs/2026-11-21-sync-changes-design.md`

## Global Constraints

- Compared fields: `title`, `dueAt`, `endsAt`, `allDay`. Never compared, never changed by sync on a saved item: `kind`, `status`, `study_minutes`, study blocks.
- Canvas `dueAt` null never counts as a change and never overwrites a date in Cue.
- Dates compared as instants after `normalizeDate` and the end rule (an end not after the start is no end).
- Removed only when: `assignment:<id>` and its course is in Canvas's course list and that course's assignment list lacks it; or `event:<id>`, its course is listed, its saved date is within `from`…`to`, Canvas's events lack it, and `GET /api/v1/calendar_events/:id` gives a 404 or `workflow_state: "deleted"`. A lookup that returns the event puts it back into the comparison; a lookup that fails any other way means "not removed".
- Nothing is written on preview except `last_synced_at` (as today). Cancel writes nothing.
- API: `POST /api/canvas/sync` → `{ syncId, courses, newItems, changed, removed, skipped }`; `POST /api/canvas/sync/confirm` request unchanged, reply `{ added, updated, removed }`.
- Migration 4 creates `canvas_skipped (student_id, external_id)`, primary key on both, `ON DELETE CASCADE` from `students`.
- Exact copy (verbatim):
  - Title (unchanged): `Check what Cue found`
  - Summary: non-zero parts of `{n} new`, `{n} changed`, `{n} removed`, joined with `, `
  - Section headings: `New`, `Changed`, `Removed from Canvas`, `Skipped`
  - Change labels: `Title`, `Due`, `Ends`, `All day`; shown as `{Label}: {from} → {to}`; a date as `{dayLabel} · {timeLabel}`; null due `no date`; null end `no end`; booleans `Yes` / `No`
  - Removed row note: `Will be removed from Cue`
  - Skipped link: `Show {n} skipped`
  - Empty state: `Cue is up to date with Canvas.`
  - Buttons: `Cancel`, `Save`, `Done`
  - Toast: non-zero parts of `{n} added`, `{n} updated`, `{n} removed`, joined with `, `; all zero: `Saved`
  - Spoken changed row: `{title}, {spoken label} changed from {from} to {to}` (one clause per change, joined with `, `), spoken labels `title`, `due date`, `end`, `all day`, spoken date `{dayLabel}, {timeLabel}`; spoken removed row: `{title}, will be removed from Cue`
  - README UC1 sentence to add after "review them before anything is saved.": `After the first sync, the review lists only what's new, changed or removed in Canvas since the student last saved; Canvas's title and dates win, and items the student unticks are remembered as skipped.`
  - README endpoint rows: `Read Canvas and return what's new, changed, removed and skipped (stores nothing)` and `Save { syncId, accept: [keys], dates?: { key: ISO date } }: adds accepted items, applies changes and removals, skips the rest`
- Never write sprint labels in code, tests, docs or commits. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run, from `server/`: `npm test` and `npm run typecheck`; from `app/`: `npm test`, `npm run typecheck`, `npm run lint`.

## Review Focus

1. **An assignment whose due date passed after it was saved** (still in Canvas). Not new, not removed; still compared, so a title change shows. (Task 1 test.)
2. **A course Canvas no longer lists** (ended or dropped). None of its saved items are removed. (Task 1 test.)
3. **An event that exists in Canvas but isn't in the events read**: saved outside the dates read or undated (Task 1 test), or moved by the professor outside the window, or a lookup that fails (Task 3 tests). Never removed; a moved one is listed as Changed.
4. **The student deletes a listed item between opening the review and Save.** Save must not re-create it (a changed item is updated by item ID, never upserted) and must not fail. (Task 2 test.)
5. **A date the student added to an undated exam, then a Save that applies other changes.** The date stays; once Canvas gets a date, Canvas's wins. (Task 2 and Task 3 tests.)

---

### Task 1: Sort what Canvas has into new, skipped, changed and removed

**Files:**
- Create: `server/src/canvasReader/diff.ts`
- Modify: `server/src/canvasReader/types.ts` (drop `alreadyImported`; add the types below)
- Modify: `server/src/schedule/ScheduleService.ts:88` (export `endsAfterStart`)
- Test: `server/test/canvasDiff.test.ts`

**Interfaces:**
- Produces, in `types.ts`:
  - `ProposedItem` as today minus `alreadyImported`.
  - `type ChangedField = "title" | "dueAt" | "endsAt" | "allDay"`
  - `interface FieldChange { field: ChangedField; from: string | boolean | null; to: string | boolean | null }`
  - `interface ChangedItem { key: string; itemId: string; externalId: string; courseExternalId: string; courseName: string; kind: ItemKind /* saved */; title: string; dueAt: string | null; endsAt: string | null; allDay: boolean /* Canvas's values, normalised */; changes: FieldChange[] }`
  - `interface RemovedItem { key: string; itemId: string; courseName: string; kind: ItemKind; title: string; dueAt: string | null /* saved values */ }`
  - `interface SyncGroups { newItems: ProposedItem[]; skipped: ProposedItem[]; changed: ChangedItem[]; removed: RemovedItem[] }`
  - `interface SyncPreview extends SyncGroups { syncId: string; courses: ProposedCourse[] }`
- Produces, in `diff.ts`:
  - `interface CanvasRead { courses: ProposedCourse[]; items: ProposedItem[] /* every assignment and event Canvas returned, before keep */; from: Date; to: Date }`
  - `interface SavedCanvasItem { itemId: string; externalId: string; courseExternalId: string | null; courseName: string | null; kind: ItemKind; title: string; dueAt: string | null; endsAt: string | null; allDay: boolean }`
  - `function diffCanvas(read: CanvasRead, saved: SavedCanvasItem[], skippedIds: ReadonlySet<string>, unsure: ReadonlySet<string> = new Set()): SyncGroups` (external IDs in `unsure` are never removed)
  - `function keep(date: string | null, kind: ItemKind, from: Date): boolean` (moved from `CanvasReaderService.ts`, unchanged)

- [ ] **Step 1: Write the failing tests** in `server/test/canvasDiff.test.ts`. Build inputs with small helpers (`canvasItem(id, overrides)`, `savedItem(id, overrides)`), `from = 2026-11-01T15:00Z`, `to = from + 181 days`, courses `101` and `102`.

```ts
it("a Canvas item not saved or skipped is new; past and undated non-exam items are left out", ...)
  // newItems keys === ["assignment:1"]; past "assignment:4" and undated non-exam "assignment:5" absent; undated exam kept with needsDate
it("a skipped item goes to skipped, not new", ...)
  // skippedIds has "assignment:1" → newItems [], skipped keys ["assignment:1"]
it("a saved item with the same values isn't listed, whatever the date format", ...)
  // saved dueAt "2026-11-05T05:59:00.000Z", Canvas "2026-11-05T05:59:00Z" → all four groups empty
it("lists each changed field with the saved and Canvas values, and the saved kind", ...)
  // expect(changed[0]).toMatchObject({ key: "assignment:1", itemId: "i1", kind: "exam", title: "New",
  //   changes: [{ field: "title", from: "Old", to: "New" }, { field: "dueAt", from: "2026-11-05T05:59:00.000Z", to: "2026-11-09T05:59:00.000Z" }] })
it("Canvas without a due date is never a change", ...)
  // saved dueAt "2026-11-06T16:00:00.000Z", Canvas dueAt null → changed []
it("a Canvas due date replaces a different one, or none, in Cue", ...)
  // saved null, Canvas "2026-11-06T16:00:00Z" → changes [{ field: "dueAt", from: null, to: "2026-11-06T16:00:00.000Z" }]
it("an end that isn't after the start counts as no end", ...)
  // saved endsAt null, Canvas endsAt === startAt → changed []
it("kind is never compared", ...)
  // saved kind "assignment", Canvas guess "exam", same values → changed []
it("an assignment missing from a listed course is removed", ...)
  // removed toEqual([{ key: "assignment:9", itemId: "i9", courseName: "Databases", kind: "assignment", title: ..., dueAt: ... }])
it("an assignment whose date has passed is compared, never new or removed", ...)   // Review Focus 1
  // saved & Canvas dueAt "2026-10-01T…" same → nothing; Canvas title differs → changed with a title change only
it("nothing in a course Canvas no longer lists is removed", ...)                    // Review Focus 2
  // saved courseExternalId "103" not in read.courses, not in items → removed []
it("a saved event outside the dates read, or undated, is never removed; inside, it is", ...) // Review Focus 3
  // saved events dated to+1 day, from-2 days, null → not removed; one at from+3 days missing → removed
it("an item in `unsure` is never removed", ...)
it("sorts each group by date, undated last", ...)
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd server && npx vitest run test/canvasDiff.test.ts`
Expected: FAIL, cannot find `../src/canvasReader/diff.js`.

- [ ] **Step 3: Implement `diffCanvas` in `server/src/canvasReader/diff.ts`**

Index saved items by `externalId`. For each Canvas item: saved → compare (`changed` if any `FieldChange`); else `keep` passes → `skipped` if its key is in `skippedIds`, otherwise `newItems`. Compare against the values Save would store: `dueAt = normalizeDate(c.dueAt)`, `endsAt = dueAt !== null && endsAfterStart(dueAt, c.endsAt) ? normalizeDate(c.endsAt) : null`; when Canvas `dueAt` is null, compare neither `dueAt` nor `endsAt`. Dates are equal when both null or `Date.parse` equal. Removed: a saved item with no Canvas match, using the Global Constraints rule (listed course IDs from `read.courses`; for events, saved `dueAt` non-null and within `read.from`…`read.to`). Sort new, skipped and changed by `dueAt` (`?? "9999"`, as `preview` does today), removed by saved `dueAt` the same way. `courseName` of a removed item: saved `courseName ?? "Course"`.

- [ ] **Step 4: Run them to see them pass**

Run: `cd server && npx vitest run test/canvasDiff.test.ts && npm run typecheck`
Expected: PASS. Typecheck may fail only where `alreadyImported` was used (`CanvasReaderService.ts`); remove those two lines and the `imported` parameter they need to get it green (Task 3 rewrites `preview`).

- [ ] **Step 5: Commit**

```bash
git add server/src/canvasReader server/src/schedule/ScheduleService.ts server/test/canvasDiff.test.ts
git commit -m "Server: sort what Canvas has into new, skipped, changed and removed"
```

---

### Task 2: Apply a sync to the schedule in one transaction

**Files:**
- Modify: `server/src/schedule/ScheduleRepository.ts:97-143` (course refresh, item update, upsert rules, saved items; remove `importedExternalIds`)
- Modify: `server/src/schedule/ScheduleService.ts:167-197` (`applyCanvasSync`, `savedCanvasItems`; `importFromCanvas` delegates; remove `importedCanvasIds`)
- Test: `server/test/canvasApply.test.ts` (setup like `server/test/blocks.test.ts:12-26`)

**Interfaces:**
- Consumes: `SavedCanvasItem` from `server/src/canvasReader/diff.ts` (Task 1).
- Produces, in `ScheduleService`:
  - `interface CanvasSyncChanges { courses: CanvasImport["courses"]; add: CanvasImport["items"]; update: { itemId: string; title: string; dueAt: string | null; endsAt: string | null; allDay: boolean }[]; remove: string[] /* item ids */ }`
  - `interface CanvasSyncCounts { added: number; updated: number; removed: number }`
  - `applyCanvasSync(studentId: string, changes: CanvasSyncChanges, alongside?: () => void): CanvasSyncCounts`
  - `savedCanvasItems(studentId: string): SavedCanvasItem[]`
  - `importFromCanvas(studentId, data): number` stays (used by planner and block tests) and returns `applyCanvasSync(studentId, { courses: data.courses, add: data.items, update: [], remove: [] }).added`.
- Produces, in `ScheduleRepository`:
  - `refreshCanvasCourse(studentId: string, externalId: string, name: string, code: string | null): void` (updates only an existing row)
  - `updateCanvasItem(studentId: string, itemId: string, v: { title: string; dueAt: string | null; endsAt: string | null; allDay: boolean }): boolean` (only `source = 'canvas'` rows; when `v.dueAt` is null, `due_at` and `ends_at` stay)
  - `savedCanvasItems(studentId: string): SavedCanvasItem[]` (joins `courses` for `courseExternalId` and `courseName`)
  - `upsertCanvasItem` on conflict: no longer sets `kind`; `due_at = COALESCE(excluded.due_at, items.due_at)`

- [ ] **Step 1: Write the failing tests** in `server/test/canvasApply.test.ts`

```ts
it("adds, updates and removes in one go, and reports the counts", ...)
  // after importFromCanvas of a1, a2: apply { add: [a3], update: [{ itemId: a1.id, title: "Renamed", ... }], remove: [a2.id] }
  // → toEqual({ added: 1, updated: 1, removed: 1 }); a1 title "Renamed"; a2 gone with its blocks
it("an update keeps the student's kind, status, study time and blocks", ...)
  // updateItem(a1, { kind: "assignment", studyMinutes: 600 }); setStatus in_progress; apply update → all kept
it("an update without a Canvas date keeps the date and end in Cue", ...)            // Review Focus 5
  // item dueAt set by student "2026-11-06T16:00:00.000Z"; update { dueAt: null, title: "Midterm" } → dueAt unchanged
it("adding an item that is already saved keeps its kind and its date when Canvas has none", ...)
it("an item deleted since the preview is neither re-created nor counted", ...)      // Review Focus 4
  // deleteItem(a1); apply { update: [a1 values], remove: [a1.id] } → { added: 0, updated: 0, removed: 0 }; no item with a1's externalId
it("refreshes a saved course's name, and creates a course only for an added item", ...)
  // courses [c1 renamed, c2 new] with add [] → c1 renamed, c2 absent from listCourses
it("announces once when something changed, and not when nothing did", ...)
it("runs `alongside` in the same transaction", ...)
  // alongside throws → nothing added, updated or removed
it("lists saved Canvas items with their course's Canvas ID", ...)
  // savedCanvasItems(sid) toEqual([{ itemId, externalId: "1", courseExternalId: "c1", courseName: "Databases", kind, title, dueAt, endsAt: null, allDay: false }])
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd server && npx vitest run test/canvasApply.test.ts`
Expected: FAIL, `applyCanvasSync` / `savedCanvasItems` is not a function.

- [ ] **Step 3: Implement** the repository methods and `applyCanvasSync` (`ScheduleService.ts`). In one `repo.transaction`: courses used by `add` are upserted as today, every other course in `changes.courses` goes through `refreshCanvasCourse`; `add` goes through `upsertCanvasItem` with today's normalisation; `update` through `updateCanvasItem` with `normalizeDate` and the end rule (counted only when it returns true); `remove` through `repo.deleteItem` (counted only when true); then `alongside?.()`. After commit, `emit` once if any count is above zero.

- [ ] **Step 4: Run the server tests**

Run: `cd server && npm test && npm run typecheck`
Expected: PASS, including `blocks.test.ts` and `plannerService.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add server/src/schedule server/test/canvasApply.test.ts
git commit -m "Server: apply a sync's additions, changes and removals in one transaction"
```

---

### Task 3: Preview returns the groups; Save applies them and remembers skips

**Files:**
- Modify: `server/src/db.ts` (migration 4)
- Modify: `server/src/canvas/CanvasClient.ts`, `server/src/canvas/HttpCanvasClient.ts`, `server/src/canvas/FakeCanvasClient.ts` (look up one event)
- Modify: `server/src/canvasReader/CanvasReaderRepository.ts` (skipped list)
- Modify: `server/src/canvasReader/CanvasReaderService.ts:280-369` (`preview`, `readCanvas`, `confirm`)
- Modify: `server/src/api/app.ts:172-176` (confirm reply)
- Modify: `README.md:16,200-201`
- Test: `server/test/canvasSync.test.ts`, `server/test/migrations.test.ts`, `server/test/httpCanvasClient.test.ts`

**Interfaces:**
- Consumes: `diffCanvas`, `CanvasRead`, `SyncPreview` (Task 1); `applyCanvasSync`, `savedCanvasItems`, `CanvasSyncCounts` (Task 2).
- Produces:
  - `CanvasClient.getCalendarEvent(id: string): Promise<CanvasEvent | null>`: null for a 404 or `workflow_state: "deleted"`; throws as other reads do otherwise. `HttpCanvasClient` GETs `/api/v1/calendar_events/:id` and maps the reply as `listCalendarEvents` does. `FakeCanvasClient` finds it in `data.events` whatever its date (null when absent) and has `failEventLookups = false`, which when true makes it throw `CanvasUnavailableError`.
  - `CanvasReaderRepository.skippedIds(studentId: string): Set<string>`
  - `CanvasReaderRepository.setSkipped(studentId: string, skip: string[], unskip: string[]): void`
  - `CanvasReaderRepository.savePreview(studentId, preview: Omit<SyncPreview, "syncId">, ttlMs): SyncPreview` (same method, new payload)
  - `CanvasReaderService.confirm(studentId, syncId, acceptKeys, dates?): CanvasSyncCounts`
  - HTTP: as in Global Constraints.

- [ ] **Step 1: Update and add the tests**

In `server/test/migrations.test.ts`, the three `user_version` expectations become `4`.

In `server/test/canvasSync.test.ts`: `preview.items` → `preview.newItems`; `confirm.body.imported` → `confirm.body.added`. Replace the two re-sync tests and add:

```ts
it("a re-sync lists nothing for saved items Canvas hasn't changed, and keeps their status", ...)
  // save SQL homework, set in_progress; re-sync → newItems has no "assignment:3", changed [], removed []
it("lists a changed event with its old and new values, and Save applies them but keeps status and study time", ...)
  // save event:900, set in_progress + studyMinutes 600; change endAt and allDay in canvas.data
  // preview.changed[0].changes toEqual([{ field: "endsAt", from: "2026-12-10T17:00:00.000Z", to: "2026-12-10T18:00:00.000Z" }, { field: "allDay", from: false, to: true }])
  // confirm { accept: [] } → { added: 0, updated: 1, removed: 0 }; item has new values, status in_progress, studyMinutes 600
it("unticked items are skipped from then on, and ticking a skipped one saves it", ...)
  // first confirm accepts only SQL homework → next preview: newItems [], skipped keys include "assignment:1" and "assignment:2"
  // confirm accept ["assignment:1"] → added 1; next preview skipped excludes it
it("the professor's new date replaces the one in Cue, even one the student set", ...)
  // save P2, PATCH dueAt; Canvas moves dueAt → changed dueAt from student's to Canvas's; Save → Canvas's date
it("a date the student added to an undated exam survives syncs until Canvas has one", ...)   // Review Focus 5
  // confirm Midterm with dates → re-sync: not listed; confirm another change → date kept;
  // Canvas gets dueAt → changed with from: student's date
it("a student's Exam correction survives a renamed item", ...)
  // PATCH kind "assignment" on Midterm Exam; Canvas renames to "Midterm Exam (Room 5)" → changed title; Save → kind still "assignment"
it("an item gone from Canvas is listed as removed; Cancel keeps it, Save deletes it", ...)
  // save SQL homework; delete it from canvas.data → preview.removed keys ["assignment:3"];
  // no confirm, preview again → still removed and still in the week; confirm → removed 1, gone from the week
it("an event Canvas moved past the dates read is listed as changed, not removed", ...)   // Review Focus 3
  // save event:900; move its startAt/endAt in canvas.data to 200 days ahead → removed [], changed[0].changes has dueAt to the new date
it("an event Canvas deleted is removed", ...)
  // save event:900; remove it from canvas.data → removed keys ["event:900"]
it("an event Cue can't look up is not removed", ...)
  // save event:900; remove it from canvas.data; canvas.failEventLookups = true → removed [], sync still 200
```

In `server/test/httpCanvasClient.test.ts`:

```ts
it("getCalendarEvent reads one event; a 404 or a deleted event is null", ...)
  // GET …/api/v1/calendar_events/900 with the token → { id: "900", courseId: "102", … }; 404 → null; { workflow_state: "deleted" } → null; 500 → CanvasUnavailableError
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd server && npx vitest run test/canvasSync.test.ts test/migrations.test.ts`
Expected: FAIL (`newItems` undefined, `user_version` 3).

- [ ] **Step 3: Implement**
  - Migration 4 in `db.ts`: the `canvas_skipped` table from the spec.
  - `readCanvas` returns every assignment and event Canvas returned (kind guess and `needsDate` as today, no `keep`). `preview` loads the saved items and skipped IDs first, then inside one `withClient` call: reads Canvas, builds a `CanvasRead` with `from`/`to`, runs `diffCanvas`, and looks up each `event:` key in `removed` with `getCalendarEvent` (an event that comes back is added to `read.items` as a proposed item; a lookup that throws adds the key to `unsure`). If any lookup returned an event or threw, it runs `diffCanvas(read, saved, skippedIds, unsure)` again. Keeps `markSynced`, and saves `{ courses, ...groups }`.
  - `confirm`: accepted = items of `newItems` and `skipped` whose key is in `acceptKeys`; `add` maps them as today (`dates[key] ?? dueAt`); `skip` = `newItems` keys not accepted; `unskip` = accepted keys from `skipped`; `update` = `changed` mapped to `{ itemId, title, dueAt, endsAt, allDay }`; `remove` = `removed` item IDs; `courses` = the preview's courses; then `this.schedule.applyCanvasSync(studentId, changes, () => this.repo.setSkipped(studentId, skip, unskip))`.
  - `app.ts`: `res.json(s.canvasReader.confirm(...))`.
  - README: the UC1 sentence and the two endpoint rows, verbatim from Global Constraints.

- [ ] **Step 4: Run the server suite**

Run: `cd server && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server README.md
git commit -m "Server: a sync lists what's new, changed and removed, and Save remembers skips"
```

---

### Task 4: The review screen shows new, changed, removed and skipped

**Files:**
- Modify: `app/src/api/types.ts:94-106`, `app/src/api/client.ts:161-163`
- Modify: `app/src/viewmodels/useSyncReview.ts`
- Modify: `app/src/screens/review/ReviewScreen.tsx`
- Modify: `app/test-support/fakeServer.ts:43-49,108-125`
- Test: `app/__tests__/review.test.tsx`, `app/__tests__/App.test.tsx:435`

**Interfaces:**
- Consumes: the HTTP shapes from Task 3.
- Produces, in `types.ts`: `ProposedItem` minus `alreadyImported`; `FieldChange { field: 'title' | 'dueAt' | 'endsAt' | 'allDay'; from: string | boolean | null; to: string | boolean | null }`; `ChangedItem { key; courseName; kind; title; changes: FieldChange[] }`; `RemovedItem { key; courseName; kind; title; dueAt }`; `SyncPreview { syncId; newItems; changed; removed; skipped }`; `SyncCounts { added; updated; removed }`. `confirmSync` returns `SyncCounts`.
- Produces, in `useSyncReview.ts` (pure, exported): `summaryLine(p: SyncPreview): string`, `savedToast(c: SyncCounts): string`, `describeChange(c: FieldChange): { shown: string; spoken: string }` (`spoken` is the clause after the title, e.g. `due date changed from Fri 27 Nov, 23:59 to Mon 30 Nov, 23:59`). The hook adds `changed`, `removed`, `skippedGroups`, `showSkipped`, `revealSkipped()`, `nothingListed` (no new, changed or removed), `canSave` (`!nothingListed || selected.size > 0`), and `confirm(): Promise<SyncCounts | null>`. `selected` starts with every `newItems` key.

- [ ] **Step 1: Update and add the tests**

`fakeServer.ts`: preview becomes `{ syncId, newItems: [the two items, no alreadyImported], changed: [], removed: [], skipped: [] }`; confirm adds accepted items from `newItems` and `skipped` as today and replies `{ added, updated: changed.length, removed: removed.length }`.

In `review.test.tsx` and `App.test.tsx:435`: `Save 2 items` / `Save 1 item` → `Save`; `"2 items from 2 courses. Untick anything you don't want."` → `2 new`; toasts `2 items saved from Canvas` → `2 added`, `1 item saved from Canvas` → `1 added`; drop the `alreadyImported` item and `already saved` label from the screen-reader test. Replace "counts the ticked items in the save button" and add:

```ts
describe('summaryLine / savedToast / describeChange', ...)
  // summaryLine({ newItems: [x], changed: [y], removed: [], ... }) === '1 new, 1 changed'
  // savedToast({ added: 1, updated: 0, removed: 2 }) === '1 added, 2 removed'; all zero → 'Saved'
  // describeChange({ field: 'dueAt', from: '2026-11-27T23:59:00', to: '2026-11-30T23:59:00' } in local time).shown === 'Due: Fri 27 Nov · 23:59 → Mon 30 Nov · 23:59'
  // describeChange({ field: 'endsAt', from: '…', to: null }).shown ends with '→ no end'; allDay false→true: 'All day: No → Yes'
it('Save stays enabled with every new item unticked, and sends no accepted keys', ...)
it('shows changed items with each change, and removed items, without checkboxes', ...)
  // preview.changed = [HW 3 dueAt change], removed = [Lab 2] → texts contain 'Changed', 'Removed from Canvas', 'Due: …', 'Will be removed from Cue', '1 new, 1 changed, 1 removed' (after unticking nothing)
  // checkbox labels exclude HW 3 and Lab 2; spoken labels 'HW 3, due date changed from …' and 'Lab 2, will be removed from Cue'
it('when nothing is new, says Cue is up to date and Done closes without saving', ...)
  // newItems [] → 'Cue is up to date with Canvas.'; no 'Save'; press 'Done' → back on Schedule, no confirm call
it('Show 2 skipped reveals them unticked; ticking one sends it', ...)
  // newItems [], skipped [two] → 'Show 2 skipped'; press it → 'Skipped' heading, rows unticked; tick one → 'Save' appears; confirm accept === [that key]
it('the toast after Save gives the counts', ...)
  // with one changed item, Save → toast '2 added, 1 updated'
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx jest __tests__/review.test.tsx __tests__/App.test.tsx`
Expected: FAIL (summary text and `Save` label not found).

- [ ] **Step 3: Implement** the types, the hook, and the screen. Summary line replaces today's count sentence. Sections in order New (grouped by course, today's rows and date picker), Changed (title, Exam tag if exam, course name, one `describeChange(...).shown` line per change, `accessibilityLabel` = spoken row), Removed from Canvas (title, course name, `Will be removed from Cue`), then `Show {n} skipped` (a link that calls `revealSkipped`) or, once revealed, Skipped (grouped by course, today's rows, unticked). Section headings use `type.title`. When `nothingListed`, `Cue is up to date with Canvas.` replaces the sections (the skipped link still shows). Footer: `Done` alone (calls `onCancel`) when `!canSave`; otherwise `Cancel` and `Save` (disabled only while saving). After Save: `onDone()` then `toast.show(savedToast(counts))`. Remove `Nothing upcoming in Canvas right now.` and the `already saved` parts of `Row`.

- [ ] **Step 4: Run the app checks**

Run: `cd app && npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app
git commit -m "App: the sync review shows what's new, changed, removed and skipped"
```
