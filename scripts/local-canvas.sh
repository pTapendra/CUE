#!/bin/bash
# Runs a local Canvas in Docker for testing and demoing Cue, and can make it
# reachable from a phone through ngrok. With ngrok it also sets up Canvas login
# for Cue, in server/.env of this checkout. macOS only.
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

# Like ask_value, but keeps asking until the answer is a full path, so a folder
# never ends up relative to wherever the script happened to be run from.
ask_folder() { # question default
  local answer
  while :; do
    answer="$(ask_value "$1" "$2")"
    case "$answer" in /*)
      printf '%s\n' "$answer"
      return 0
      ;;
    esac
    say "Please enter a full path, like $2 or ~/canvas-lms." >&2
  done
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
  mount="$(hdiutil attach "$image" | awk -F '\t' 'NF >= 3 && $NF ~ /^\// { print $NF }' | tail -n 1)"
  if [ -z "$mount" ]; then
    warn "Couldn't mount $image."
    return 1
  fi
  printf '%s\n' "$mount"
}

# The mounted disk image that holds <dir>, or nothing. Lets setup remember an
# image for a Canvas that was put on one before this script existed.
disk_image_for() { # dir
  hdiutil info 2>/dev/null | awk -F '\t' -v dir="$1" '
    /^image-path[[:space:]]*: / { image = $0; sub(/^image-path[[:space:]]*: /, "", image); next }
    $NF ~ /^\/Volumes\// {
      m = $NF
      if (dir == m || index(dir, m "/") == 1) { print image; exit }
    }
  '
}

# --- install -----------------------------------------------------------------

# True when <dir> holds Canvas at the pinned version.
canvas_installed() { # dir
  [ "$(git -C "$1" rev-parse HEAD 2>/dev/null)" = "$CANVAS_COMMIT" ]
}

# Downloads Canvas at the pinned version into <dir>.
fetch_canvas() { # dir
  local dir="$1"
  if [ -d "$dir/.git" ]; then
    # Only carry on with a download this script started and didn't finish;
    # never repoint or reset someone's own checkout.
    if [ "$(git -C "$dir" remote get-url origin 2>/dev/null)" != "$CANVAS_REPO" ] ||
      git -C "$dir" rev-parse -q --verify HEAD >/dev/null 2>&1; then
      warn "$dir already holds a different git checkout. Choose an empty or new folder."
      return 1
    fi
  elif [ -d "$dir" ] && [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then
    warn "$dir already has other files in it. Choose an empty or new folder."
    return 1
  fi
  mkdir -p "$dir" || return 1
  git -C "$dir" init -q || return 1
  git -C "$dir" remote get-url origin >/dev/null 2>&1 ||
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
  say "  4. In Settings > General, turn off \"Start Docker Desktop when you sign in\"."
  say "     Docker must not start before the drive is mounted; from now on start"
  say "     Canvas with scripts/local-canvas.sh start, which mounts it first."
  say "  5. Click \"Apply & restart\"."
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

# --- ngrok -------------------------------------------------------------------

NGROK_COMPOSE_FILE="docker-compose.cue-ngrok.yml"
CANVAS_PORT=8080

ngrok_config_path() {
  local path
  path="$(ngrok config check 2>&1 | sed -n 's/.*configuration file at //p' | head -n 1)"
  printf '%s\n' "${path:-$HOME/Library/Application Support/ngrok/ngrok.yml}"
}

# True when the ngrok config file has an authtoken.
ngrok_has_token() { # config_path
  [ -f "$1" ] || return 1
  grep -Eq '^[[:space:]]*authtoken:[[:space:]]*[^[:space:]]' "$1"
}

# Reads ngrok's /api/tunnels JSON on stdin; prints the first https address.
ngrok_url_from_json() {
  grep -o '"public_url": *"https://[^"]*"' | head -n 1 | sed 's/.*"\(https:[^"]*\)"$/\1/'
}

# Canvas settings that let ngrok's address through: Canvas accepts the
# address, and its web server is published on 127.0.0.1 only, for ngrok.
write_ngrok_compose() { # canvas_dir host
  cat >"$1/$NGROK_COMPOSE_FILE" <<EOF
# Written by Cue's scripts/local-canvas.sh so a phone can reach this Canvas
# through ngrok. Rewritten on every start with ngrok. To undo, delete this
# file; the next start or stop also takes it out of COMPOSE_FILE in .env.
services:
  web:
    environment:
      ADDITIONAL_ALLOWED_HOSTS: $2
    ports:
      - "127.0.0.1:$CANVAS_PORT:80"
EOF
}

# Adds <name> to COMPOSE_FILE in Canvas's .env, once, so every docker compose
# command in the Canvas folder uses it.
include_compose_file() { # env_file name
  local env="$1" name="$2" default="docker-compose.yml:docker-compose.override.yml" tmp
  if [ ! -f "$env" ] || ! grep -q '^COMPOSE_FILE=' "$env"; then
    printf 'COMPOSE_FILE=%s:%s\n' "$default" "$name" >>"$env"
    return
  fi
  tmp="$(mktemp)"
  awk -v name="$name" '
    /^COMPOSE_FILE=/ {
      n = split(substr($0, 14), parts, ":")
      for (i = 1; i <= n; i++) if (parts[i] == name) { print; next }
      print $0 ":" name
      next
    }
    { print }
  ' "$env" >"$tmp" && cat "$tmp" >"$env"
  rm -f "$tmp"
}

# If the ngrok compose file was deleted, takes it out of COMPOSE_FILE too:
# docker compose fails on every command when a listed file is missing.
drop_missing_ngrok_compose() { # canvas_dir
  local env="$1/.env" tmp
  [ -f "$1/$NGROK_COMPOSE_FILE" ] && return 0
  [ -f "$env" ] || return 0
  grep -q "^COMPOSE_FILE=.*$NGROK_COMPOSE_FILE" "$env" || return 0
  tmp="$(mktemp)"
  awk -v name="$NGROK_COMPOSE_FILE" '
    /^COMPOSE_FILE=/ {
      n = split(substr($0, 14), parts, ":")
      out = ""
      for (i = 1; i <= n; i++) if (parts[i] != name) out = out (out == "" ? "" : ":") parts[i]
      print "COMPOSE_FILE=" out
      next
    }
    { print }
  ' "$env" >"$tmp" && cat "$tmp" >"$env"
  rm -f "$tmp"
}

# The program, other than Docker, listening on <port> on this Mac; nothing if
# the port is free or Docker (Canvas itself) holds it.
port_user() { # port
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -Fc 2>/dev/null | sed -n 's/^c//p' | grep -v '^com\.docker' | head -n 1
}

require_free_port() {
  local user
  user="$(port_user "$CANVAS_PORT")"
  [ -z "$user" ] ||
    die "Port $CANVAS_PORT is in use by $user. Canvas needs it for ngrok: quit $user, then run start again."
}

# Starts ngrok in the background, forwarding to Canvas. Sets NGROK_PID,
# NGROK_URL and NGROK_LOG. Fails with ngrok's own message if it stops.
start_ngrok() {
  local waited=0
  NGROK_URL=""
  if pgrep -x ngrok >/dev/null 2>&1; then
    warn "ngrok is already running. A free ngrok account allows one at a time: stop the other one (Ctrl+C in its window), then run start again."
    return 1
  fi
  NGROK_LOG="$(mktemp)"
  ngrok http "127.0.0.1:$CANVAS_PORT" --log stdout --log-format logfmt >"$NGROK_LOG" 2>&1 &
  NGROK_PID=$!
  while [ "$waited" -lt 20 ]; do
    if ! kill -0 "$NGROK_PID" 2>/dev/null; then
      warn "ngrok stopped. What it said:"
      tail -n 5 "$NGROK_LOG" >&2
      return 1
    fi
    NGROK_URL="$(curl -s -m 2 "http://127.0.0.1:4040/api/tunnels" 2>/dev/null | ngrok_url_from_json)"
    [ -n "$NGROK_URL" ] && return 0
    sleep 1
    waited=$((waited + 1))
  done
  warn "ngrok didn't report an address within 20 seconds. What it said:"
  tail -n 5 "$NGROK_LOG" >&2
  stop_ngrok
  return 1
}

stop_ngrok() {
  [ -n "${NGROK_PID:-}" ] && kill "$NGROK_PID" 2>/dev/null
  NGROK_PID=""
}

# Waits up to <seconds> (default 300) for Canvas to answer at <url>.
wait_for_canvas() { # url [seconds]
  local url="$1" limit="${2:-300}" waited=0
  while [ "$waited" -lt "$limit" ]; do
    [ "$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$url/health_check" 2>/dev/null)" = "200" ] && return 0
    sleep 2
    waited=$((waited + 2))
  done
  warn "Canvas didn't answer at $url within ${limit} seconds."
  return 1
}

# Makes sure ngrok is installed and has the user's authtoken. The token is
# read without showing it and is never printed.
ensure_ngrok_ready() {
  local token=""
  if ! ngrok --version >/dev/null 2>&1; then ensure_brew; fi
  ensure_tool ngrok "--cask ngrok" "Install ngrok from https://ngrok.com/download, then run start again." || return 1
  ngrok_has_token "$(ngrok_config_path)" && return 0
  say "ngrok needs your own account's authtoken (a free account is enough)."
  say "Log in at https://dashboard.ngrok.com and copy it from \"Your Authtoken\"."
  printf 'Paste your authtoken (it will not be shown): ' >&2
  IFS= read -rs token || true
  printf '\n' >&2
  [ -n "$token" ] || return 1
  ngrok config add-authtoken "$token" >/dev/null || {
    warn "ngrok didn't accept that token."
    return 1
  }
}

# Exposes Canvas through ngrok, then waits until ngrok ends or Ctrl+C.
expose_with_ngrok() {
  ensure_ngrok_ready || die "ngrok isn't ready, so Canvas stays on this Mac only (http://canvas.docker)."
  require_free_port
  # ngrok runs in the background, where Ctrl+C doesn't reach it: stop it
  # whenever this script ends, however it ends, so Canvas never stays exposed.
  trap stop_ngrok EXIT
  trap 'exit 130' INT TERM
  start_ngrok || exit 1
  local host="${NGROK_URL#https://}"
  write_ngrok_compose "$CANVAS_DIR" "$host"
  include_compose_file "$CANVAS_DIR/.env" "$NGROK_COMPOSE_FILE"
  say "Letting Canvas accept $NGROK_URL ..."
  if ! (cd "$CANVAS_DIR" && docker compose up -d --no-deps web); then
    stop_ngrok
    die "Couldn't restart Canvas's web container."
  fi
  say "Waiting for Canvas to answer there (a minute or two after a restart)..."
  if ! wait_for_canvas "$NGROK_URL"; then
    stop_ngrok
    die "Canvas isn't answering through ngrok. Check http://canvas.docker on this Mac, then run start again."
  fi
  ensure_cue_login "$CANVAS_DIR" "$NGROK_URL"
  trap 'stop_ngrok; say ""; say "ngrok stopped: Canvas is off the internet, and still running on this Mac (http://canvas.docker)."; exit 0' INT TERM
  say ""
  say "Canvas is reachable from your phone at:"
  say ""
  say "    $NGROK_URL"
  say ""
  say "Students connect from Cue's Connect screen with \"Log in with Canvas\"."
  say "The first time a phone opens Canvas, ngrok shows a warning page: tap \"Visit Site\"."
  say "Keep this window open. Press Ctrl+C to take Canvas off the internet."
  wait "$NGROK_PID"
  warn "ngrok stopped by itself. What it said:"
  tail -n 5 "$NGROK_LOG" >&2
  exit 1
}

# --- Canvas login for Cue ----------------------------------------------------
# With ngrok, start creates Canvas's developer key for Cue and writes the login
# settings into server/.env of this checkout. The secrets in that file (the
# key's secret, CUE_SECRET_KEY) are never printed.

# The scopes Cue's login asks for: read courses, assignments and calendar events.
CUE_SCOPES="url:GET|/api/v1/courses url:GET|/api/v1/courses/:course_id/assignments url:GET|/api/v1/calendar_events"

# Run by rails runner in Canvas's web container. Reuses the key named Cue on the
# root account (deleted keys don't count; a deactivated one is made active
# again), keeps Canvas's default of expiring tokens, and turns the key on for
# the root account. Prints its id and secret.
CUE_KEY_RUBY='
key = DeveloperKey.nondeleted.find_or_initialize_by(name: "Cue", account: Account.default)
key.workflow_state = "active"
key.require_scopes = true
key.scopes = %w['"$CUE_SCOPES"']
key.save!
key.developer_key_account_bindings.find_or_initialize_by(account: Account.default).update!(workflow_state: "on")
puts "CUE_KEY #{key.global_id} #{key.api_key}"
'

# This checkout's folder: the parent of the folder holding this script.
repo_dir() {
  (cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
}

server_env_file() {
  printf '%s\n' "${CUE_SERVER_ENV:-$(repo_dir)/server/.env}"
}

# Prints the value of the KEY= line (the last one, as Node reads it), or
# nothing. Commented lines don't count.
env_get() { # file key
  [ -f "$1" ] || return 0
  CUE_ENV_KEY="$2" awk '
    BEGIN { key = ENVIRON["CUE_ENV_KEY"] "=" }
    index($0, key) == 1 { value = substr($0, length(key) + 1); found = 1 }
    END { if (found) print value }
  ' "$1"
}

# Replaces the KEY= line (every one, if repeated) with KEY=VALUE, or appends it;
# every other line stays as it is, in order. The value reaches awk through the
# environment, where nothing in it (/ + = & \) is treated specially.
env_set() { # file key value
  local file="$1" tmp status
  tmp="$(mktemp)" || return 1
  CUE_ENV_KEY="$2" CUE_ENV_VALUE="$3" awk '
    BEGIN { key = ENVIRON["CUE_ENV_KEY"] "="; line = key ENVIRON["CUE_ENV_VALUE"] }
    index($0, key) == 1 { print line; done = 1; next }
    { print }
    END { if (!done) print line }
  ' "$file" >"$tmp" && cat "$tmp" >"$file"
  status=$?
  rm -f "$tmp"
  return "$status"
}

# Creates server/.env from server/.env.example if there isn't one, readable by
# this user only since it holds secrets, and gives it a CUE_SECRET_KEY (32
# random bytes, base64) if it has none, so saved Canvas tokens stay readable
# after Cue's server restarts. An existing file's permissions are left alone.
ensure_server_env() {
  local file key
  file="$(server_env_file)"
  if [ ! -f "$file" ]; then
    cp "$(repo_dir)/server/.env.example" "$file" && chmod 600 "$file" || return 1
  fi
  [ -n "$(env_get "$file" CUE_SECRET_KEY)" ] && return 0
  key="$(openssl rand -base64 32)" && [ -n "$key" ] || return 1
  env_set "$file" CUE_SECRET_KEY "$key"
}

# Fails only when Canvas answers 401, its answer for a client id it doesn't know.
cue_key_known() { # canvas_url client_id
  [ "$(curl -s -o /dev/null -m 10 -w '%{http_code}' \
    "$1/login/oauth2/auth?client_id=$2&response_type=code&redirect_uri=urn:ietf:wg:oauth:2.0:oob" 2>/dev/null)" != "401" ]
}

# Finds or creates the key in the running Canvas; prints "<client id> <secret>"
# for the caller to capture. Canvas's output holds the secret, so it is parsed,
# never shown. On failure, shows what Canvas said on stderr (its error, without
# the backtrace).
create_cue_developer_key() { # canvas_dir
  local out err key
  err="$(mktemp)"
  if ! out="$(cd "$1" && docker compose exec -T web bundle exec rails runner "$CUE_KEY_RUBY" 2>"$err")"; then
    warn "Canvas couldn't create its developer key for Cue. What it said:"
    grep -v '^[[:space:]]*from ' "$err" | tail -n 5 >&2
    rm -f "$err"
    return 1
  fi
  rm -f "$err"
  key="$(printf '%s\n' "$out" | sed -n 's/^CUE_KEY \([0-9][0-9]*\) \([^ ][^ ]*\)$/\1 \2/p' | head -n 1)"
  [ -n "$key" ] || return 1
  printf '%s\n' "$key"
}

# Sets up Canvas login for Cue, unless server/.env already has it for this
# address and Canvas still knows the key. A failure only warns: Canvas stays up.
ensure_cue_login() { # canvas_dir ngrok_url
  local file id creds
  if ensure_server_env; then
    file="$(server_env_file)"
    id="$(env_get "$file" CUE_CANVAS_CLIENT_ID)"
    if [ "$(env_get "$file" CUE_CANVAS_URL)" = "$2" ] && [ -n "$id" ] &&
      [ -n "$(env_get "$file" CUE_CANVAS_CLIENT_SECRET)" ] && cue_key_known "$2" "$id"; then
      say "Canvas login for Cue is already set up."
      return 0
    fi
    say "Setting up Canvas login for Cue (about a minute)..."
    if creds="$(create_cue_developer_key "$1")" &&
      env_set "$file" CUE_CANVAS_URL "$2" &&
      env_set "$file" CUE_CANVAS_CLIENT_ID "${creds%% *}" &&
      env_set "$file" CUE_CANVAS_CLIENT_SECRET "${creds#* }"; then
      say "Restart Cue's server so it picks up Canvas login."
      return 0
    fi
  fi
  warn "Couldn't set up Canvas login for Cue. Students can still connect with an access token."
  return 0
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

  DIR="$HOME/canvas-lms"
  IMAGE=""
  DISK_IMAGE=""
  if settings_load; then
    DIR="$CANVAS_DIR"
    IMAGE="$DISK_IMAGE"
  fi
  mount_recorded_image # before Docker starts: its disk may be on that image
  wait_for_docker 300 || exit 1
  check_docker_disk_on_image "$DISK_MOUNT"
  if ! check_docker_memory; then
    ask_yes_no "Continue anyway?" || exit 1
  fi

  DIR="$(ask_folder "Where should Canvas go?" "$DIR")"
  [ -n "$IMAGE" ] || IMAGE="$(disk_image_for "$DIR")"

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

# Mounts the disk image named in the settings, if any, and sets DISK_MOUNT.
# Dies when its drive isn't plugged in, before anything starts Docker.
mount_recorded_image() {
  DISK_MOUNT=""
  [ -n "$DISK_IMAGE" ] || return 0
  DISK_MOUNT="$(mount_disk_image "$DISK_IMAGE")" ||
    die "Plug in the drive that holds $DISK_IMAGE, then try again. Docker keeps its disk there too, so don't start Docker without it."
}

# With setup's external-drive layout (Docker's disk in <mount>/DockerDesktop),
# Docker must be using that disk. If Docker Desktop started before the drive
# was mounted (at login, say) it isn't, and Canvas would seem to be missing.
check_docker_disk_on_image() { # mount
  local mount="$1" disk
  [ -n "$mount" ] && [ -d "$mount/DockerDesktop" ] || return 0
  disk="$(docker_disk_path)"
  [ -n "$disk" ] || return 0 # can't tell; carry on
  case "$disk" in "$mount"/*) return 0 ;; esac
  warn "Docker Desktop is using the disk at $disk, not the one on your drive ($mount/DockerDesktop). It probably started before the drive was mounted."
  die "Quit Docker Desktop (whale icon in the menu bar > Quit Docker Desktop), then run this again: it mounts the drive before starting Docker."
}

# Loads the settings and mounts the disk image, without touching Docker.
find_canvas() {
  settings_load || die "Canvas isn't set up on this Mac yet. Run: scripts/local-canvas.sh setup"
  mount_recorded_image
  [ -d "$CANVAS_DIR" ] || die "Can't find Canvas in $CANVAS_DIR. Run: scripts/local-canvas.sh setup"
  drop_missing_ngrok_compose "$CANVAS_DIR"
}

cmd_start() {
  find_canvas
  ensure_docker_app || exit 1
  wait_for_docker 300 || exit 1
  check_docker_disk_on_image "$DISK_MOUNT"
  # A compose file from an earlier ngrok run publishes the port on every start.
  [ -f "$CANVAS_DIR/$NGROK_COMPOSE_FILE" ] && require_free_port
  say "Starting Canvas..."
  # Only the web container (Docker starts the database and Redis with it), as
  # Canvas's own setup does. The rest, like webpack's file watcher, is for
  # working on Canvas itself and costs a lot of CPU.
  (cd "$CANVAS_DIR" && docker compose up -d web) || die "Couldn't start Canvas's containers."
  if ask_yes_no "Make Canvas reachable from a phone through ngrok?"; then
    expose_with_ngrok
  else
    say "Canvas is running at http://canvas.docker (this Mac only)."
    say "Stop it with: scripts/local-canvas.sh stop"
  fi
}

cmd_stop() {
  find_canvas
  if ! docker info >/dev/null 2>&1; then
    say "Docker isn't running, so Canvas isn't either."
    return 0
  fi
  (cd "$CANVAS_DIR" && docker compose stop) || die "Couldn't stop Canvas's containers."
  say "Canvas stopped."
}

# --- command line ------------------------------------------------------------

usage() {
  cat >&2 <<'EOF'
Usage: scripts/local-canvas.sh <command>

  setup   First time: check the tools you need, then install Canvas in Docker.
          Takes an hour or more.
  start   Start Canvas. Asks whether to make it reachable from a phone
          through ngrok; with ngrok it also sets up Canvas login for Cue.
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
