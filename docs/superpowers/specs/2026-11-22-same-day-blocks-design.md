# A second block on the same day when the days run out (short design)

Date: 2026-11-22
Status: approach chosen in discussion; design awaiting approval

## Why

Cue plans at most one study block per item per day. When an item is due soon, there are fewer days left than hours to study, so Cue plans less than the item needs and warns "1 of 2 hours fit before Sun 22 Nov. Add study times or lower the hours." Adding study times can't help in that case: the limit is one block a day, not a lack of free time. A student who follows the advice sees nothing change. (Found on a quiz due the same night: neither longer study times nor a higher daily limit changed the plan.)

## Goals

- One block per item per day stays the first choice, so study is spread out when there are enough days.
- When there aren't enough days, Cue adds more blocks on the days it can still use, so the item gets the hours it needs if the study times and the daily limit allow it.
- The warning names everything that can help: "Add study times, raise the daily limit or lower the hours."

## Non-goals

- No change to the daily limit, the lead window, busy time, rejected slots, or the order in which items are planned.
- No change to Move (it already ignores the one-a-day rule).
- No setting to turn the fallback off.

## Approaches

1. **Let Cue put more than one block on a day as a fallback, and widen the warning (chosen).** It fixes the cause, and the advice in the warning becomes true.
2. Keep one block a day and change only the warning ("Only 1 day left … lower the hours"). Rejected: the student gets less study time and a warning, when there is room in the day to study.

## Design

- In `DefaultStrategy.plan`, the existing spread runs first, unchanged. If it placed fewer blocks than the item needs, a fallback adds the rest. Each extra block goes on the day (from now up to the deadline) with the fewest of this item's blocks so far (accepted and suggested), earliest day on a tie. Within that day it takes the earliest free slot. The fallback stops when the item has enough or no day has a free slot. Every other rule still applies: before the deadline, after now, not on busy time, accepted or suggested blocks, or the item's rejected slots, and within the daily limit.
- A shortfall is recorded only if the item still falls short after the fallback.
- App: `shortfallText` ends with "Add study times, raise the daily limit or lower the hours." ("Daily limit" is the setting's name in Settings → Study times.)

## Left to the builder (my calls)

- Ties go to the earlier day: it leaves the later days for items due later.
- Two blocks for the same item may sit back to back (for example 4 PM and 5 PM). That is the earliest-free-slot rule the planner already uses.
