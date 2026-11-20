# Local Canvas script: design

## Why

Cue reads a student's courses, assignments and calendar events from Canvas. To test and demo Cue without a school Canvas, a teammate needs their own Canvas running on their Mac, and for a demo on a phone that Canvas must be reachable from the phone. Doing this by hand meant running into a nearly full internal disk, an exFAT external drive, Docker's disk moving to the drive, and Canvas refusing an ngrok address until it was allowed. The script makes that repeatable for a teammate on a Mac.

## Goals

- One script, `scripts/local-canvas.sh`, that a teammate on a Mac runs to install Canvas in Docker, start it, and optionally expose it through ngrok.
- Check required tools first. For anything missing, ask before installing it with Homebrew; on "no", print the manual steps and stop.
- Install the exact Canvas version known to work here, so a newer Canvas cannot break the build.
- Expose Canvas through the teammate's own ngrok account and tell Canvas to accept that address.

## Non-goals

- Windows or Linux.
- Sample courses or assignments in Canvas (teammates add their own).
- Exposing the Cue server or Expo through ngrok.
- Changing Cue's code.

## Anti-goals

- Installing anything, or touching a disk, without asking.
- Printing tokens or passwords.
- Leaving Canvas on the internet after the teammate stops the script.

## Approaches

1. **Bash script that wraps Canvas's own `script/docker_dev_setup.sh` (chosen).** Canvas's script already starts Docker, sets up the `canvas.docker` address, builds images, and creates the database and admin. Ours adds the checks, disk handling, version pin and ngrok step around it.
2. **Ship a prebuilt Canvas image.** Skips the hour-long build, but is 10+ GB and would carry the builder's database and admin login.
3. **A Node script.** No advantage: the work is Homebrew, Docker and disk commands.

## Design

`scripts/local-canvas.sh <command>`; macOS bash 3.2 compatible; refuses to run as root.

### `setup` (first time)

1. **Tool checks, in order:** Homebrew, git, Docker Desktop, ngrok. Missing tool → `Install <tool> with Homebrew? [y/N]`. Homebrew itself is installed with its official installer only after asking. "No" → print the manual install steps and exit.
2. **Docker:** start Docker Desktop if it is not running and wait for it; check Docker has at least 8 GB of memory, otherwise explain where to change it.
3. **Disk space:** Canvas needs about 150 GB, counting Docker's disk. Ask where to install Canvas (default `~/canvas-lms`). When the chosen place or Docker's disk lacks the space, offer an external drive: create an APFS sparse disk image on it (works on exFAT drives and only grows as it fills), mount it, put Canvas there, and walk the teammate through moving Docker's disk image location in Docker Desktop's settings. That is a click the script cannot make, so it waits, then checks Docker is running again from the new place.
4. **Install:** download Canvas at commit `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`, then run Canvas's `script/docker_dev_setup.sh`, which asks its own questions (admin email and password). Warn up front that this takes an hour or more.
5. Remember the install folder and disk image (if any) in a small settings file so later commands find them.

### `start` (every time after)

1. Mount the disk image if Canvas lives on one; start Docker Desktop if needed; `docker compose up -d` in the Canvas folder.
2. Ask `Make Canvas reachable from a phone through ngrok? [y/N]`. On yes:
   - add the teammate's ngrok token first if ngrok has none;
   - start ngrok on port 8080 and read the teammate's address from ngrok's local API;
   - write that address into Canvas's `docker-compose.override.yml` (`ADDITIONAL_ALLOWED_HOSTS`, plus port `127.0.0.1:8080:80` so only that Mac can use the port), backing the file up first and replacing, not repeating, an earlier address;
   - restart only the Canvas web container and check Canvas answers at the address;
   - print the address to type into Cue;
   - keep ngrok running in the terminal; Ctrl+C stops it and takes Canvas off the internet.

### `stop`

Stop the Canvas containers.

## Testing

On the developer's Mac: the tool checks (including a missing tool, simulated), the "Canvas already installed" path of `setup`, `start` with and without ngrok, and `stop`. The full first-time install cannot be re-run there without wiping that Canvas, so it gets a careful read. `bash -n` and shellcheck where available.

## Left to the builder

Exact prompt wording, the settings file's location and format, how long to wait for Docker and Canvas, and output styling.
