# Sync shows what changed: design

## Why

Every time a student taps Sync, Cue reads Canvas and lists everything due from yesterday to 180 days out: every assignment, quiz, exam and event, including all the ones already saved (labelled "Already saved" and ticked like the rest). After the first sync, almost all of that list is noise. The student has to scan the whole list to find the one new quiz or the one moved deadline, if there is one at all.

Re-saving everything also does damage today. Save rewrites every ticked item from Canvas, so a date the student added to an exam Canvas had no date for is wiped back to empty, because the date field is blank again in the new review.

Sync should say what is different in Canvas since the student last saved: what's new, what changed, and what's gone. Nothing else.

## Goals

- The review lists only:
  - **New:** Canvas items the student hasn't saved and hasn't skipped.
  - **Changed:** saved items whose Canvas title, due date (or start), end time or all-day differs from what Cue has, with the old and new values.
  - **Removed from Canvas:** saved items Canvas no longer has.
- Saved items with no difference are not shown at all.
- Canvas is the authority for an item's title, due date, end time and all-day. The professor's date always wins.
- Unticked new items are remembered as skipped and stay out of later syncs, with a way to bring one back.
- Nothing is saved before the student taps Save (UC1 stays as written: review before anything is saved).

## Non-goals

- Any change to how Cue guesses exams from titles (`exam`, `midterm`, `mid-term`, `final`, `test`).
- Any change to the edit screen (ItemSheet). A student can still edit a Canvas item's title or date; the next sync lists it under Changed and Save puts Canvas's values back, as the edit screen already warns ("the next sync may update the title and date").
- Remembering items the student deletes from Cue. A deleted Canvas item shows up once more under New; unticking it skips it for good.
- Applying Canvas changes without the student's Save (see Approaches: A vs B).
- Better exam guesses (assignment group names, quiz flags).
- Background or automatic syncing.

## Anti-goals

- Sync changing what belongs to the student: an item's status, study time, study blocks, or its type (assignment, exam or event) once saved. A student who turned Exam off for "Final project" must never see it turned back on or listed as a change.
- Losing a date the student added to an exam Canvas has no date for.
- Deleting items because Canvas wasn't fully read: a course Canvas didn't return, or an event outside the dates Cue asked Canvas for, must never make an item look removed.
- A review that writes anything when the student taps Cancel.

## Approaches

### When Canvas's changes are saved

- **A. On Save (chosen).** Changes and removals are listed in the review with no tickbox, and Save applies them along with the new items the student ticked. Keeps UC1's "review before anything is saved". Trade-off: if the student cancels, the old date stays on Today and in the study plan until they sync and save.
- **B. As soon as sync reads them.** The review only reports changes; new items still wait for a tick. The plan never works from an out-of-date deadline, but it breaks UC1's wording.

The student picked A.

### Where the differences are worked out

- **The server compares when it reads Canvas (chosen).** The preview compares Canvas with the student's saved Canvas items and skipped list, and returns three groups plus the skipped items. Confirm applies them from the stored preview.
- **The app compares.** Dropped: the server still has to know what changed and what was removed to apply it on Save, so the same rules would live in two places.
- **Remember a copy of what Canvas said last time, and compare with that.** Dropped: since Canvas's values win on every Save, the saved item already holds Canvas's last values, apart from student edits that Save is meant to undo anyway. The one exception (a date the student added to an undated exam) is handled by a rule below.

## Design

### Reading Canvas (preview)

`CanvasReaderService.preview` still reads courses, every course's assignments, and calendar events from `from` (now − 1 day) to `to` (now + 180 days), and still stores nothing in the schedule. It now also loads:

- the student's saved Canvas items: external ID, item ID, course external ID, kind, title, due date, end, all-day (a new `ScheduleService`/`ScheduleRepository` read; `importedCanvasIds` is no longer needed);
- the student's skipped external IDs (new table, below).

It then sorts each Canvas item it read into one group, by external ID (`assignment:<id>` or `event:<id>`):

| Canvas item is… | Group |
| --- | --- |
| not saved, not skipped, and passes today's `keep` rule | **New** |
| not saved, skipped, and passes `keep` | **Skipped** |
| saved, and differs (see Comparing) | **Changed** |
| saved, no difference | not sent |

Saved items are compared whether or not they pass `keep`: an assignment whose due date has passed, or whose date Canvas cleared, is still compared, never treated as removed.

A saved Canvas item is **Removed** when Canvas didn't return it and Cue is sure it read where it would be:

- `assignment:<id>`: its course was in Canvas's course list, and that course's assignment list doesn't include it.
- `event:<id>`: its course was in Canvas's course list, its saved date is within `from`…`to`, Canvas's events don't include it, **and** reading every event of its course whatever the date (`GET /api/v1/calendar_events?all_events=true&context_codes[]=course_<id>`, which leaves deleted events out) doesn't include it either.

Canvas only returns events dated within `from`…`to`, so an event missing from that list may still exist: the professor moved it outside the window, or the student changed its date in Cue after Canvas's own date passed. That is why, when an event looks removed, its course's events are read again without dates. If the event is there, it is compared like any other saved item (and may be listed as Changed, with a Canvas date outside the window). If that read fails, those events are not removed this time. Assignments need no second read: their full list is read, with no date window. The second read uses the events route Cue's login may already read (`url:GET|/api/v1/calendar_events`); a route for one event (`/api/v1/calendar_events/:id`) would need a new login scope.

A Canvas list Cue can't read whole (more than 50 pages, a next page on another host, or a page that isn't a list) fails the sync instead of coming back short, since anything missing from a list would look removed.

A saved item in a course Canvas no longer lists (a course that ended, or one the student dropped) is never removed. A saved event dated outside `from`…`to`, or with no date, is never removed.

`markSynced` stays where it is (when Canvas is read): "Canvas synced 5 min ago" on Today means when Cue last read Canvas.

### Comparing

Compared fields, Canvas's value against the saved one: **title**, **due date** (`dueAt`, the start for events), **end** (`endsAt`), **all-day**.

- Dates are compared as instants, after the same normalisation and end rule Save applies (`normalizeDate`; an end that isn't after the start counts as no end), so a format difference alone is never a change.
- **Canvas has no due date, Cue has one:** not a change. Cue keeps its date. This covers the date a student added to an undated exam. It also means that if a professor clears a date, Cue keeps the old one (accepted).
- **Canvas has a due date, Cue has a different one or none:** a change, even when Cue's date was added by the student. Canvas's date wins.
- **Not compared, never changed by sync on a saved item:** kind (assignment, exam or event), status, study time, study blocks.
- A course rename isn't an item change. Save refreshes the name and code of the Canvas courses Cue already has (silently), and creates a course only for an item being added.

### What the preview returns

`POST /api/canvas/sync` (shape changes; the app is the only client):

```ts
{
  syncId: string;
  newItems: ProposedItem[];   // as today, minus alreadyImported; started ticked in the app
  changed: ChangedItem[];
  removed: RemovedItem[];
  skipped: ProposedItem[];    // shown only when the student asks; started unticked
}

ChangedItem = {
  key: string;                 // the external ID
  courseName: string;
  kind: ItemKind;              // the saved kind, for the Exam tag
  title: string;               // Canvas's title
  changes: { field: "title" | "dueAt" | "endsAt" | "allDay"; from: string | boolean | null; to: string | boolean | null }[];
}

RemovedItem = { key: string; courseName: string; kind: ItemKind; title: string; dueAt: string | null }  // saved values
```

New, Changed and Skipped are each sorted by date as today (undated last); Removed by saved date. The stored preview (`sync_previews.payload`) keeps whatever confirm needs: the courses, the full Canvas values of new, skipped and changed items, and the saved item ID of each changed and removed item.

### Saving (confirm)

`POST /api/canvas/sync/confirm` keeps its request: `{ syncId, accept: [keys], dates?: { key: ISO date } }`. `accept` may contain keys from New and Skipped. In one transaction, from the stored preview:

1. **Added:** every New or Skipped item in `accept` is saved as today (kind from the title guess, `dates[key]` filling a missing date). Its key is removed from the skipped list.
2. **Skipped:** every New item not in `accept` is added to the skipped list. Skipped items not in `accept` stay skipped.
3. **Changed:** every Changed item gets Canvas's title, due date, end and all-day. Its kind, course, status, study time and blocks stay. A Canvas due date of null never overwrites Cue's date (the rule above). An item the student deleted since the preview is ignored, never re-created (it is updated by item ID, not saved again by external ID).
4. **Removed:** every Removed item is deleted from Cue, with its study blocks (as deleting an item does today). An item the student already deleted since the preview is ignored.
5. Course names and codes are refreshed as described above.

Reply: `{ added, updated, removed }` (counts). The schedule's change event fires once, if anything changed, so the planner replans as it does after a confirm today.

Changed and removed items have no tickbox: Canvas decides them, and Save applies all of them. Save is the only step that writes; Cancel writes nothing, and the same changes show again on the next sync.

`upsertCanvasItem` stops overwriting `kind` on an existing row (it sets kind only on insert). That is what keeps a student's Exam correction through syncs.

### Skipped list

New table, added as the next migration in `db.ts`:

```sql
CREATE TABLE canvas_skipped (
  student_id  TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  PRIMARY KEY (student_id, external_id)
);
```

Owned by the Canvas Reader (`CanvasReaderRepository`). Written only by confirm. Kept across Disconnect (a Canvas account's item IDs don't change); cleared with the account. A login that moves the phone to another account (`AccountService.link`) moves only hand-added data, never Canvas items, so skipped rows stay with their account too: nothing to change there.

### The review screen

Same screen and title ("Check what Cue found"), same Cancel and loading and error and "Log in with Canvas" behaviour. What changes:

```
Check what Cue found
1 new, 1 changed, 1 removed

NEW
 CS 2413
  [✓] Quiz 4                    Thu 26 Nov · 09:00

CHANGED
  HW 3 · CS 2413
  Due  Fri 27 Nov 23:59 → Mon 30 Nov 23:59

REMOVED FROM CANVAS
  Lab 2 write-up · PHYS 2514
  Will be removed from Cue

Show 2 skipped

[Cancel]                          [Save]
```

- **Summary line** under the title: the non-zero counts ("1 new, 1 changed, 1 removed"). No time in it: the comparison is against what's saved, not against a time.
- **New:** grouped by course with the course dot, as today's list; rows and the undated-exam date picker exactly as today. A student's first sync (nothing saved yet) shows everything here, as today.
- **Changed:** one row per item: title, Exam tag if the saved kind is exam, course name, then one line per changed field, old → new ("Due", "Ends", "Title", "All day"). A cleared end reads "no end". No checkbox.
- **Removed from Canvas:** one row per item: title, course name, "Will be removed from Cue". No checkbox.
- **Show N skipped:** a link at the bottom when there are skipped items. It reveals them as unticked New-style rows; ticking one saves it.
- **Save:** enabled whenever anything is listed (so unticking every new item and saving records them as skipped). Label "Save". After saving, the toast states the counts ("1 added, 1 updated, 1 removed"; zero counts left out; if only skips were recorded, "Saved").
- **Nothing listed** (no new, changed or removed): "Cue is up to date with Canvas." in place of the list, and the footer is a single Done button that closes the screen without calling confirm. "Show N skipped" still appears if there are skipped items; ticking one brings Save back.
- Screen reader labels follow today's pattern, e.g. "HW 3, due date changed from Fri 27 Nov, 23:59 to Mon 30 Nov, 23:59".

`useSyncReview` starts with every New key selected and no Skipped key selected, keeps the date picks as today, and returns the three groups (New grouped by course) plus the skipped list and whether it is shown.

### Existing students, first sync after this ships

- Items they unticked before were never remembered, so they show once under New; unticking them skips them from then on.
- Canvas items whose title or date they edited in Cue show under Changed, and Save restores Canvas's values.
- Undated exams they added a date to are not shown (Canvas still has no date).

### Docs

Update the README: UC1's description (sync shows new, changed and removed items; skipped items are remembered) and the two endpoint rows.

## Calls made

- No time in the summary line, and `markSynced` stays at read time.
- Removed items are deleted on Save rather than kept with a flag: kept, the planner would go on scheduling study for work that no longer exists.
- Removed is only claimed where Cue read Canvas fully (the course is listed; for events, the date is in range), and an event only after its course's events, read without dates, don't include it. One extra Canvas request per ten courses with an event that looks removed, which is rare.
- Save leaves a Changed item's course as it is; course isn't a compared field.
- A Canvas due date of null never overwrites a date in Cue.
- Course renames are applied on Save without being listed.
- The confirm request stays the same; skips are worked out on the server from what wasn't accepted.
- Deleting an item from Cue isn't remembered as a skip (keeps the change inside sync).

## Left to the builder

- Test design and fakes (`FakeCanvasClient`, `app/test-support/fakeServer.ts`), and which existing sync tests move or change.
- Names of the new repository methods and app types beyond the API shape above.
- Exact wording of field labels, the empty state and the toast, within what's above.
