# Same-Day Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an item has fewer days left than hours to study, the planner adds the missing blocks on days that already have one, and the shortfall warning names the daily limit.

**Architecture:** `DefaultStrategy.plan` keeps its spread (one block per item per day) and, only when that falls short, runs a fallback that adds blocks to the day with the fewest of the item's blocks. The app's `shortfallText` gets the new advice.

**Tech Stack:** TypeScript; server: vitest; app: jest-expo + react-test-renderer.

**Spec:** `docs/superpowers/specs/2026-11-22-same-day-blocks-design.md`

## Global Constraints

- Warning text exactly: `<title>: <p> of <n> hours fit before <day>. Add study times, raise the daily limit or lower the hours.`
- Every existing planner rule still holds for fallback blocks: after now, ends by the deadline, no overlap with busy time, accepted or suggested blocks, not in the item's rejected slots, within the daily limit.
- No API, database or settings change. Never write "Sprint 1/2" anywhere.

## Review Focus

1. An item with an accepted block on a day: the fallback counts that block when choosing the day with the fewest.
2. A rejected slot on a day the fallback reuses is not suggested again.
3. The daily limit across all items still caps a doubled-up day.
4. With enough days, plans are exactly as before (the fallback never runs).
5. A study range past midnight: an extra block counts against the day the range starts.

---

### Task 1: The planner doubles up when the days run out

**Files:**
- Modify: `server/src/planner/DefaultStrategy.ts`
- Test: `server/test/strategy.test.ts`

**Interfaces:** none new; `plan(input): PlanResult` keeps its shape.

- [ ] **Step 1: Write the failing tests** in `strategy.test.ts` (NOW is Mon 2 Nov 09:00 CST; default windows Mon–Fri 18:00–22:00; limit 3 h):
  - `it("puts a second block on the same day when only one day is left")`: `assignment("H", "2026-11-03T05:59:00Z", 120)` → starts `["2026-11-03T00:00:00.000Z", "2026-11-03T01:00:00.000Z"]`; `shortfalls` `[]`.
  - `it("adds the extra blocks to the day with the fewest, earlier day first")`: `assignment("H", "2026-11-04T05:59:00Z", 300)` → starts `["2026-11-03T00:00:00.000Z", "2026-11-03T01:00:00.000Z", "2026-11-03T02:00:00.000Z", "2026-11-04T00:00:00.000Z", "2026-11-04T01:00:00.000Z"]`; no shortfall.
  - `it("counts the item's accepted blocks when it doubles up")`: `exam("E", "2026-11-04T05:59:00Z", 180)` with accepted `{ id: "a", itemId: "E", startsAt: "2026-11-03T00:00:00.000Z", endsAt: "2026-11-03T01:00:00.000Z" }` → starts `["2026-11-03T01:00:00.000Z", "2026-11-04T00:00:00.000Z"]`.
  - `it("keeps the daily limit and rejected slots when it doubles up")`: limit 60 → `assignment("H", "2026-11-03T05:59:00Z", 120)` gives one block and a shortfall with `plannedMinutes: 60`; default limit with rejected `{ itemId: "H", startsAt: "2026-11-03T01:00:00.000Z", endsAt: "2026-11-03T02:00:00.000Z" }` → starts `["2026-11-03T00:00:00.000Z", "2026-11-03T02:00:00.000Z"]`.
  - `it("doubles up against the day a range past midnight starts on")`: `onlyMonday("22:00", "01:00")`, limit 120, `exam("E", "2026-11-03T18:00:00Z", 180)` → starts `["2026-11-03T04:00:00.000Z", "2026-11-03T05:00:00.000Z"]` (the 00:00–01:00 Tuesday slot counts against Monday's limit) and a shortfall with `plannedMinutes: 120`.
  - Rename `"counts accepted study toward the item and never doubles a day"` to `"... and doubles a day only when the days run out"` (same assertions: Review Focus 4).

- [ ] **Step 2: Run them to see them fail**
  Run: `cd server && npx vitest run test/strategy.test.ts`
  Expected: FAIL — one block on the last day, a shortfall; the limit/rejected and accepted cases may pass already except where a second same-day block is expected.

- [ ] **Step 3: Implement** in `DefaultStrategy.plan`, after the spread loop and before the shortfall check: while `placed < needed`, among days that have a slot passing every `usable` rule except "not a day the item already has", pick the day with the fewest of this item's accepted + proposed blocks (earlier day on a tie), place its earliest such slot, update `dayUsed`, repeat; stop when no day qualifies.

- [ ] **Step 4: Run the tests** — same command, then `cd server && npm test && npm run typecheck`. Expected: PASS, all server tests green.

- [ ] **Step 5: Commit** `Planner: adds a second block on a day when an item runs out of days`

### Task 2: The warning names the daily limit

**Files:**
- Modify: `app/src/viewmodels/useSchedule.ts` (`shortfallText` and its doc comment)
- Test: `app/__tests__/todayScreen.test.tsx`, `app/__tests__/schedule.test.tsx`

- [ ] **Step 1: Change the expected text** in both tests to end `Add study times, raise the daily limit or lower the hours.`
- [ ] **Step 2: Run them to see them fail** — `cd app && npx jest __tests__/todayScreen.test.tsx __tests__/schedule.test.tsx`. Expected: FAIL on the old text.
- [ ] **Step 3: Implement** the new text.
- [ ] **Step 4: Whole app suite, typecheck, lint** — `cd app && npm test && npm run typecheck && npm run lint`. Expected: all pass; only the two existing `no-void` warnings.
- [ ] **Step 5: Commit** `App: the study-time warning also suggests raising the daily limit`, together with the spec and this plan.
