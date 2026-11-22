# Profile button on every page, and Schedule without the locate button (short design)

Date: 2026-11-22
Status: approved in discussion

## Why

Settings could only be reached from the gear on Today. The student wants it within reach on every page, behind a profile icon instead of a gear. On Schedule, the locate button is not needed.

## Goals

- A person icon (Ionicons `person-circle-outline`) at the right end of the header on **Today, Schedule, Courses and a course's page** opens Settings. It replaces the gear on Today.
- One shared button, so it looks and behaves the same everywhere. Screen readers hear "Settings", because that is where it goes.
- Schedule loses its locate ("Today") button. Its header is: month, Sync, profile icon.
- Tapping the Schedule tab while already on Schedule returns to today's page, in the view the student is using.

## Non-goals

- The red "now" line stays as it is: shown on today's column only within the hours the grid already covers (decided: the grid's hours are not stretched to include the current time).
- No scrolling of the grid to the current time.
- No change to the Settings screen itself (title, content).

## Anti-goals

- Showing the student's name, initials or photo: Cue never stores them (README, Privacy). The icon stays generic.

## Approaches

1. **A header button on each page (chosen).** Matches where the gear was; no tab slot used.
2. A fifth "Profile" tab. Rejected: the redesign keeps that slot for the Study tab, and settings are not visited often enough to be a tab.
3. A floating button. Rejected: it would clash with the + (add) button.

## Design

- `ProfileButton` in `app/src/ui/kit`: an `IconButton` with the person icon and the label "Settings", taking `onPress` like the other kit buttons. Each page passes `() => navigation.navigate('Settings')`.
- Not on: the Settings pages, the sync review, the Connect screen, Welcome (they have Done or Cancel).
- Schedule listens for `tabPress` on its own tab; when Schedule is already focused, it goes to today's page (`goToday`). Arriving from another tab keeps the page the student left.
- README: the Schedule line says the Schedule tab returns to today; Today and Settings lines say the profile icon on every page opens Settings.

## Left to the builder

- Exact spacing on a course's page so the icon sits at the right end of the header row.
