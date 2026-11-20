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

# --- tools -------------------------------------------------------------------

# Makes Homebrew usable in this shell, installing it if the user agrees.
# Without Homebrew, ensure_tool prints manual steps instead of offering installs.
ensure_brew() {
  local prefix
  if ! command -v brew >/dev/null 2>&1; then
    for prefix in /opt/homebrew /usr/local; do
      if [ -x "$prefix/bin/brew" ]; then
        eval "$("$prefix/bin/brew" shellenv)"
        return 0
      fi
    done
  else
    return 0
  fi
  say "Homebrew (brew.sh) installs the other tools for you. It is not installed."
  if ask_yes_no "Install Homebrew with its official installer from brew.sh?"; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || return 1
    for prefix in /opt/homebrew /usr/local; do
      if [ -x "$prefix/bin/brew" ]; then
        eval "$("$prefix/bin/brew" shellenv)"
        return 0
      fi
    done
  fi
  say "Continuing without Homebrew; you'll be told how to install anything missing."
  return 1
}

# Succeeds when `<command> --version` works. Otherwise offers to install it with
# Homebrew; on No (or no Homebrew, or a failed install) prints the manual steps
# and fails.
ensure_tool() { # command brew-install-args manual-help
  local cmd="$1" brew_args="$2" help="$3"
  "$cmd" --version >/dev/null 2>&1 && return 0
  say "$cmd is not installed."
  if command -v brew >/dev/null 2>&1 && ask_yes_no "Install $cmd with Homebrew (brew install $brew_args)?"; then
    # brew_args is deliberately split into words (e.g. "--cask ngrok").
    # shellcheck disable=SC2086
    if brew install $brew_args && "$cmd" --version >/dev/null 2>&1; then
      return 0
    fi
    say "Installing $cmd did not work."
  fi
  say "$help"
  return 1
}

DOCKER_APP="/Applications/Docker.app"

# Docker Desktop: the app, and the docker command it brings.
ensure_docker_app() {
  if [ ! -d "$DOCKER_APP" ]; then
    ensure_tool docker "--cask docker-desktop" \
      "Install Docker Desktop from https://www.docker.com/products/docker-desktop/ , open it once, then run this again." ||
      return 1
  fi
  # Docker Desktop adds the docker command to PATH on first launch; until then use its own copy.
  if ! docker --version >/dev/null 2>&1 && [ -x "$DOCKER_APP/Contents/Resources/bin/docker" ]; then
    PATH="$PATH:$DOCKER_APP/Contents/Resources/bin"
  fi
  return 0
}

# Starts Docker Desktop if needed and waits up to <seconds> for it to answer.
wait_for_docker() { # seconds
  local limit="$1" waited=0
  docker info >/dev/null 2>&1 && return 0
  say "Starting Docker Desktop..."
  open -a Docker >/dev/null 2>&1 || true
  while [ "$waited" -lt "$limit" ]; do
    sleep 2
    waited=$((waited + 2))
    docker info >/dev/null 2>&1 && return 0
    if [ $((waited % 30)) -eq 0 ]; then
      say "Still waiting for Docker (${waited}s). If Docker Desktop is showing a message or moving its disk, this can take a while."
    fi
  done
  warn "Docker did not start within ${limit} seconds. Open Docker Desktop, deal with any message it shows, then run this again."
  return 1
}

# Canvas needs about 8 GB of memory in Docker. Docker reports a little less than
# the amount set, so anything from 7.5 GiB up counts.
check_docker_memory() {
  local bytes
  bytes="$(docker info --format '{{.MemTotal}}' 2>/dev/null)" || return 0
  case "$bytes" in '' | *[!0-9]*) return 0 ;; esac
  if [ "$bytes" -lt 8053063680 ]; then
    warn "Docker has about $((bytes / 1073741824)) GB of memory and Canvas needs 8 GB. In Docker Desktop open Settings > Resources, set Memory limit to 8 GB, and click Apply & restart."
    return 1
  fi
  return 0
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
