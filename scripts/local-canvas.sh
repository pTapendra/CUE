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

wait_for_enter() { # message
  local ignored
  printf '%s ' "$1" >&2
  IFS= read -r ignored || true
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

# --- disk space ----------------------------------------------------------------

CANVAS_REPO="https://github.com/instructure/canvas-lms.git"
# The Canvas version known to install and run with this script.
CANVAS_COMMIT="1c9f0bb8013ed69c4f2efe11fd483025469b7e6c"
# Measured: installing Canvas added about 11 GB to Docker's disk. 60 GB leaves
# room for Docker's build cache, logs and the database growing.
DOCKER_NEEDED_GB=60
FOLDER_NEEDED_GB=5
IMAGE_NAME="CueCanvas"

# Free space, in whole GB, on the drive holding <path> (or its nearest existing parent).
free_gb() { # path
  local p="$1"
  while [ ! -e "$p" ]; do p="$(dirname "$p")"; done
  df -Pk "$p" | awk 'NR == 2 { print int($4 / 1048576) }'
}

# Where Docker Desktop keeps its virtual disk on this Mac (Docker.raw), or
# nothing if it can't be found. Docker's settings file is privacy-protected,
# so this asks lsof which file the running Docker VM has open.
docker_disk_path() {
  lsof -nP -Fn 2>/dev/null | sed -n 's/^n\(.*\/Docker\.raw\)$/\1/p' | head -n 1
}

# Free space inside Docker's own disk, in whole GB (its size limit minus what it uses).
docker_room_gb() {
  docker run --rm busybox df -Pk / 2>/dev/null | awk 'NR == 2 { print int($4 / 1048576) }'
}

# Drives other than the startup disk, one path per line.
list_external_drives() { # [volumes_dir]
  local vols="${1:-/Volumes}" v
  for v in "$vols"/*; do
    [ -d "$v" ] || continue
    [ -L "$v" ] && continue # the startup disk appears as a link to /
    [ "$(basename "$v")" = "$IMAGE_NAME" ] && continue
    printf '%s\n' "$v"
  done
}

# Creates (or reuses) an APFS disk image on <drive>; prints its path. APFS inside
# the image works even when the drive itself is exFAT, and the image only takes
# up space as it fills.
create_disk_image() { # drive size_gb
  local image="$1/$IMAGE_NAME.sparsebundle"
  if [ ! -e "$image" ]; then
    hdiutil create -size "$2g" -type SPARSEBUNDLE -fs "Case-sensitive APFS" \
      -volname "$IMAGE_NAME" "$image" >/dev/null || return 1
  fi
  printf '%s\n' "$image"
}

# Mounts <image> (if it isn't already) and prints where it is mounted.
mount_disk_image() { # image
  local image="$1" mount
  if [ ! -e "$image" ]; then
    warn "Can't find the disk image $image. Is its drive plugged in?"
    return 1
  fi
  mount="$(hdiutil attach "$image" | awk -F '\t' '$NF ~ /^\/Volumes\// { print $NF }' | tail -n 1)"
  if [ -z "$mount" ]; then
    warn "Couldn't mount $image."
    return 1
  fi
  printf '%s\n' "$mount"
}

# --- install -----------------------------------------------------------------

# True when <dir> holds Canvas at the pinned version.
canvas_installed() { # dir
  [ "$(git -C "$1" rev-parse HEAD 2>/dev/null)" = "$CANVAS_COMMIT" ]
}

# Downloads Canvas at the pinned version into <dir>.
fetch_canvas() { # dir
  local dir="$1"
  if [ -d "$dir" ] && [ -n "$(ls -A "$dir" 2>/dev/null)" ] && [ ! -d "$dir/.git" ]; then
    warn "$dir already has other files in it. Choose an empty or new folder."
    return 1
  fi
  mkdir -p "$dir" || return 1
  git -C "$dir" init -q || return 1
  git -C "$dir" remote remove origin 2>/dev/null
  git -C "$dir" remote add origin "$CANVAS_REPO" || return 1
  say "Downloading Canvas (version ${CANVAS_COMMIT:0:8})..."
  git -C "$dir" fetch --depth 1 origin "$CANVAS_COMMIT" || return 1
  git -C "$dir" checkout -q -B master FETCH_HEAD
}

# Canvas's own setup: builds the images, creates the database and the admin
# account, and sets up http://canvas.docker. It asks its own questions.
run_canvas_setup() { # dir
  (cd "$1" && ./script/docker_dev_setup.sh)
}

# Lets the user pick an external drive; prints its path.
choose_drive() {
  local drives=() d i=1 pick
  while IFS= read -r d; do drives+=("$d"); done < <(list_external_drives)
  if [ "${#drives[@]}" -eq 0 ]; then
    warn "No external drive found. Plug one in, then run setup again."
    return 1
  fi
  say "Drives:" >&2
  for d in "${drives[@]}"; do
    say "  $i) $d ($(free_gb "$d") GB free)" >&2
    i=$((i + 1))
  done
  pick="$(ask_value "Which drive should hold Canvas and Docker's disk? Enter its number" "1")"
  case "$pick" in '' | *[!0-9]*) return 1 ;; esac
  [ "$pick" -ge 1 ] && [ "$pick" -le "${#drives[@]}" ] || return 1
  printf '%s\n' "${drives[$((pick - 1))]}"
}

# Moves Canvas and Docker's disk onto a disk image on an external drive.
# Sets DIR and IMAGE for cmd_setup.
use_external_drive() {
  local drive mount
  drive="$(choose_drive)" || return 1
  if [ "$(free_gb "$drive")" -lt "$DOCKER_NEEDED_GB" ]; then
    warn "$drive has only $(free_gb "$drive") GB free; Canvas needs about $DOCKER_NEEDED_GB GB."
    ask_yes_no "Use it anyway?" || return 1
  fi
  IMAGE="$(create_disk_image "$drive" 250)" || return 1
  mount="$(mount_disk_image "$IMAGE")" || return 1
  DIR="$mount/canvas-lms"
  mkdir -p "$mount/DockerDesktop"
  say "Canvas will go in $DIR (a disk image stored at $IMAGE)."
  say ""
  say "Now move Docker's disk onto the drive. In Docker Desktop:"
  say "  1. Open Settings (the gear icon) > Resources > Advanced."
  say "  2. Set \"Disk image location\" to: $mount/DockerDesktop"
  say "  3. Set \"Disk usage limit\" to 200 GB."
  say "  4. Click \"Apply & restart\"."
  say "Docker then copies its current disk to the drive, which can take a while."
  say "Don't unplug the drive or quit Docker while it does."
  wait_for_enter "Press Enter once you've clicked Apply & restart."
  wait_for_docker 3600 || return 1
  case "$(docker_disk_path)" in
    "$mount"/*) say "Docker's disk is on $drive now." ;;
    *)
      warn "Docker's disk doesn't seem to be on $mount yet."
      ask_yes_no "Continue anyway?" || return 1
      ;;
  esac
}

# --- commands ----------------------------------------------------------------

cmd_setup() {
  local missing=0 docker_disk docker_free room
  say "This installs Canvas in Docker on this Mac, for testing and demoing Cue."
  say ""
  ensure_brew
  ensure_tool git git "Install Apple's command line tools with: xcode-select --install" || missing=1
  ensure_docker_app || missing=1
  [ "$missing" -eq 0 ] || die "Install what's missing (see above), then run setup again."
  ensure_tool ngrok "--cask ngrok" "ngrok is only needed to reach Canvas from a phone. You can install it later from https://ngrok.com/download" ||
    say "Carrying on without ngrok."
  wait_for_docker 300 || exit 1
  if ! check_docker_memory; then
    ask_yes_no "Continue anyway?" || exit 1
  fi

  DIR="$HOME/canvas-lms"
  IMAGE=""
  if settings_load; then
    DIR="$CANVAS_DIR"
    IMAGE="$DISK_IMAGE"
    if [ -n "$IMAGE" ]; then mount_disk_image "$IMAGE" >/dev/null || exit 1; fi
  fi
  DIR="$(ask_value "Where should Canvas go?" "$DIR")"

  if canvas_installed "$DIR"; then
    say "Canvas is already downloaded in $DIR."
    if ask_yes_no "Run Canvas's own setup again? Say yes if the last setup didn't finish."; then
      run_canvas_setup "$DIR" || die "Canvas's setup stopped. Fix what it reports, then run setup again."
    fi
    settings_save "$DIR" "$IMAGE" || die "Couldn't save settings to $(settings_file)."
    say "Done. Start Canvas with: scripts/local-canvas.sh start"
    return 0
  fi

  # Space: Docker's disk is where Canvas really grows; the folder holds the code.
  docker_disk="$(docker_disk_path)"
  docker_free="$(free_gb "${docker_disk:-$HOME/Library/Containers}")"
  room="$(docker_room_gb)"
  if [ "$docker_free" -lt "$DOCKER_NEEDED_GB" ] || [ "$(free_gb "$DIR")" -lt "$FOLDER_NEEDED_GB" ]; then
    say "Canvas needs about $DOCKER_NEEDED_GB GB for Docker; the drive Docker uses has $docker_free GB free."
    if ask_yes_no "Put Canvas and Docker's disk on an external drive instead?"; then
      use_external_drive || die "Couldn't set up the external drive."
      room="$(docker_room_gb)"
    elif ! ask_yes_no "Continue on this drive anyway?"; then
      exit 1
    fi
  fi
  if [ -n "$room" ] && [ "$room" -lt "$DOCKER_NEEDED_GB" ]; then
    say "Docker's disk has room for only $room GB more. In Docker Desktop open Settings > Resources > Advanced, set \"Disk usage limit\" to 200 GB, and click Apply & restart."
    wait_for_enter "Press Enter when that's done."
    wait_for_docker 600 || exit 1
  fi

  say ""
  say "Installing Canvas takes an hour or more. Canvas's own setup will ask a few"
  say "questions, including an email and password for the Canvas admin account."
  ask_yes_no "Start now?" || exit 0
  fetch_canvas "$DIR" || die "Couldn't download Canvas."
  settings_save "$DIR" "$IMAGE" || die "Couldn't save settings to $(settings_file)."
  run_canvas_setup "$DIR" || die "Canvas's setup stopped. Fix what it reports, then run setup again."
  say ""
  say "Canvas is installed. On this Mac it's at http://canvas.docker"
  say "From now on, start it with: scripts/local-canvas.sh start"
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
