# Demo data for the local Canvas: design

## Why

To test "Log in with Canvas" and to demo Cue, the local Canvas needs student and teacher accounts and courses with realistic work in them. Creating these by clicking through Canvas is slow, and easy to get wrong in ways that hide everything from Cue: an unpublished course, or an invitation the student never accepted.

## Goals

- `scripts/local-canvas-seed.sh` fills the local Canvas with one realistic semester: 3 courses, 3 teachers, 6 students, assignments and calendar events.
- Every account has its own password in a simple pattern, easy to type on a phone during a demo: first name in lowercase + `-cue2026` (e.g. `maya-cue2026`).
- The script writes every account (role, name, email/login, password, Canvas user ID, courses) to a local file that only the Mac's user can read, and prints where it is.
- Students are enrolled and **accepted**, and courses are **published**, so Cue sees everything right away.
- Running it again duplicates nothing: dates move to the new day, enrollments stay accepted, and the file is rewritten.
- `scripts/local-canvas.sh start` offers to run it when there is no demo data yet.

## Non-goals

- Removing demo data (Canvas's own pages can delete it).
- Seeding Cue's own database, or any Canvas other than the local one.
- Windows or Linux.

## Anti-goals

- Touching anything the seed didn't create, in particular the admin account and courses teammates made by hand.
- Committing the accounts file.
- Using an iteration label (the banned word) anywhere (data included).

## Approaches

1. **A Ruby script run inside Canvas's web container with `rails runner` (chosen).** This is how `start` already creates Cue's developer key. One run creates everything, sets passwords directly, and can mark enrollments accepted.
2. **Canvas's REST API.** This needs an admin access token set up first and about a hundred requests, for no gain.

Changes two decisions in the local Canvas design: it said "no sample courses" (now there are, on request) and "never print passwords" (demo passwords are written to a local file; they're dummy data, and the team asked for them).

## Design

### Files

- `scripts/local-canvas-seed.sh`: finds the Canvas folder the same way `local-canvas.sh` does (its settings file), checks Canvas's web container is running (otherwise it says to run `start`), runs the Ruby, writes the accounts file, and prints a short summary and the file's path.
- `scripts/local-canvas-seed.rb`: the data and the Ruby that creates or updates it. It prints one line per account for the shell script to write out. It's kept in its own file because it is too long to embed in the shell script.
- Accounts file: `local-canvas-accounts.csv` in the project folder (git-ignored), mode 600. Columns: `role,name,email,password,canvas_user_id,courses`.

### Data (dates relative to the day the script runs)

- **Term:** starts 6 weeks before the run day and ends 10 weeks after it.
- **Courses** (published): Software Engineering, Database Systems and Applied Statistics, with realistic codes (e.g. `CS 4350`, `CS 4513`, `STAT 3303`). There is one teacher per course.
- **Students:** 6, each in 2 or 3 courses; at least one is in all three.
- **People:** invented, varied names. Emails are `first.last@students.cue.demo` and `first.last@faculty.cue.demo`. `cue.demo` is not a real domain, and the local Canvas sends no email.
- **Per course, 6–8 published assignments,** due at 23:59, spread from about 3 weeks before the run day to 10 weeks after it. They cover:
  - homework and project milestones;
  - at least one quiz (submission type `online_quiz`);
  - a dated midterm, and in one course an exam with **no due date** (Cue asks the student for it);
  - at least one item older than yesterday (Cue skips it).
- **Calendar events:**
  - a final exam with a room in the title and a 2-hour slot;
  - a review session with an end time (its title has no exam word, so Cue lists it as an event);
  - an all-day project demo day.
- Times are in the Mac's time zone.

### Finding its own data again

Every course and user the seed creates gets a SIS ID starting `cue-demo-` (courses: `cue-demo-cs4350`; users: `cue-demo-maya-thompson`). Students never see these. A re-run finds records by SIS ID, and assignments and events by course and title. It then updates them: dates moved to the new run day, passwords set to the pattern again, enrollments made active. Records without a `cue-demo-` SIS ID are never touched.

### `start`

After Canvas's web container is up and before the ngrok question:

- If there is no accounts file, `start` asks `Add demo courses and accounts (about a minute)? [y/N]` and runs the seed on yes.
- If the file exists, it prints `Demo accounts: <path>`.

To refresh dates later, run `scripts/local-canvas-seed.sh` directly.

### README

The local Canvas section gains a short "Demo data" part: what the seed creates, the password pattern, where the accounts file is, and that re-running it refreshes the dates.

## Testing

- **Shell tests** in `scripts/local-canvas.test.sh` style, with Docker stubbed:
  - the accounts file is written from the Ruby's output with mode 600;
  - the path is printed;
  - it says to run `start` when Canvas isn't running;
  - `start` asks when there's no file and doesn't when there is one;
  - tests never touch the real settings folder.
- **Live, on this Mac** (Canvas started without ngrok, stopped afterwards):
  - run the seed twice and confirm no duplicates;
  - log in to Canvas as a student with the pattern password;
  - check that student's courses and assignments through Canvas's API, as Cue would read them.

## Left to the builder

Exact names, course codes, assignment titles and offsets within the rules above; how the Ruby reaches the container; the summary's wording.
