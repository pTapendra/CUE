# Demo Data for the Local Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `scripts/local-canvas-seed.sh` fills the local Canvas with one realistic semester (3 courses, 3 teachers, 6 students, assignments, events), with simple per-account passwords listed in a private local file. `start` offers to run it.

**Architecture:** A shell script finds the Canvas folder through `local-canvas.sh`'s settings and runs `scripts/local-canvas-seed.rb` inside Canvas's web container with `rails runner`, the same way `start` creates Cue's developer key. The Ruby creates or updates only records whose SIS ID starts with `cue-demo-`, and prints one tab-separated line per account. The shell turns those lines into a CSV.

**Tech Stack:** macOS bash 3.2, Docker Compose, Canvas LMS (Rails) at the pinned commit `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c` (source at `/Volumes/CanvasDev/canvas-lms`, read-only).

**Spec:** `docs/superpowers/specs/2026-11-20-canvas-seed-data-design.md`

## Global Constraints

- Password for every account: first name in lowercase + `-cue2026` (e.g. `maya-cue2026`). First names are unique within the seed.
- Emails: `first.last@students.cue-demo.test` and `first.last@faculty.cue-demo.test`.
- SIS IDs: courses `cue-demo-<code without space, lowercase>` (e.g. `cue-demo-cs4350`), users `cue-demo-<first>-<last>` (lowercase), term `cue-demo-term`. Records without a `cue-demo-` SIS ID are never changed.
- Accounts file: `local-canvas-accounts.csv` in the same folder as `local-canvas.sh`'s settings file (so `CUE_LOCAL_CANVAS_SETTINGS` moves it in tests), mode 600. Header: `role,name,email,password,canvas_user_id,courses`.
- Never start ngrok. Never write the real `~/.config/cue` from tests. No iteration labels (the team's rule) anywhere, data included.
- macOS bash 3.2 compatible (no arrays-of-arrays, `mapfile`, `${x,,}`).

## Review Focus

1. **Running the seed twice.** Expected: no duplicate users, enrollments, assignments or events; dates move to the new day; passwords stay the pattern (Task 1, live run).
2. **A hand-made Canvas user already has a seed email** (no `cue-demo-` SIS ID). Expected: the seed stops before changing anything and names the email; that user is untouched (Task 1: the Ruby checks first; a shell test passes Canvas's message through).
3. **Canvas or Docker not running.** Expected: `Canvas isn't running. Start it with: scripts/local-canvas.sh start`, exit 1, and no file written (Task 1).
4. **The Ruby fails halfway.** Expected: the old accounts file is kept as it was; the last lines of Canvas's error are shown without the backtrace (Task 1).
5. **Dates near midnight and the Mac's time zone.** Expected: offsets are whole days in the Mac's zone, and due times are 23:59 in that zone. The shell passes the zone to the container (Task 1 test checks it is passed).

---

### Task 1: The seed script and its data

**Files:**
- Create: `scripts/local-canvas-seed.rb`
- Create: `scripts/local-canvas-seed.sh` (executable; sources `local-canvas.sh` for `say`, `warn`, `die`, `settings_file`, `find_canvas`; runs `main` only when executed, like `local-canvas.sh`)
- Modify: `scripts/local-canvas.test.sh` (also source the seed script; add tests)

**Interfaces:**
- Produces (shell, used by Task 2):
  - `seed_accounts_file`: prints `$(dirname "$(settings_file)")/local-canvas-accounts.csv`.
  - `canvas_web_running CANVAS_DIR`: true when `docker compose ps --status running --services` (run in that folder) lists `web`.
  - `mac_time_zone`: prints the Mac's IANA zone name (from `/etc/localtime`'s link target, e.g. `America/Chicago`; `UTC` if unknown).
  - `run_seed_ruby CANVAS_DIR`: runs `docker compose exec -T -e CUE_SEED_TZ="$(mac_time_zone)" web bundle exec rails runner "<contents of local-canvas-seed.rb>"` in that folder and prints its stdout. On failure it warns `Canvas couldn't add the demo data. What it said:`, shows the last 5 stderr lines without lines starting with `from `, and returns 1.
  - `write_accounts_file FILE`: reads Ruby output on stdin. It keeps the lines starting with `CUE_ACCOUNT<TAB>` and writes the CSV (header plus one row per account, fields in header order) to a temp file created under `umask 077`, then moves it to `FILE` with mode 600. With no account lines it writes nothing and returns 1.
  - `seed_main`: runs `find_canvas`; dies with the Review Focus 3 message unless `canvas_web_running`; says `Adding demo courses and accounts (about a minute)...`; runs the Ruby and writes the file. It ends with `Demo data ready: <n> courses, <t> teachers, <s> students.` and `Accounts and passwords: <file>`. A Ruby failure exits 1 and leaves the old file.
- Produces (Ruby output contract): one line per account, `CUE_ACCOUNT\t<role>\t<name>\t<email>\t<password>\t<canvas_user_id>\t<course codes joined by "; ">`, where role is `teacher` or `student`. The values contain no tabs or commas. Plus one line `CUE_COURSES\t<n>`.

**Ruby content and rules** (`scripts/local-canvas-seed.rb`):
- **Time zone and run day:** work in `ActiveSupport::TimeZone[ENV["CUE_SEED_TZ"]] || "UTC"`. "Today" is the run day in that zone, and every date is a whole-day offset from it.
- **Term** `cue-demo-term` on `Account.default`. It is named after the season and year of the run day (Jan–May Spring, Jun–Jul Summer, Aug–Dec Fall), and runs from day −42 to day +70.
- **Courses:** `CS 4350 Software Engineering`, `CS 4513 Database Systems` and `STAT 3303 Applied Statistics`. Each is in that term, with start and end dates matching the term, and is published (offered).
- **People:** 3 teachers (one per course) and 6 students with invented, varied names. Each student is in 2 or 3 courses, and at least one student is in all three. Each person has a `User`, and a `Pseudonym` on `Account.default` with `unique_id` = email, `sis_user_id` as in Global Constraints, and the pattern password. Every run sets the password again.
- **Enrollments:** teacher and student enrollments in the **active** state. A re-run reuses an existing enrollment of the same type and makes sure it is active; it never creates a second one.
- **Per course, 6–8 published assignments**, matched by course + title on re-runs. Due dates are at 23:59 on the offset day, and each assignment has realistic points. They include:
  - homework and project milestones;
  - at least one quiz, created as a published graded Canvas quiz so that its assignment's submission type is `online_quiz`;
  - a dated midterm;
  - in `CS 4350` only, `Midterm Exam` with **no due date**;
  - at least one item due on day −10 or earlier;
  - nothing due later than day +70.
- **Calendar events**, matched by course + title:
  - `CS 4513`: `Final exam (Room 210)`, day +62, 10:00–12:00;
  - `CS 4350`: `Review session (Room 115)`, day +27, 16:00–17:30 (no exam word, so Cue lists it as an event);
  - `STAT 3303`: `Project demo day`, all day on day +40.
- **Conflicts:** before changing anything, check every seed email. If a pseudonym with that `unique_id` exists without the matching `cue-demo-` SIS ID, `abort` with `<email> already belongs to a Canvas user the seed didn't create; rename or delete that user first.`
- **Output:** print the account lines and the course count at the end.
- **Verify every Canvas method against the source** before relying on it, among them:
  - the `Pseudonym` password fields;
  - `User#register!`;
  - `Course#offer!` / `available?`;
  - how `enroll_user` treats an existing enrollment;
  - `Quizzes::Quiz` publishing, and the assignment it creates;
  - `CalendarEvent` all-day fields.

- [ ] **Step 1: Write the failing shell tests** in `scripts/local-canvas.test.sh`. Each test sets `export CUE_LOCAL_CANVAS_SETTINGS="$T/local-canvas.conf"`, saves settings pointing at `$T/canvas` (`mkdir -p "$T/canvas"`), and stubs `docker`.
  - `test_seed_accounts_file_sits_next_to_the_settings`: equals `$T/local-canvas-accounts.csv`.
  - `test_write_accounts_file_writes_csv_with_mode_600`: input with a `CUE_ACCOUNT` line for `teacher / Elena Marsh / elena.marsh@faculty.cue-demo.test / elena-cue2026 / 7 / CS 4350`, plus a student line in two courses and an unrelated line. The file is exactly the header plus two rows, the courses read `CS 4350; CS 4513`, and the mode is `600` (`stat -f %Lp`).
  - `test_write_accounts_file_without_accounts_keeps_the_old_file`: an existing file with `old` content and input with no `CUE_ACCOUNT` lines → returns 1 and the content is still `old`.
  - `test_seed_says_to_start_canvas_when_it_isnt_running`: the `docker` stub prints nothing for `compose ps`. `bash scripts/local-canvas-seed.sh` exits 1, prints `Canvas isn't running. Start it with: scripts/local-canvas.sh start`, and writes no file (Review Focus 3).
  - `test_seed_end_to_end_writes_the_file_and_summary`:
    - the `docker` stub prints `web` for `compose ps`, and for `compose exec` prints three teacher lines, six student lines and `CUE_COURSES<TAB>3`;
    - it logs its arguments to `$T/docker.log`;
    - exit 0; the output has `Demo data ready: 3 courses, 3 teachers, 6 students.` and the file path;
    - the file has 10 lines;
    - the log contains `-e CUE_SEED_TZ=` and `rails runner` (Review Focus 5).
  - `test_seed_failure_keeps_the_old_file_and_shows_canvas_error`: the `exec` stub writes `RuntimeError: maya.thompson@students.cue-demo.test already belongs to a Canvas user the seed didn't create` and a `from /app/x.rb:1` line to stderr, then exits 1. Expect exit 1; the message is shown, the `from` line is not, and the old file is unchanged (Review Focus 2 and 4).
  - `test_seed_ruby_follows_the_rules`: a static check of `scripts/local-canvas-seed.rb`:
    - it contains `cue-demo-term`, `-cue2026`, `students.cue-demo.test`, `faculty.cue-demo.test`, `CUE_SEED_TZ`, `CUE_ACCOUNT` and `already belongs to a Canvas user the seed didn't create`;
    - it does not contain the banned iteration label (any case), checked with a pattern so the test file does not contain the word either.

- [ ] **Step 2: Run them to see them fail**
  Run: `bash scripts/local-canvas.test.sh`
  Expected: the new tests FAIL, existing ones pass.

- [ ] **Step 3: Implement** `local-canvas-seed.sh` (the functions above, then `main` → `seed_main`) and `local-canvas-seed.rb`, checking each Canvas call in the source.

- [ ] **Step 4: Run the tests**
  Run: `bash scripts/local-canvas.test.sh && bash -n scripts/local-canvas-seed.sh && ruby -c scripts/local-canvas-seed.rb`
  Expected: all pass. (`ruby -c` only if Ruby is installed on the Mac; otherwise run it inside the container in Step 5.)

- [ ] **Step 5: Live run on this Mac (no ngrok)**
  - Start Canvas: `cd "$(sed -n 's/^CANVAS_DIR=//p' ~/.config/cue/local-canvas.conf)" && docker compose up -d web`. Wait until `curl -s -o /dev/null -w '%{http_code}' http://canvas.docker/login/canvas` prints `200`.
  - Run `scripts/local-canvas-seed.sh`. Fix the Ruby until it succeeds.
  - Run it a second time and check for duplicates with a `rails runner` that prints, for the three `cue-demo-` courses:
    - the assignment count per course;
    - the number of enrollments per user per course, which must all be 1;
    - the number of calendar events.
  - Check a student logs in: create a token for `maya.thompson@students.cue-demo.test` in a `rails runner` (`user.access_tokens.create!(purpose: "seed check")`). Then `curl -H "Authorization: Bearer <token>" "http://canvas.docker/api/v1/courses?enrollment_state=active"` must list that student's courses. `…/api/v1/courses/<id>/assignments` must list assignments with due dates, the quiz showing `online_quiz` in its `submission_types`. Delete the token afterwards.
  - Check the pattern password works: `curl` a login to `http://canvas.docker/login/canvas`, or verify `Pseudonym#valid_password?("maya-cue2026")` in a `rails runner`.
  - Stop Canvas: `scripts/local-canvas.sh stop`.
  - Put the commands and their output in the report.

- [ ] **Step 6: Commit**

```bash
git add scripts/local-canvas-seed.sh scripts/local-canvas-seed.rb scripts/local-canvas.test.sh
git commit -m "Add demo data for the local Canvas"
```

### Task 2: `start` offers demo data; README

**Files:**
- Modify: `scripts/local-canvas.sh` (`cmd_start`)
- Modify: `scripts/local-canvas.test.sh`
- Modify: `README.md` (local Canvas section)

**Interfaces:**
- Consumes: Task 1 `seed_accounts_file` and `scripts/local-canvas-seed.sh`.
- Produces: in `cmd_start`, right after `docker compose up -d web` succeeds and before the ngrok question, a new function `offer_demo_data CANVAS_DIR`:
  - accounts file exists → say `Demo accounts: <file>`;
  - otherwise ask `Add demo courses and accounts (about a minute)? [y/N]`. On yes: `wait_for_canvas http://canvas.docker 300`, then `bash "$(repo_dir)/scripts/local-canvas-seed.sh"`. A failure only warns `Demo data wasn't added; Canvas is still running.` and `start` carries on.

- [ ] **Step 1: Write the failing tests**:
  - `test_start_offers_demo_data_when_there_is_none`: stub `docker` and `curl` (200); feed `y\nn\n`. The seed script runs (detect it by stubbing `docker compose exec` to log), and the ngrok question is answered no.
  - `test_start_mentions_demo_accounts_when_they_exist`: create the accounts file first; feed `n\n`. The output contains `Demo accounts:` and no demo-data question.
  - Update the existing start tests (`test_start_with_ngrok_end_to_end`, `test_start_stops_ngrok_when_canvas_fails_to_restart`, `test_start_with_ngrok_when_login_setup_fails` and any other that pipes answers into `start`) so the new question doesn't take the ngrok answer: create the accounts file in `$T` first.

- [ ] **Step 2: Run to see them fail**
  Run: `bash scripts/local-canvas.test.sh`
  Expected: the new tests FAIL.

- [ ] **Step 3: Implement** `offer_demo_data` and call it from `cmd_start`.

- [ ] **Step 4: Update `README.md`**, local Canvas section: add a "Demo data" part covering
  - what the seed creates (3 courses, 3 teachers, 6 students, assignments and events dated around the day it runs);
  - the password pattern `<first name>-cue2026`;
  - where the accounts file is;
  - that `start` offers it once, and that `scripts/local-canvas-seed.sh` refreshes dates any time while Canvas runs;
  - that it only changes records it created.

  Replace the old manual steps ("log in to Canvas, start a course… create a token") with a pointer to the seed, keeping the manual route in one sentence.

- [ ] **Step 5: Run the tests**
  Run: `bash scripts/local-canvas.test.sh && bash -n scripts/local-canvas.sh`
  Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/local-canvas.sh scripts/local-canvas.test.sh README.md
git commit -m "Local Canvas script: offer demo data on start"
```
