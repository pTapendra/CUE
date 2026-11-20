#!/bin/bash
# Runs a local Canvas in Docker for testing and demoing Cue, and can make it
# reachable from a phone through ngrok. macOS only.
#
#   scripts/local-canvas.sh setup   first time: check tools, install Canvas
#   scripts/local-canvas.sh start   start Canvas; optionally expose it via ngrok
#   scripts/local-canvas.sh stop    stop Canvas
#
# The functions below run nothing when this file is sourced (the tests in
# local-canvas.test.sh do that); only running the file calls main.

# --- output and prompts ------------------------------------------------------

say() { printf '%s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

# Asks a yes/no question on stderr and reads the answer from stdin.
# Succeeds only for y or yes (any case); anything else, or no input, is No.
ask_yes_no() {
  local answer=""
  printf '%s [y/N] ' "$1" >&2
  IFS= read -r answer || [ -n "$answer" ] || return 1
  case "$answer" in
    [yY] | [yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

# Asks for a value, showing the default; prints the answer, or the default
# when the answer is empty. A leading ~/ becomes the home folder.
ask_value() {
  local answer=""
  printf '%s [%s] ' "$1" "$2" >&2
  IFS= read -r answer || true
  [ -n "$answer" ] || answer="$2"
  case "$answer" in
    "~") answer="$HOME" ;;
    "~/"*) answer="$HOME/${answer#"~/"}" ;;
  esac
  printf '%s\n' "$answer"
}

# --- settings ----------------------------------------------------------------
# Where setup put Canvas, so start and stop can find it again.

settings_file() {
  printf '%s\n' "${CUE_LOCAL_CANVAS_SETTINGS:-$HOME/.config/cue/local-canvas.conf}"
}

settings_save() { # canvas_dir disk_image
  local file
  file="$(settings_file)"
  mkdir -p "$(dirname "$file")" || return 1
  printf 'CANVAS_DIR=%s\nDISK_IMAGE=%s\n' "$1" "$2" >"$file"
}

# Sets CANVAS_DIR and DISK_IMAGE. Reads the values as plain text, never runs them.
settings_load() {
  local file line
  file="$(settings_file)"
  [ -f "$file" ] || return 1
  CANVAS_DIR=""
  DISK_IMAGE=""
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      CANVAS_DIR=*) CANVAS_DIR="${line#CANVAS_DIR=}" ;;
      DISK_IMAGE=*) DISK_IMAGE="${line#DISK_IMAGE=}" ;;
    esac
  done <"$file"
  [ -n "$CANVAS_DIR" ]
}

# --- command line ------------------------------------------------------------

usage() {
  cat >&2 <<'EOF'
Usage: scripts/local-canvas.sh <command>

  setup   First time: check the tools you need, then install Canvas in Docker.
          Takes an hour or more.
  start   Start Canvas. Asks whether to make it reachable from a phone
          through ngrok.
  stop    Stop Canvas.
EOF
}

main() {
  if [ "$(id -u)" = "0" ]; then
    die "Please don't run this as root (or with sudo). It asks for your password when it needs it."
  fi
  case "${1:-}" in
    setup | start | stop)
      [ "$(uname)" = "Darwin" ] || die "This script is for macOS."
      "cmd_$1"
      ;;
    *)
      usage
      exit 2
      ;;
  esac
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -u -o pipefail
  main "$@"
fi
