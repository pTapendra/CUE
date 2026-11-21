#!/bin/bash
# Fills the local Canvas with demo data for testing and demoing Cue: one
# semester of courses, teachers, students, assignments and calendar events,
# dated around the day it runs. Canvas must be running (scripts/local-canvas.sh
# start). Running it again moves the dates to the new day and duplicates
# nothing; it only changes records it created. macOS only.
#
#   scripts/local-canvas-seed.sh
#
# Every account's login and password go into seed/local-canvas-accounts.csv in
# the project folder (git-ignored), readable by this user only. The data is in
# seed/local-canvas-seed.yml; local-canvas-seed.rb loads it into Canvas.
#
# Like local-canvas.sh, the functions below run nothing when this file is
# sourced (the tests in local-canvas.test.sh do that); only running the file
# calls main.

SEED_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The Ruby that loads the data into Canvas sits next to this script; the data
# itself (courses, people, assignments, events) is YAML in the seed folder.
SEED_RUBY="$SEED_SCRIPTS_DIR/local-canvas-seed.rb"
SEED_DATA="${CUE_SEED_DATA:-$(cd "$SEED_SCRIPTS_DIR/.." && pwd)/seed/local-canvas-seed.yml}"
# shellcheck source=local-canvas.sh
. "$SEED_SCRIPTS_DIR/local-canvas.sh"

# True when Canvas's web container is running. (grep reads all of docker's
# output rather than stopping at the match, which under pipefail could fail
# docker with SIGPIPE.)
canvas_web_running() { # canvas_dir
  (cd "$1" && docker compose ps --status running --services 2>/dev/null) | grep -x web >/dev/null
}

# The Mac's time zone (e.g. America/Chicago), from /etc/localtime's link; UTC
# if it can't be told.
mac_time_zone() {
  local link
  link="$(readlink /etc/localtime 2>/dev/null)"
  case "$link" in
    */zoneinfo/?*) printf '%s\n' "${link#*/zoneinfo/}" ;;
    *) printf 'UTC\n' ;;
  esac
}

# Runs local-canvas-seed.rb in Canvas's web container, with the Mac's time
# zone and the YAML data on stdin (never the terminal's input), and prints
# what it prints. On failure, shows what Canvas said on stderr
# (its error, without the backtrace).
run_seed_ruby() { # canvas_dir
  local out err
  err="$(mktemp)"
  if ! out="$(cd "$1" && docker compose exec -T -e CUE_SEED_TZ="$(mac_time_zone)" web \
    bundle exec rails runner "$(cat "$SEED_RUBY")" 2>"$err" <"$SEED_DATA")"; then
    warn "Canvas couldn't add the demo data. What it said:"
    grep -v '^[[:space:]]*from ' "$err" | tail -n 5 >&2
    rm -f "$err"
    return 1
  fi
  rm -f "$err"
  printf '%s\n' "$out"
}

# Reads the Ruby's output on stdin and writes its CUE_ACCOUNT lines to <file>
# as CSV. The file is written in full beside <file> first (under umask 077, so
# never readable by others, even briefly), then moved over it. Without any
# account lines nothing is written and the old file stays as it was (returns 1
# for that; 2 when writing the file failed).
write_accounts_file() { # file
  local file="$1" rows tmp
  rows="$(awk -F '\t' 'BEGIN { OFS = "," } $1 == "CUE_ACCOUNT" { print $2, $3, $4, $5, $6, $7 }')"
  [ -n "$rows" ] || return 1
  mkdir -p "$(dirname "$file")" || return 2
  tmp="$(umask 077 && mktemp "$file.XXXXXX")" || return 2
  if printf 'role,name,email,password,canvas_user_id,courses\n%s\n' "$rows" >"$tmp" &&
    chmod 600 "$tmp" && mv -f "$tmp" "$file"; then
    return 0
  fi
  rm -f "$tmp"
  return 2
}

seed_main() {
  local file out counts code
  [ -f "$SEED_DATA" ] || die "Can't find the demo data: $SEED_DATA"
  find_canvas
  canvas_web_running "$CANVAS_DIR" || die "Canvas isn't running. Start it with: scripts/local-canvas.sh start"
  file="$(seed_accounts_file)"
  say "Adding demo courses and accounts (about a minute)..."
  out="$(run_seed_ruby "$CANVAS_DIR")" || exit 1
  printf '%s\n' "$out" | write_accounts_file "$file"
  code=$?
  case "$code" in
    0) ;;
    1) die "Canvas didn't list the demo accounts, so $file wasn't written." ;;
    *) die "Couldn't write $file." ;;
  esac
  counts="$(printf '%s\n' "$out" | awk -F '\t' '
    $1 == "CUE_COURSES" { courses = $2 }
    $1 == "CUE_ACCOUNT" && $2 == "teacher" { teachers++ }
    $1 == "CUE_ACCOUNT" && $2 == "student" { students++ }
    END { printf "%d courses, %d teachers, %d students", courses, teachers, students }
  ')"
  say "Demo data ready: $counts."
  say "Accounts and passwords: $file"
}

main() {
  if [ "$(id -u)" = "0" ]; then
    die "Please don't run this as root (or with sudo). It asks for your password when it needs it."
  fi
  seed_main
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -u -o pipefail
  main "$@"
fi
