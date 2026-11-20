# Local Canvas Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One script that lets a teammate on a Mac install Canvas in Docker, start it, and optionally expose it through their own ngrok account.

**Architecture:** `scripts/local-canvas.sh` is a bash script of small functions plus three commands (`setup`, `start`, `stop`). It wraps Canvas's own `script/docker_dev_setup.sh`. Functions are testable because the script only runs `main` when executed, not when sourced; `scripts/local-canvas.test.sh` sources it and checks the logic with temp files and stub commands.

**Tech Stack:** bash 3.2 (macOS), Homebrew, Docker Desktop, docker compose, ngrok v3, hdiutil.

**Spec:** `docs/superpowers/specs/2026-11-20-local-canvas-design.md`

## Global Constraints

- macOS only; bash 3.2 compatible (no associative arrays, `mapfile`, `${x,,}`, `|&`).
- Refuse to run as root.
- Ask before every install or disk change; default answer is No.
- Never print tokens or passwords.
- Canvas commit pinned: `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`.
- No sprint labels anywhere (code, tests, README, commits).
- Ctrl+C on ngrok takes Canvas off the internet; Canvas keeps running locally.

## Decisions made while planning (builder's calls)

- **Separate compose file instead of editing Canvas's override file.** The ngrok settings go in `docker-compose.cue-ngrok.yml` in the Canvas folder, rewritten whole each time, and Canvas's `.env` `COMPOSE_FILE` list gets that file appended once. Same effect as the design's override edit, but no YAML surgery and nothing to duplicate.
- **Disk requirement 60 GB, not 150 GB.** Measured here: the Canvas install added about 11 GB to Docker's disk plus 0.75 GB of code. 60 GB keeps headroom for build cache and logs. Below that the script explains and asks `Continue anyway? [y/N]`.
- **Finding Docker's disk:** `lsof` shows the host path of `Docker.raw` (Docker Desktop's settings file is privacy-protected and unreadable). Docker's own free room comes from `docker run --rm busybox df -k /`.
- **Settings file:** `~/.config/cue/local-canvas.conf`, `KEY=value` lines (`CANVAS_DIR`, `DISK_IMAGE`), read line by line, never `source`d.

## Review Focus

1. Running `start` with ngrok twice must not duplicate anything in `.env` or the compose file.
2. ngrok exits at once (another ngrok already running on a free account, bad token): the script reports ngrok's error, does not wait forever for an address.
3. The disk image's drive is unplugged at `start`: clear message, Docker is not started against a missing disk.
4. Docker Desktop slow or failing to start: bounded wait with a message (this looked like a hang before).
5. A tool missing and the teammate answers No: manual steps printed, script stops without side effects.

---

### Task 1: Skeleton, prompts, settings, test harness

**Files:** Create `scripts/local-canvas.sh`, `scripts/local-canvas.test.sh`

**Produces:** `say`, `warn`, `die`; `ask_yes_no "<question>"` (0 for y/yes, any case; else 1; default No); `ask_value "<question>" "<default>"` (echoes the answer or the default); `settings_save <canvas_dir> <disk_image>`; `settings_load` (sets `CANVAS_DIR`, `DISK_IMAGE`; returns 1 when no file); settings path from `${CUE_LOCAL_CANVAS_SETTINGS:-$HOME/.config/cue/local-canvas.conf}`; `main` dispatching `setup|start|stop`, usage otherwise; root refusal.

- [ ] Tests: `ask_yes_no` true for `y`, `Y`, `yes`; false for empty, `n`, `nope`. `ask_value` returns default on empty input. Settings round-trip through a temp file, including a path with spaces; a line like `CANVAS_DIR=$(touch /tmp/x)` is read as text, not run. Running the script with no command prints usage and exits 2.
- [ ] Run tests, watch them fail, implement, watch them pass, commit.

### Task 2: Tool checks and Docker

**Produces:** `ensure_tool <command> <brew-args> <manual-help>`; `ensure_brew`; `ensure_docker_app`; `wait_for_docker <seconds>` (opens Docker Desktop, polls `docker info`, returns 1 after the timeout with a message); `check_docker_memory` (warn under 7.5 GiB as reported by `docker info --format {{.MemTotal}}`, since 8 GB set shows a little less).

- [ ] Tests, with stub commands on a temp `PATH`: a present tool returns 0 and asks nothing; a missing tool with answer `n` prints the manual help and returns 1 without calling `brew`; with answer `y` it calls `brew install <args>` (stub records the call). `wait_for_docker 2` with a stub `docker` that always fails returns 1 within a few seconds.
- [ ] Red, green, commit.

### Task 3: Disk space, external drive, install (`setup`)

**Produces:** `free_gb <path>` (df on the nearest existing parent); `docker_disk_path` (from `lsof`, empty if not found); `docker_room_gb`; `create_disk_image <drive> <size_gb>` → image path (APFS sparse bundle `CueCanvas.sparsebundle`, volume name `CueCanvas`); `mount_disk_image <image>` → mount point; `fetch_canvas <dir>` (init, fetch the pinned commit at depth 1, check out); `canvas_installed <dir>` (a git checkout at the pinned commit); `cmd_setup`.

- [ ] Tests: `free_gb` returns a whole number for `/` and for a not-yet-existing folder under `$HOME`; `canvas_installed` false for an empty temp dir, true for a temp git repo whose HEAD is stubbed to the pinned commit (stub `git`); `mount_disk_image` on a missing image fails with a message naming the image.
- [ ] `cmd_setup` flow: tools → Docker up → ask the folder (default `~/canvas-lms`) → space check (host drive of the folder and of Docker's disk, Docker's own room) → if short, offer the external drive (list `/Volumes/*` except the startup disk, create and mount the image, folder becomes `<mount>/canvas-lms`, print the Docker Desktop steps: Settings → Resources → Advanced → Disk image location `<mount>/DockerDesktop`, disk limit 200 GB, Apply; wait for Enter; re-check Docker is up and `docker_disk_path` is on the mount) → if `canvas_installed`, ask whether to rerun Canvas's setup (default No) → else warn about the hour-long build, `fetch_canvas`, run `script/docker_dev_setup.sh` in that folder → `settings_save`.
- [ ] Red, green, commit.

### Task 4: `start`, `stop`, ngrok

**Produces:** `ngrok_config_path` (from `ngrok config check`); `ngrok_has_token` (an `authtoken:` line in that file); `ngrok_url_from_json` (stdin JSON from `http://127.0.0.1:4040/api/tunnels` → first `https://` public URL); `write_ngrok_compose <canvas_dir> <host>`; `include_compose_file <env_file> <name>`; `start_ngrok` (starts ngrok on `127.0.0.1:8080` in the background, polls the API up to 20 s, fails with ngrok's own log lines if ngrok exits); `wait_for_canvas <url>`; `cmd_start`; `cmd_stop`.

- [ ] Tests: `ngrok_url_from_json` on a sample tunnels JSON gives `https://name.ngrok-free.dev`, and empty on `{"tunnels":[]}`. `write_ngrok_compose` writes `ADDITIONAL_ALLOWED_HOSTS: <host>` and `"127.0.0.1:8080:80"` under `web`; writing a second host replaces the first. `include_compose_file` appends `:docker-compose.cue-ngrok.yml` to `COMPOSE_FILE=...` once (second call: no change), and adds the line with the default list when `.env` has none. `ngrok_has_token` true/false on temp config files. `start_ngrok` with a stub `ngrok` that exits 1 returns 1 quickly and shows the stub's message.
- [ ] `cmd_start`: `settings_load` (else tell them to run `setup`) → if `DISK_IMAGE` set and not mounted, attach it (fail clearly if its drive is missing) → `wait_for_docker` → `docker compose up -d` in `CANVAS_DIR` → ask about ngrok; on yes: token check (ask to paste one, `ngrok config add-authtoken` reading it without echo), `start_ngrok`, write compose file + `.env`, `docker compose up -d --no-deps web`, `wait_for_canvas`, print the address and how to connect Cue, then wait on ngrok; trap Ctrl+C to stop ngrok and say Canvas is still running locally. On no: print `http://canvas.docker`.
- [ ] `cmd_stop`: `docker compose stop` in `CANVAS_DIR`.
- [ ] Red, green, commit.

### Task 5: README and checks on a real Mac

- [ ] README: a section "A local Canvas for testing and demos" before "How the code is organised": what it is, `setup` / `start` / `stop`, time and space needed, what ngrok does, Ctrl+C.
- [ ] On the developer's Mac (Canvas already installed at `/Volumes/CanvasDev/canvas-lms`): restore that Canvas's override file from its `.before-ngrok` backup (the hand edit the script replaces), stop the hand-started ngrok, then run `setup` (already-installed path, say No to rerun), `start` with ngrok (check the address loads and `/api/v1/courses` answers 401), Ctrl+C, `start` again (no duplicates), `stop`.
- [ ] `bash -n scripts/local-canvas.sh`, test file green, commit.
