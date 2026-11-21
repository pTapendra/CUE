#!/bin/bash
# Tests for scripts/local-canvas.sh and scripts/local-canvas-seed.sh.
# Run: bash scripts/local-canvas.test.sh
# Each test_* function runs in its own subshell, with a fresh temp folder in $T.

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/local-canvas.sh"
SEED_SCRIPT="$HERE/local-canvas-seed.sh"
# shellcheck source=local-canvas.sh
. "$SCRIPT"
# shellcheck source=local-canvas-seed.sh
. "$SEED_SCRIPT"

FAILED=0

assert_eq() { # name expected actual
  if [ "$2" != "$3" ]; then
    echo "  FAIL $1: expected [$2], got [$3]"
    FAILED=1
  fi
}

assert_true() { # name command...
  local name="$1"
  shift
  if ! "$@"; then
    echo "  FAIL $name: expected success: $*"
    FAILED=1
  fi
}

assert_false() { # name command...  (exit status must be exactly 1, so "command not found" does not count)
  local name="$1" code
  shift
  "$@"
  code=$?
  if [ "$code" -ne 1 ]; then
    echo "  FAIL $name: expected exit 1, got $code: $*"
    FAILED=1
  fi
}

assert_contains() { # name needle haystack
  case "$3" in
    *"$2"*) ;;
    *)
      echo "  FAIL $1: [$2] not found in: $3"
      FAILED=1
      ;;
  esac
}

# Puts a stub command first on PATH. Usage: stub <name> <body>
stub() {
  mkdir -p "$T/bin"
  printf '#!/bin/bash\n%s\n' "$2" >"$T/bin/$1"
  chmod +x "$T/bin/$1"
  PATH="$T/bin:$PATH"
}

# --- prompts ---------------------------------------------------------------

test_ask_yes_no_accepts_yes() {
  assert_true "y" ask_yes_no "Go?" <<<"y"
  assert_true "Y" ask_yes_no "Go?" <<<"Y"
  assert_true "yes" ask_yes_no "Go?" <<<"yes"
  assert_true "YES" ask_yes_no "Go?" <<<"YES"
}

test_ask_yes_no_defaults_to_no() {
  assert_false "empty" ask_yes_no "Go?" <<<""
  assert_false "n" ask_yes_no "Go?" <<<"n"
  assert_false "nope" ask_yes_no "Go?" <<<"nope"
  assert_false "end of input" ask_yes_no "Go?" </dev/null
}

test_ask_value_returns_answer_or_default() {
  assert_eq "default" "/default/dir" "$(ask_value "Folder?" "/default/dir" <<<"" 2>/dev/null)"
  assert_eq "answer" "/my/dir" "$(ask_value "Folder?" "/default/dir" <<<"/my/dir" 2>/dev/null)"
}

test_ask_value_expands_home() {
  assert_eq "tilde path" "$HOME/canvas" "$(ask_value "Folder?" "/d" <<<"~/canvas" 2>/dev/null)"
}

# --- settings --------------------------------------------------------------

test_settings_round_trip() {
  export CUE_LOCAL_CANVAS_SETTINGS="$T/conf/local-canvas.conf"
  settings_save "/Volumes/My Drive/canvas-lms" "/Volumes/My Drive/CueCanvas.sparsebundle"
  CANVAS_DIR="" DISK_IMAGE=""
  assert_true "load" settings_load
  assert_eq "canvas dir" "/Volumes/My Drive/canvas-lms" "$CANVAS_DIR"
  assert_eq "disk image" "/Volumes/My Drive/CueCanvas.sparsebundle" "$DISK_IMAGE"
}

test_settings_round_trip_without_disk_image() {
  export CUE_LOCAL_CANVAS_SETTINGS="$T/local-canvas.conf"
  settings_save "$HOME/canvas-lms" ""
  CANVAS_DIR="x" DISK_IMAGE="x"
  settings_load
  assert_eq "canvas dir" "$HOME/canvas-lms" "$CANVAS_DIR"
  assert_eq "disk image" "" "$DISK_IMAGE"
}

test_settings_load_reads_text_and_never_runs_it() {
  export CUE_LOCAL_CANVAS_SETTINGS="$T/local-canvas.conf"
  printf 'CANVAS_DIR=$(touch %s/ran)\nDISK_IMAGE=`touch %s/ran2`\n' "$T" "$T" >"$CUE_LOCAL_CANVAS_SETTINGS"
  settings_load
  assert_eq "literal" "\$(touch $T/ran)" "$CANVAS_DIR"
  assert_false "not run" test -e "$T/ran"
  assert_false "not run 2" test -e "$T/ran2"
}

test_settings_load_without_file_fails() {
  export CUE_LOCAL_CANVAS_SETTINGS="$T/missing.conf"
  assert_false "no file" settings_load
}

# --- command line ----------------------------------------------------------

test_no_command_prints_usage() {
  local out code
  out="$(bash "$SCRIPT" 2>&1)"
  code=$?
  assert_eq "exit code" "2" "$code"
  assert_contains "usage" "Usage" "$out"
  assert_contains "lists setup" "setup" "$out"
}

test_unknown_command_prints_usage() {
  local out code
  out="$(bash "$SCRIPT" frobnicate 2>&1)"
  code=$?
  assert_eq "exit code" "2" "$code"
  assert_contains "usage" "Usage" "$out"
}

test_refuses_to_run_as_root() {
  stub id 'echo 0'
  local out code
  out="$(PATH="$PATH" bash "$SCRIPT" setup 2>&1)"
  code=$?
  assert_eq "exit code" "1" "$code"
  assert_contains "message" "root" "$out"
}

# --- tools -----------------------------------------------------------------

# Runs ensure_tool with the given stdin; sets CODE and OUT.
run_ensure_tool() { # answer args...
  local answer="$1"
  shift
  ensure_tool "$@" <<<"$answer" >"$T/out" 2>&1
  CODE=$?
  OUT="$(cat "$T/out")"
}

test_ensure_tool_present_asks_nothing() {
  stub cue-tool 'exit 0'
  stub brew 'echo "$*" >>"$T/brew.log"'
  run_ensure_tool "" cue-tool "--cask cue-tool" "Install cue-tool by hand."
  assert_eq "status" "0" "$CODE"
  assert_eq "no output" "" "$OUT"
  assert_false "brew not called" test -e "$T/brew.log"
}

test_ensure_tool_missing_and_declined_prints_help() {
  stub brew 'echo "$*" >>"$T/brew.log"'
  run_ensure_tool "n" cue-missing-tool "--cask cue-missing-tool" "Install cue-missing-tool from example.com."
  assert_eq "status" "1" "$CODE"
  assert_contains "asked" "Install cue-missing-tool with Homebrew" "$OUT"
  assert_contains "help" "Install cue-missing-tool from example.com." "$OUT"
  assert_false "brew not called" test -e "$T/brew.log"
}

test_ensure_tool_missing_and_accepted_installs_with_brew() {
  stub brew 'echo "$*" >>"$T/brew.log"
printf "#!/bin/bash\nexit 0\n" >"$T/bin/cue-missing-tool"
chmod +x "$T/bin/cue-missing-tool"'
  run_ensure_tool "y" cue-missing-tool "--cask cue-missing-tool" "help"
  assert_eq "status" "0" "$CODE"
  assert_eq "brew args" "install --cask cue-missing-tool" "$(cat "$T/brew.log")"
}

test_ensure_tool_install_failure_prints_help() {
  stub brew 'exit 1'
  run_ensure_tool "y" cue-missing-tool "cue-missing-tool" "Install it from example.com."
  assert_eq "status" "1" "$CODE"
  assert_contains "help" "Install it from example.com." "$OUT"
}

test_ensure_tool_without_brew_prints_help_without_asking() {
  mkdir -p "$T/bin"
  PATH="$T/bin:/usr/bin:/bin"
  run_ensure_tool "y" cue-missing-tool "cue-missing-tool" "Install it from example.com."
  assert_eq "status" "1" "$CODE"
  assert_contains "help" "Install it from example.com." "$OUT"
  case "$OUT" in *"with Homebrew"*) assert_eq "did not ask" "no question" "asked about Homebrew" ;; esac
}

test_wait_for_docker_gives_up_after_the_limit() {
  stub docker 'exit 1'
  stub open 'touch "$T/opened"'
  SECONDS=0
  wait_for_docker 2 >"$T/out" 2>&1
  local code=$? elapsed=$SECONDS
  assert_eq "status" "1" "$code"
  assert_true "opened Docker Desktop" test -e "$T/opened"
  assert_true "bounded wait" test "$elapsed" -le 6
  assert_contains "message" "Docker did not start" "$(cat "$T/out")"
}

test_wait_for_docker_returns_at_once_when_running() {
  stub docker 'exit 0'
  stub open 'touch "$T/opened"'
  assert_true "running" wait_for_docker 2
  assert_false "did not open" test -e "$T/opened"
}

test_check_docker_memory() {
  stub docker 'echo 4294967296'
  check_docker_memory 2>"$T/err"
  assert_eq "4 GB is too little" "1" "$?"
  assert_contains "says how much" "8 GB" "$(cat "$T/err")"
  stub docker 'echo 8573517824'
  assert_true "8 GB set is enough" check_docker_memory
}

# --- disk space and install ------------------------------------------------

is_whole_number() { case "$1" in '' | *[!0-9]*) return 1 ;; *) return 0 ;; esac }

test_free_gb_is_a_whole_number() {
  assert_true "startup disk" is_whole_number "$(free_gb /)"
  assert_true "folder not made yet" is_whole_number "$(free_gb "$HOME/cue-not-made-yet/canvas-lms")"
}

test_docker_disk_path_handles_spaces() {
  stub lsof 'printf "p123\nfcwd\nn/\np456\nf12\nn/Volumes/My Drive/DockerDesktop/Docker.raw\n"'
  assert_eq "path" "/Volumes/My Drive/DockerDesktop/Docker.raw" "$(docker_disk_path)"
  stub lsof 'printf "p123\nn/\n"'
  assert_eq "not found" "" "$(docker_disk_path)"
}

test_docker_room_gb_reads_dockers_own_free_space() {
  stub docker 'printf "Filesystem 1024-blocks Used Available Capacity Mounted on\noverlay 214357476 54834844 148601112 27%% /\n"'
  assert_eq "free GB" "141" "$(docker_room_gb)"
}

test_list_external_drives_skips_startup_disk_and_our_image() {
  mkdir -p "$T/vols/My SSD" "$T/vols/CueCanvas" "$T/vols/Other"
  ln -s / "$T/vols/Macintosh HD"
  assert_eq "drives" "$T/vols/My SSD
$T/vols/Other" "$(list_external_drives "$T/vols")"
}

test_mount_disk_image_missing_image_names_it() {
  mount_disk_image "$T/gone/CueCanvas.sparsebundle" >"$T/out" 2>&1
  assert_eq "status" "1" "$?"
  assert_contains "names the image" "$T/gone/CueCanvas.sparsebundle" "$(cat "$T/out")"
}

test_mount_disk_image_prints_mount_point() {
  mkdir -p "$T/CueCanvas.sparsebundle"
  stub hdiutil 'printf "/dev/disk5          \tGUID_partition_scheme          \t\n/dev/disk5s1        \t41504653-0000-11AA-AA11-0030654\t/Volumes/Cue Canvas\n"'
  assert_eq "mount point" "/Volumes/Cue Canvas" "$(mount_disk_image "$T/CueCanvas.sparsebundle")"
}

test_disk_image_for_finds_the_image_holding_a_folder() {
  stub hdiutil 'printf "framework       : 671.140.2\n================================================\nimage-path      : /Volumes/My SSD/CanvasDev.sparsebundle\nimage-type      : sparse bundle disk image\n/dev/disk4\tGUID_partition_scheme\t\n/dev/disk5s1\t41504653-0000-11AA-AA11-00306543ECAC\t/Volumes/CanvasDev\n================================================\nimage-path      : /Users/me/Other.dmg\n/dev/disk6s1\tApple_HFS\t/Volumes/Other\n"'
  assert_eq "folder inside" "/Volumes/My SSD/CanvasDev.sparsebundle" "$(disk_image_for /Volumes/CanvasDev/canvas-lms)"
  assert_eq "second image" "/Users/me/Other.dmg" "$(disk_image_for /Volumes/Other)"
  assert_eq "similar name" "" "$(disk_image_for /Volumes/CanvasDevX/canvas-lms)"
  assert_eq "not on an image" "" "$(disk_image_for "$HOME/canvas-lms")"
}

test_canvas_installed() {
  mkdir -p "$T/empty"
  assert_false "empty folder" canvas_installed "$T/empty"
  stub git "echo $CANVAS_COMMIT"
  assert_true "pinned commit" canvas_installed "$T/empty"
  stub git 'echo 0000000000000000000000000000000000000000'
  assert_false "other commit" canvas_installed "$T/empty"
}

# --- start, stop, ngrok ----------------------------------------------------

test_ngrok_url_from_json() {
  local json='{"tunnels":[{"name":"command_line","public_url":"https://name.ngrok-free.dev","proto":"https","config":{"addr":"http://127.0.0.1:8080"}}],"uri":"/api/tunnels"}'
  assert_eq "url" "https://name.ngrok-free.dev" "$(printf '%s' "$json" | ngrok_url_from_json)"
  assert_eq "spaced json" "https://a.ngrok-free.dev" "$(printf '{"tunnels": [{"public_url": "https://a.ngrok-free.dev"}]}' | ngrok_url_from_json)"
  assert_eq "no tunnel" "" "$(printf '{"tunnels":[]}' | ngrok_url_from_json)"
}

test_write_ngrok_compose_replaces_the_old_address() {
  write_ngrok_compose "$T" "old-name.ngrok-free.dev"
  write_ngrok_compose "$T" "new-name.ngrok-free.dev"
  local f
  f="$(cat "$T/docker-compose.cue-ngrok.yml")"
  assert_contains "allowed host" "ADDITIONAL_ALLOWED_HOSTS: new-name.ngrok-free.dev" "$f"
  assert_contains "port for this Mac only" '"127.0.0.1:8080:80"' "$f"
  assert_contains "web service" "  web:" "$f"
  case "$f" in *old-name*) assert_eq "old address gone" "gone" "still there" ;; esac
}

test_include_compose_file_appends_once() {
  printf 'COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml\nOTHER=1\n' >"$T/.env"
  include_compose_file "$T/.env" docker-compose.cue-ngrok.yml
  include_compose_file "$T/.env" docker-compose.cue-ngrok.yml
  assert_eq "env" "COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml:docker-compose.cue-ngrok.yml
OTHER=1" "$(cat "$T/.env")"
}

test_include_compose_file_adds_the_line_when_missing() {
  printf 'OTHER=1\n' >"$T/.env"
  include_compose_file "$T/.env" docker-compose.cue-ngrok.yml
  assert_eq "env" "OTHER=1
COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml:docker-compose.cue-ngrok.yml" "$(cat "$T/.env")"
  include_compose_file "$T/none.env" docker-compose.cue-ngrok.yml
  assert_eq "new file" "COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml:docker-compose.cue-ngrok.yml" "$(cat "$T/none.env")"
}

test_ngrok_has_token() {
  printf 'version: "3"\nagent:\n    authtoken: 2abcDEF_secret\n' >"$T/with.yml"
  printf 'version: "3"\nagent: {}\n' >"$T/without.yml"
  assert_true "with token" ngrok_has_token "$T/with.yml"
  assert_false "without token" ngrok_has_token "$T/without.yml"
  assert_false "no file" ngrok_has_token "$T/missing.yml"
}

test_start_ngrok_reports_ngrok_failing_at_once() {
  stub pgrep 'exit 1'
  stub curl 'exit 7'
  stub ngrok 'echo "ERROR:  Your account is limited to 1 simultaneous ngrok agent sessions. ERR_NGROK_108"; exit 1'
  SECONDS=0
  start_ngrok >"$T/out" 2>&1
  local code=$? elapsed=$SECONDS
  assert_eq "status" "1" "$code"
  assert_true "quick" test "$elapsed" -le 5
  assert_contains "shows ngrok's message" "ERR_NGROK_108" "$(cat "$T/out")"
}

test_start_ngrok_refuses_when_ngrok_already_runs() {
  stub pgrep 'exit 0'
  stub ngrok 'touch "$T/started"'
  start_ngrok >"$T/out" 2>&1
  assert_eq "status" "1" "$?"
  assert_contains "says why" "already running" "$(cat "$T/out")"
  assert_false "did not start another" test -e "$T/started"
}

test_start_ngrok_reads_the_address() {
  stub pgrep 'exit 1'
  stub ngrok 'sleep 30'
  stub curl 'printf "{\"tunnels\":[{\"public_url\":\"https://my-name.ngrok-free.dev\"}]}"'
  start_ngrok >"$T/out" 2>&1
  local code=$?
  kill "$NGROK_PID" 2>/dev/null
  assert_eq "status" "0" "$code"
  assert_eq "address" "https://my-name.ngrok-free.dev" "$NGROK_URL"
}

test_wait_for_canvas() {
  stub curl 'printf 200'
  assert_true "answers" wait_for_canvas "https://x.ngrok-free.dev" 4
  stub curl 'printf 502'
  wait_for_canvas "https://x.ngrok-free.dev" 2 >/dev/null 2>&1
  assert_eq "gives up" "1" "$?"
}

test_start_without_setup_says_to_run_setup() {
  export CUE_LOCAL_CANVAS_SETTINGS="$T/none.conf"
  (cmd_start) >"$T/out" 2>&1
  assert_eq "status" "1" "$?"
  assert_contains "says what to do" "scripts/local-canvas.sh setup" "$(cat "$T/out")"
}

test_start_with_drive_unplugged_does_not_start_docker() {
  export CUE_LOCAL_CANVAS_SETTINGS="$T/local-canvas.conf"
  settings_save "/Volumes/Gone/canvas-lms" "/Volumes/Gone/CueCanvas.sparsebundle"
  stub docker 'touch "$T/docker-called"; exit 1'
  stub open 'touch "$T/open-called"'
  (cmd_start) >"$T/out" 2>&1
  assert_eq "status" "1" "$?"
  assert_contains "names the image" "/Volumes/Gone/CueCanvas.sparsebundle" "$(cat "$T/out")"
  assert_contains "says to plug it in" "Plug in" "$(cat "$T/out")"
  assert_false "Docker not touched" test -e "$T/docker-called"
  assert_false "Docker Desktop not opened" test -e "$T/open-called"
}

# Stubs for running start with ngrok: no other ngrok, nothing else on port
# 8080, an ngrok that sleeps (and records its pid), and a Canvas that answers.
stub_ngrok_world() {
  stub pgrep 'exit 1'
  stub lsof 'exit 0'
  stub ngrok 'case "$1" in
  config) echo "Valid configuration file at $T/ngrok.yml" ;;
  http) echo $$ >"$T/ngrok.pid"; exec sleep 300 ;;
esac'
  stub curl 'case "$*" in
  *api/tunnels*) printf "{\"tunnels\":[{\"public_url\":\"https://my-name.ngrok-free.dev\"}]}" ;;
  *) printf 200 ;;
esac'
}

# The whole start command, with Docker, ngrok and curl stubbed: it starts only
# Canvas's web container, sets up Canvas login, prints the ngrok address, and
# Ctrl+C stops ngrok.
test_start_with_ngrok_end_to_end() {
  export CUE_LOCAL_CANVAS_SETTINGS="$T/local-canvas.conf"
  export CUE_SERVER_ENV="$T/server.env"
  mkdir -p "$T/canvas"
  settings_save "$T/canvas" ""
  printf 'agent:\n  authtoken: secret\n' >"$T/ngrok.yml"
  printf 'role\n' >"$T/local-canvas-accounts.csv" # demo data already added: no question
  stub docker 'echo "docker $*" >>"$T/docker.log"
case "$*" in *"rails runner"*) echo "CUE_KEY 10000000000001 s3cr/t+=" ;; esac
exit 0'
  stub_ngrok_world
  printf 'y\n' | bash "$SCRIPT" start >"$T/out" 2>&1 &
  local pid=$! i
  for i in $(seq 1 50); do
    grep -q "Keep this window open" "$T/out" 2>/dev/null && break
    sleep 0.2
  done
  assert_contains "prints the address" "https://my-name.ngrok-free.dev" "$(cat "$T/out")"
  assert_contains "starts only Canvas's web container" "docker compose up -d web" "$(cat "$T/docker.log")"
  assert_contains "allows the address" "my-name.ngrok-free.dev" "$(cat "$T/canvas/docker-compose.cue-ngrok.yml")"
  local out
  out="$(cat "$T/out")"
  assert_contains "sets up login before showing the address" "Restart Cue's server" "${out%%Canvas is reachable*}"
  assert_eq "login settings written" "https://my-name.ngrok-free.dev" "$(env_get "$T/server.env" CUE_CANVAS_URL)"
  assert_contains "tells students how to connect" 'with "Log in with Canvas"' "$out"
  assert_contains "explains ngrok's warning in the login screen" "may appear on each login" "$out"
  case "$out" in *s3cr*) assert_eq "secret not printed" "hidden" "printed" ;; esac
  # A background job ignores SIGINT, so send TERM, which the same trap handles
  # (in a terminal, Ctrl+C sends INT to the script in the foreground).
  kill -TERM "$pid" 2>/dev/null
  wait "$pid"
  assert_eq "Ctrl+C exits cleanly" "0" "$?"
  assert_false "ngrok stopped" kill -0 "$(cat "$T/ngrok.pid")" 2>/dev/null
  assert_contains "says Canvas is off the internet" "off the internet" "$(cat "$T/out")"
}

# When the login setup fails, Canvas stays up and the closing text points
# students to an access token instead of the login button.
test_start_with_ngrok_when_login_setup_fails() {
  export CUE_LOCAL_CANVAS_SETTINGS="$T/local-canvas.conf"
  export CUE_SERVER_ENV="$T/server.env"
  mkdir -p "$T/canvas"
  settings_save "$T/canvas" ""
  printf 'agent:\n  authtoken: secret\n' >"$T/ngrok.yml"
  printf 'role\n' >"$T/local-canvas-accounts.csv" # demo data already added: no question
  stub docker 'echo "docker $*" >>"$T/docker.log"
exit 0'
  stub_ngrok_world
  printf 'y\n' | bash "$SCRIPT" start >"$T/out" 2>&1 &
  local pid=$! i
  for i in $(seq 1 50); do
    grep -q "Keep this window open" "$T/out" 2>/dev/null && break
    sleep 0.2
  done
  local out
  out="$(cat "$T/out")"
  assert_contains "warns" "Couldn't set up Canvas login for Cue." "$out"
  assert_contains "prints the address" "https://my-name.ngrok-free.dev" "$out"
  assert_contains "students use an access token" "Students connect with an" "$out"
  case "$out" in *'with "Log in with Canvas"'*) assert_eq "no login wording" "absent" "present" ;; esac
  kill -TERM "$pid" 2>/dev/null
  wait "$pid"
}

test_start_stops_ngrok_when_canvas_fails_to_restart() {
  export CUE_LOCAL_CANVAS_SETTINGS="$T/local-canvas.conf"
  export CUE_SERVER_ENV="$T/server.env"
  mkdir -p "$T/canvas"
  settings_save "$T/canvas" ""
  printf 'agent:\n  authtoken: secret\n' >"$T/ngrok.yml"
  printf 'role\n' >"$T/local-canvas-accounts.csv" # demo data already added: no question
  stub docker 'case "$*" in *"--no-deps web"*) exit 1 ;; *) exit 0 ;; esac'
  stub_ngrok_world
  printf 'y\n' | bash "$SCRIPT" start >"$T/out" 2>&1
  assert_eq "status" "1" "$?"
  assert_contains "says why" "Couldn't restart Canvas's web container" "$(cat "$T/out")"
  assert_true "ngrok had started" test -s "$T/ngrok.pid"
  assert_false "ngrok stopped" kill -0 "$(cat "$T/ngrok.pid")" 2>/dev/null
}

# Before the ngrok question, start offers demo data when there is none.
test_start_offers_demo_data_when_there_is_none() {
  seed_world
  export CUE_SERVER_ENV="$T/server.env"
  fake_seed_output >"$T/seed.out"
  stub docker 'echo "docker $*" >>"$T/docker.log"
case "$*" in
  "compose ps"*) printf "web\n" ;;
  "compose exec"*) cat "$T/seed.out" ;;
esac'
  stub curl 'printf 200'
  printf 'y\nn\n' | bash "$SCRIPT" start >"$T/out" 2>&1
  assert_eq "status" "0" "$?"
  local out
  out="$(cat "$T/out")"
  assert_contains "asks" "Add demo courses and accounts (about a minute)? [y/N]" "$out"
  assert_contains "seed ran" "compose exec -T" "$(cat "$T/docker.log")"
  assert_contains "accounts written" "Demo data ready" "$out"
  assert_true "accounts file exists" test -s "$T/local-canvas-accounts.csv"
  assert_contains "ngrok question still asked" "Canvas is running at http://canvas.docker" "$out"
}

# Docker's exec forwards stdin to the container, so the seed must not hand it
# the answers still waiting for start's ngrok question.
test_start_demo_data_leaves_the_ngrok_answer_alone() {
  seed_world
  export CUE_SERVER_ENV="$T/server.env"
  printf 'agent:\n  authtoken: secret\n' >"$T/ngrok.yml"
  fake_seed_output >"$T/seed.out"
  stub docker 'case "$*" in
  "compose ps"*) printf "web\n" ;;
  "compose exec"*) cat >/dev/null; cat "$T/seed.out" ;;
esac'
  stub curl 'printf 200'
  stub_ngrok_world
  stub lsof 'printf "p321\ncnode\n"'
  stub ngrok 'case "$1" in config) echo "Valid configuration file at $T/ngrok.yml" ;; http) exit 1 ;; esac'
  printf 'y\ny\n' | bash "$SCRIPT" start >"$T/out" 2>&1
  assert_contains "the ngrok question got its yes" "Port 8080 is in use by node" "$(cat "$T/out")"
}

test_start_carries_on_when_demo_data_fails() {
  seed_world
  export CUE_SERVER_ENV="$T/server.env"
  stub docker 'case "$*" in "compose ps"*) printf "web\n" ;; "compose exec"*) echo boom >&2; exit 1 ;; esac'
  stub curl 'printf 200'
  printf 'y\nn\n' | bash "$SCRIPT" start >"$T/out" 2>&1
  assert_eq "status" "0" "$?"
  assert_contains "warns" "Demo data wasn't added; Canvas is still running." "$(cat "$T/out")"
  assert_contains "carries on" "Canvas is running at http://canvas.docker" "$(cat "$T/out")"
}

test_start_mentions_demo_accounts_when_they_exist() {
  seed_world
  export CUE_SERVER_ENV="$T/server.env"
  printf 'role\n' >"$T/local-canvas-accounts.csv"
  stub docker 'exit 0'
  printf 'n\n' | bash "$SCRIPT" start >"$T/out" 2>&1
  assert_eq "status" "0" "$?"
  local out
  out="$(cat "$T/out")"
  assert_contains "shows the file" "Demo accounts: $T/local-canvas-accounts.csv" "$out"
  case "$out" in *"Add demo courses"*) assert_eq "no question" "absent" "asked" ;; esac
}

# --- review fixes: drive, Docker's disk, port, folder, existing checkout ---

test_setup_with_drive_unplugged_does_not_start_docker() {
  export CUE_LOCAL_CANVAS_SETTINGS="$T/local-canvas.conf"
  settings_save "/Volumes/Gone/canvas-lms" "/Volumes/Gone/CueCanvas.sparsebundle"
  DOCKER_APP="$T"
  stub brew 'exit 0'
  stub git 'exit 0'
  stub ngrok 'exit 0'
  stub docker 'echo "$*" >>"$T/docker.log"; exit 0'
  stub open 'touch "$T/open-called"'
  (cmd_setup) </dev/null >"$T/out" 2>&1
  assert_eq "status" "1" "$?"
  assert_contains "says to plug it in" "Plug in" "$(cat "$T/out")"
  case "$(cat "$T/docker.log" 2>/dev/null)" in *info*) assert_eq "Docker not asked to run" "no docker info" "docker info called" ;; esac
  assert_false "Docker Desktop not opened" test -e "$T/open-called"
}

# Canvas on a disk image whose mount holds Docker's disk too, as setup arranges.
external_drive_world() { # where-docker-disk-is
  export CUE_LOCAL_CANVAS_SETTINGS="$T/local-canvas.conf"
  mkdir -p "$T/CueCanvas.sparsebundle" "$T/mnt/canvas-lms" "$T/mnt/DockerDesktop"
  settings_save "$T/mnt/canvas-lms" "$T/CueCanvas.sparsebundle"
  DOCKER_APP="$T"
  stub hdiutil "printf '/dev/disk5\tGUID_partition_scheme\t\n/dev/disk5s1\t41504653\t$T/mnt\n'"
  stub lsof "printf 'p1\nn$1\n'"
  stub docker 'echo "$*" >>"$T/docker.log"; exit 0'
}

test_start_refuses_when_dockers_disk_is_not_on_the_drive() {
  external_drive_world "$HOME/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw"
  (cmd_start) </dev/null >"$T/out" 2>&1
  assert_eq "status" "1" "$?"
  assert_contains "says what to do" "Quit Docker Desktop" "$(cat "$T/out")"
  case "$(cat "$T/docker.log")" in *compose*) assert_eq "Canvas not started" "no compose" "compose called" ;; esac
}

test_start_with_dockers_disk_on_the_drive() {
  external_drive_world "$T/mnt/DockerDesktop/Docker.raw"
  (cmd_start) </dev/null >"$T/out" 2>&1
  assert_eq "status" "0" "$?"
  assert_contains "starts Canvas" "compose up -d web" "$(cat "$T/docker.log")"
}

test_port_user_names_a_program_other_than_docker() {
  stub lsof 'printf "p321\ncnode\n"'
  assert_eq "node" "node" "$(port_user 8080)"
  stub lsof 'printf "p1\nccom.docker.backend\n"'
  assert_eq "Docker itself" "" "$(port_user 8080)"
  stub lsof 'exit 1'
  assert_eq "free" "" "$(port_user 8080)"
}

test_start_with_ngrok_refuses_when_port_8080_is_taken() {
  export CUE_LOCAL_CANVAS_SETTINGS="$T/local-canvas.conf"
  export CUE_SERVER_ENV="$T/server.env"
  mkdir -p "$T/canvas"
  settings_save "$T/canvas" ""
  printf 'agent:\n  authtoken: secret\n' >"$T/ngrok.yml"
  printf 'role\n' >"$T/local-canvas-accounts.csv" # demo data already added: no question
  stub docker 'exit 0'
  stub_ngrok_world
  stub lsof 'printf "p321\ncnode\n"'
  # If ngrok is started anyway, record it and stop at once rather than hang.
  stub ngrok 'case "$1" in config) echo "Valid configuration file at $T/ngrok.yml" ;; http) echo $$ >"$T/ngrok.pid"; exit 1 ;; esac'
  printf 'y\n' | bash "$SCRIPT" start >"$T/out" 2>&1
  assert_eq "status" "1" "$?"
  assert_contains "names the port and program" "Port 8080 is in use by node" "$(cat "$T/out")"
  assert_false "ngrok not started" test -e "$T/ngrok.pid"
}

test_deleted_ngrok_compose_file_is_dropped_from_env() {
  printf 'COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml:docker-compose.cue-ngrok.yml\nOTHER=1\n' >"$T/.env"
  drop_missing_ngrok_compose "$T"
  assert_eq "dropped" "COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml
OTHER=1" "$(cat "$T/.env")"
  include_compose_file "$T/.env" docker-compose.cue-ngrok.yml
  touch "$T/docker-compose.cue-ngrok.yml"
  drop_missing_ngrok_compose "$T"
  assert_contains "kept while the file exists" ":docker-compose.cue-ngrok.yml" "$(cat "$T/.env")"
}

test_ngrok_compose_header_explains_the_undo() {
  write_ngrok_compose "$T" "x.ngrok-free.dev"
  assert_contains "mentions .env" "COMPOSE_FILE" "$(cat "$T/docker-compose.cue-ngrok.yml")"
}

test_ask_folder_wants_a_full_path() {
  local got
  got="$(printf 'canvas-lms\n/abs/canvas-lms\n' | ask_folder "Where?" "$HOME/canvas-lms" 2>"$T/err")"
  assert_eq "second answer" "/abs/canvas-lms" "$got"
  assert_contains "explains" "full path" "$(cat "$T/err")"
  assert_eq "default" "$HOME/canvas-lms" "$(ask_folder "Where?" "$HOME/canvas-lms" </dev/null 2>/dev/null)"
}

test_fetch_canvas_leaves_another_checkout_alone() {
  mkdir -p "$T/repo"
  /usr/bin/git -C "$T/repo" init -q
  /usr/bin/git -C "$T/repo" remote add origin https://example.com/someone/other.git
  fetch_canvas "$T/repo" >"$T/out" 2>&1
  assert_eq "status" "1" "$?"
  assert_contains "says why" "different" "$(cat "$T/out")"
  assert_eq "origin untouched" "https://example.com/someone/other.git" "$(/usr/bin/git -C "$T/repo" remote get-url origin)"
}

# --- Canvas login for Cue (server/.env) ------------------------------------
# Every test here points CUE_SERVER_ENV into $T, so the real server/.env is
# never touched.

test_server_env_file_defaults_to_this_checkouts_server_env() {
  assert_eq "default" "$(cd "$HERE/.." && pwd)/server/.env" "$(unset CUE_SERVER_ENV && server_env_file)"
  export CUE_SERVER_ENV="$T/server.env"
  assert_eq "override" "$T/server.env" "$(server_env_file)"
}

test_env_set_replaces_adds_and_keeps_other_lines() {
  export CUE_SERVER_ENV="$T/server.env"
  printf 'PORT=3000\nCUE_CANVAS_URL=old\n# note\n' >"$CUE_SERVER_ENV"
  assert_eq "prints nothing" "" "$(env_set "$CUE_SERVER_ENV" CUE_CANVAS_URL "https://new")"
  env_set "$CUE_SERVER_ENV" CUE_CANVAS_CLIENT_ID "1"
  assert_eq "file" "PORT=3000
CUE_CANVAS_URL=https://new
# note
CUE_CANVAS_CLIENT_ID=1" "$(cat "$CUE_SERVER_ENV")"
}

test_env_get_and_env_set_skip_commented_and_longer_keys() {
  export CUE_SERVER_ENV="$T/server.env"
  printf '# CUE_CANVAS_URL=commented\nCUE_CANVAS_URL_OTHER=x\n' >"$CUE_SERVER_ENV"
  assert_eq "no value yet" "" "$(env_get "$CUE_SERVER_ENV" CUE_CANVAS_URL)"
  env_set "$CUE_SERVER_ENV" CUE_CANVAS_URL "https://new"
  assert_eq "file" "# CUE_CANVAS_URL=commented
CUE_CANVAS_URL_OTHER=x
CUE_CANVAS_URL=https://new" "$(cat "$CUE_SERVER_ENV")"
  assert_eq "reads the real line" "https://new" "$(env_get "$CUE_SERVER_ENV" CUE_CANVAS_URL)"
  assert_eq "missing file" "" "$(env_get "$T/missing.env" CUE_CANVAS_URL)"
}

test_env_set_writes_a_secret_exactly() {
  export CUE_SERVER_ENV="$T/server.env"
  printf 'PORT=3000\n' >"$CUE_SERVER_ENV"
  env_set "$CUE_SERVER_ENV" CUE_CANVAS_CLIENT_SECRET 'a/b+c=d&e'
  assert_eq "reads back" 'a/b+c=d&e' "$(env_get "$CUE_SERVER_ENV" CUE_CANVAS_CLIENT_SECRET)"
  env_set "$CUE_SERVER_ENV" CUE_CANVAS_CLIENT_SECRET 'x\ny\\z&'
  assert_eq "backslashes too" 'x\ny\\z&' "$(env_get "$CUE_SERVER_ENV" CUE_CANVAS_CLIENT_SECRET)"
  assert_eq "one line" "PORT=3000
CUE_CANVAS_CLIENT_SECRET=x\\ny\\\\z&" "$(cat "$CUE_SERVER_ENV")"
}

test_ensure_server_env_creates_the_file_with_a_secret_key() {
  export CUE_SERVER_ENV="$T/server.env"
  ensure_server_env >"$T/out" 2>&1
  assert_eq "status" "0" "$?"
  assert_contains "copied the example" "PORT=3000" "$(cat "$CUE_SERVER_ENV")"
  assert_contains "kept its comments" "# CUE_CANVAS_URL=" "$(cat "$CUE_SERVER_ENV")"
  local key
  key="$(env_get "$CUE_SERVER_ENV" CUE_SECRET_KEY)"
  assert_eq "32 bytes" "32" "$(printf '%s' "$key" | base64 -D | wc -c | tr -d ' ')"
  assert_eq "prints nothing" "" "$(cat "$T/out")"
  assert_eq "only this user can read it" "600" "$(stat -f %Lp "$CUE_SERVER_ENV")"
  ensure_server_env
  assert_eq "keeps an existing key" "$key" "$(env_get "$CUE_SERVER_ENV" CUE_SECRET_KEY)"
  printf 'PORT=3000\nCUE_SECRET_KEY=\n' >"$T/own.env"
  chmod 644 "$T/own.env"
  CUE_SERVER_ENV="$T/own.env" ensure_server_env
  assert_true "fills in an empty key" test -n "$(env_get "$T/own.env" CUE_SECRET_KEY)"
  assert_eq "leaves an existing file's mode alone" "644" "$(stat -f %Lp "$T/own.env")"
}

test_ensure_server_env_creates_the_file_private_from_the_start() {
  export CUE_SERVER_ENV="$T/server.env"
  stub cp 'umask >"$T/umask"; exec /bin/cp "$@"'
  ensure_server_env
  assert_eq "created under umask 077" "0077" "$(cat "$T/umask")"
}

test_scopes_match_the_servers() {
  local ts script
  ts="$(sed -n '/CANVAS_SCOPES = \[/,/\] as const/p' "$HERE/../server/src/canvas/CanvasLogin.ts" |
    sed -n 's/^ *"\(url:[^"]*\)",$/\1/p' | sort)"
  script="$(printf '%s\n' $CUE_SCOPES | sort)"
  assert_eq "three scopes found" "3" "$(printf '%s\n' "$ts" | wc -l | tr -d ' ')"
  assert_eq "same scopes" "$ts" "$script"
}

test_cue_key_known() {
  stub curl 'echo "$*" >>"$T/curl.log"; printf 401'
  assert_false "unknown key" cue_key_known "https://my-name.ngrok-free.dev" 10000000000001
  assert_contains "asks Canvas's login page" "https://my-name.ngrok-free.dev/login/oauth2/auth?client_id=10000000000001&response_type=code&redirect_uri=urn:ietf:wg:oauth:2.0:oob" "$(cat "$T/curl.log")"
  stub curl 'printf 302'
  assert_true "known key" cue_key_known "https://my-name.ngrok-free.dev" 10000000000001
}

test_ensure_cue_login_writes_settings_and_never_prints_the_secret() {
  export CUE_SERVER_ENV="$T/server.env"
  mkdir -p "$T/canvas"
  stub docker 'echo "$PWD: docker $*" >>"$T/docker.log"; echo "CUE_KEY 10000000000001 s3cr/t+="'
  stub curl 'printf 302'
  ensure_cue_login "$T/canvas" "https://my-name.ngrok-free.dev" >"$T/out" 2>&1
  assert_eq "status" "0" "$?"
  assert_eq "url" "https://my-name.ngrok-free.dev" "$(env_get "$CUE_SERVER_ENV" CUE_CANVAS_URL)"
  assert_eq "client id" "10000000000001" "$(env_get "$CUE_SERVER_ENV" CUE_CANVAS_CLIENT_ID)"
  assert_true "address is written last, so its presence means fully configured" \
    test "$(grep -n '^CUE_CANVAS_URL=' "$CUE_SERVER_ENV" | cut -d: -f1)" -gt "$(grep -n '^CUE_CANVAS_CLIENT_SECRET=' "$CUE_SERVER_ENV" | cut -d: -f1)"
  assert_eq "login ready" "1" "$CUE_LOGIN_READY"
  assert_eq "secret" "s3cr/t+=" "$(env_get "$CUE_SERVER_ENV" CUE_CANVAS_CLIENT_SECRET)"
  local log
  log="$(cat "$T/docker.log")"
  assert_contains "runs rails in Canvas's web container" "$T/canvas: docker compose exec -T web bundle exec rails runner" "$log"
  assert_contains "scope: courses" "url:GET|/api/v1/courses " "$log"
  assert_contains "scope: assignments" "url:GET|/api/v1/courses/:course_id/assignments" "$log"
  assert_contains "scope: calendar events" "url:GET|/api/v1/calendar_events" "$log"
  assert_contains "makes a deactivated key active again" 'key.workflow_state = "active"' "$log"
  assert_contains "says what it does" "Setting up Canvas login for Cue (about a minute)..." "$(cat "$T/out")"
  assert_contains "says to restart" "Restart Cue's server so it picks up Canvas login." "$(cat "$T/out")"
  case "$(cat "$T/out")" in *s3cr*) assert_eq "secret not printed" "hidden" "printed" ;; esac
}

test_ensure_cue_login_skips_when_already_set_up() {
  export CUE_SERVER_ENV="$T/server.env"
  mkdir -p "$T/canvas"
  printf 'CUE_SECRET_KEY=k\nCUE_CANVAS_URL=https://my-name.ngrok-free.dev\nCUE_CANVAS_CLIENT_ID=10000000000001\nCUE_CANVAS_CLIENT_SECRET=s3cr\n' >"$CUE_SERVER_ENV"
  local before
  before="$(cat "$CUE_SERVER_ENV")"
  stub docker 'echo "$*" >>"$T/docker.log"'
  stub curl 'printf 302'
  ensure_cue_login "$T/canvas" "https://my-name.ngrok-free.dev" >"$T/out" 2>&1
  assert_eq "status" "0" "$?"
  assert_eq "says so" "Canvas login for Cue is already set up." "$(cat "$T/out")"
  assert_eq "login ready" "1" "$CUE_LOGIN_READY"
  assert_eq "docker not called" "" "$(cat "$T/docker.log" 2>/dev/null)"
  assert_eq "file unchanged" "$before" "$(cat "$CUE_SERVER_ENV")"
}

test_ensure_cue_login_sets_up_again_for_a_new_address_or_a_forgotten_key() {
  export CUE_SERVER_ENV="$T/server.env"
  mkdir -p "$T/canvas"
  printf 'CUE_SECRET_KEY=k\nCUE_CANVAS_URL=https://old.ngrok-free.dev\nCUE_CANVAS_CLIENT_ID=1\nCUE_CANVAS_CLIENT_SECRET=old\n' >"$CUE_SERVER_ENV"
  stub docker 'echo "$*" >>"$T/docker.log"; echo "CUE_KEY 2 new"'
  stub curl 'printf 302'
  ensure_cue_login "$T/canvas" "https://my-name.ngrok-free.dev" >/dev/null 2>&1
  assert_true "new address: key step ran" test -s "$T/docker.log"
  assert_eq "new address written" "https://my-name.ngrok-free.dev" "$(env_get "$CUE_SERVER_ENV" CUE_CANVAS_URL)"
  rm -f "$T/docker.log"
  stub curl 'printf 401'
  ensure_cue_login "$T/canvas" "https://my-name.ngrok-free.dev" >/dev/null 2>&1
  assert_true "key Canvas doesn't know: key step ran" test -s "$T/docker.log"
}

test_ensure_cue_login_failure_warns_and_carries_on() {
  export CUE_SERVER_ENV="$T/server.env"
  mkdir -p "$T/canvas"
  stub docker 'echo "x.rb:1: Validation failed: Scopes cannot contain url:GET|/nope (ActiveRecord::RecordInvalid)" >&2
printf "\tfrom /usr/src/app/x.rb:2\n" >&2
exit 1'
  stub curl 'printf 302'
  ensure_cue_login "$T/canvas" "https://my-name.ngrok-free.dev" >"$T/out" 2>&1
  assert_eq "status" "0" "$?"
  assert_eq "login not ready" "0" "$CUE_LOGIN_READY"
  assert_contains "warns" "Couldn't set up Canvas login for Cue. Students can still connect with an access token." "$(cat "$T/out")"
  assert_contains "shows Canvas's message" "Scopes cannot contain url:GET|/nope" "$(cat "$T/out")"
  assert_eq "no login settings" "" "$(env_get "$CUE_SERVER_ENV" CUE_CANVAS_URL)"
  stub docker 'echo "no key line"'
  ensure_cue_login "$T/canvas" "https://my-name.ngrok-free.dev" >"$T/out" 2>&1
  assert_eq "status without a key line" "0" "$?"
  assert_contains "warns without a key line" "Couldn't set up Canvas login for Cue." "$(cat "$T/out")"
  assert_eq "still no login settings" "" "$(env_get "$CUE_SERVER_ENV" CUE_CANVAS_URL)"
}

# --- demo data (local-canvas-seed.sh) ---------------------------------------
# Every test here points the settings, and so the accounts file, into $T, so
# the real ~/.config/cue is never touched.

# Settings for a Canvas in $T/canvas, as setup leaves them.
seed_world() {
  export CUE_LOCAL_CANVAS_SETTINGS="$T/local-canvas.conf"
  mkdir -p "$T/canvas"
  settings_save "$T/canvas" ""
}

# What the seed's Ruby prints for the demo data: one line per account, then
# the number of courses.
fake_seed_output() {
  printf 'CUE_ACCOUNT\tteacher\t%s\t%s\t%s\t%s\t%s\n' \
    "Elena Marsh" elena.marsh@faculty.cue-demo.test elena-cue2026 1 "CS 4350" \
    "David Okafor" david.okafor@faculty.cue-demo.test david-cue2026 2 "CS 4513" \
    "Priya Raman" priya.raman@faculty.cue-demo.test priya-cue2026 3 "STAT 3303"
  printf 'CUE_ACCOUNT\tstudent\t%s\t%s\t%s\t%s\t%s\n' \
    "Maya Thompson" maya.thompson@students.cue-demo.test maya-cue2026 4 "CS 4350; CS 4513; STAT 3303" \
    "Liam Novak" liam.novak@students.cue-demo.test liam-cue2026 5 "CS 4350; CS 4513" \
    "Aisha Bello" aisha.bello@students.cue-demo.test aisha-cue2026 6 "CS 4350; STAT 3303" \
    "Diego Alvarez" diego.alvarez@students.cue-demo.test diego-cue2026 7 "CS 4513; STAT 3303" \
    "Hannah Schmidt" hannah.schmidt@students.cue-demo.test hannah-cue2026 8 "CS 4350; CS 4513; STAT 3303" \
    "Wei Chen" wei.chen@students.cue-demo.test wei-cue2026 9 "CS 4350; STAT 3303"
  printf 'CUE_COURSES\t3\n'
}

test_seed_accounts_file_sits_next_to_the_settings() {
  seed_world
  stub docker 'exit 0'
  assert_eq "path" "$T/local-canvas-accounts.csv" "$(seed_accounts_file)"
}

test_mac_time_zone_reads_the_macs_zone() {
  stub readlink 'echo /var/db/timezone/zoneinfo/America/Chicago'
  assert_eq "zone" "America/Chicago" "$(mac_time_zone)"
  stub readlink 'exit 1'
  assert_eq "unknown" "UTC" "$(mac_time_zone)"
}

test_write_accounts_file_writes_csv_with_mode_600() {
  seed_world
  stub docker 'exit 0'
  local file="$T/local-canvas-accounts.csv"
  printf 'CUE_ACCOUNT\tteacher\tElena Marsh\telena.marsh@faculty.cue-demo.test\telena-cue2026\t7\tCS 4350\nRails says hello\nCUE_ACCOUNT\tstudent\tMaya Thompson\tmaya.thompson@students.cue-demo.test\tmaya-cue2026\t12\tCS 4350; CS 4513\n' |
    write_accounts_file "$file"
  assert_eq "status" "0" "$?"
  assert_eq "file" "role,name,email,password,canvas_user_id,courses
teacher,Elena Marsh,elena.marsh@faculty.cue-demo.test,elena-cue2026,7,CS 4350
student,Maya Thompson,maya.thompson@students.cue-demo.test,maya-cue2026,12,CS 4350; CS 4513" "$(cat "$file")"
  assert_eq "only this user can read it" "600" "$(stat -f %Lp "$file")"
}

test_write_accounts_file_creates_the_file_private_from_the_start() {
  seed_world
  stub mktemp 'umask >"$T/umask"; exec /usr/bin/mktemp "$@"'
  printf 'CUE_ACCOUNT\tteacher\tElena Marsh\te@faculty.cue-demo.test\telena-cue2026\t7\tCS 4350\n' |
    write_accounts_file "$T/local-canvas-accounts.csv"
  assert_eq "created under umask 077" "0077" "$(cat "$T/umask")"
}

test_write_accounts_file_without_accounts_keeps_the_old_file() {
  seed_world
  stub docker 'exit 0'
  printf 'old\n' >"$T/local-canvas-accounts.csv"
  printf 'Rails says hello\nCUE_COURSES\t3\n' | write_accounts_file "$T/local-canvas-accounts.csv"
  assert_eq "status" "1" "$?"
  assert_eq "old content kept" "old" "$(cat "$T/local-canvas-accounts.csv")"
}

test_seed_says_to_start_canvas_when_it_isnt_running() {
  seed_world
  stub docker 'echo "docker $*" >>"$T/docker.log"'
  bash "$SEED_SCRIPT" >"$T/out" 2>&1
  assert_eq "status" "1" "$?"
  assert_contains "says what to do" "Canvas isn't running. Start it with: scripts/local-canvas.sh start" "$(cat "$T/out")"
  assert_contains "asked Docker" "docker compose ps --status running --services" "$(cat "$T/docker.log")"
  case "$(cat "$T/docker.log")" in *"compose exec"*) assert_eq "Ruby not run" "not run" "run" ;; esac
  assert_false "no accounts file" test -e "$T/local-canvas-accounts.csv"
}

test_seed_end_to_end_writes_the_file_and_summary() {
  seed_world
  fake_seed_output >"$T/seed.out"
  stub docker 'echo "$PWD: docker $*" >>"$T/docker.log"
case "$*" in
  "compose ps"*) printf "postgres\nredis\nweb\n" ;;
  "compose exec"*) echo "some Rails noise"; cat "$T/seed.out" ;;
esac'
  bash "$SEED_SCRIPT" >"$T/out" 2>&1
  assert_eq "status" "0" "$?"
  local out log file="$T/local-canvas-accounts.csv"
  out="$(cat "$T/out")"
  log="$(cat "$T/docker.log")"
  assert_contains "says what it does" "Adding demo courses and accounts (about a minute)..." "$out"
  assert_contains "summary" "Demo data ready: 3 courses, 3 teachers, 6 students." "$out"
  assert_contains "file path" "Accounts and passwords: $file" "$out"
  assert_eq "header and nine accounts" "10" "$(wc -l <"$file" | tr -d ' ')"
  assert_eq "header" "role,name,email,password,canvas_user_id,courses" "$(head -n 1 "$file")"
  assert_eq "only this user can read it" "600" "$(stat -f %Lp "$file")"
  assert_contains "runs in the Canvas folder" "$T/canvas: docker compose exec -T" "$log"
  assert_contains "passes the Mac's time zone" "-e CUE_SEED_TZ=" "$log"
  assert_contains "runs rails in the web container" "web bundle exec rails runner" "$log"
  assert_contains "passes the seed's Ruby" "cue-demo-term" "$log"
  case "$out" in *"Rails noise"*) assert_eq "Canvas's other output hidden" "hidden" "shown" ;; esac
}

test_seed_failure_keeps_the_old_file_and_shows_canvas_error() {
  seed_world
  printf 'old\n' >"$T/local-canvas-accounts.csv"
  printf '%s\n' "RuntimeError: maya.thompson@students.cue-demo.test already belongs to a Canvas user the seed didn't create" \
    "from /app/x.rb:1" >"$T/seed.err"
  stub docker 'case "$*" in
  "compose ps"*) echo web ;;
  "compose exec"*) cat "$T/seed.err" >&2; exit 1 ;;
esac'
  bash "$SEED_SCRIPT" >"$T/out" 2>&1
  assert_eq "status" "1" "$?"
  local out
  out="$(cat "$T/out")"
  assert_contains "warns" "Canvas couldn't add the demo data. What it said:" "$out"
  assert_contains "shows Canvas's message" "maya.thompson@students.cue-demo.test already belongs to a Canvas user the seed didn't create" "$out"
  case "$out" in *"from /app/x.rb:1"*) assert_eq "backtrace hidden" "hidden" "shown" ;; esac
  case "$out" in *"Demo data ready"*) assert_eq "no summary" "absent" "present" ;; esac
  assert_eq "old file kept" "old" "$(cat "$T/local-canvas-accounts.csv")"
}

test_seed_ruby_follows_the_rules() {
  local ruby needle
  ruby="$(cat "$HERE/local-canvas-seed.rb")"
  for needle in cue-demo-term -cue2026 students.cue-demo.test faculty.cue-demo.test CUE_SEED_TZ CUE_ACCOUNT \
    "already belongs to a Canvas user the seed didn't create"; do
    assert_contains "has $needle" "$needle" "$ruby"
  done
  # The word Cue never uses for a stretch of work, in any case. Written as a
  # pattern so that this file doesn't contain the word either.
  assert_false "never uses the word" grep -qi 'spr[i]nt' "$HERE/local-canvas-seed.rb"
}

# --- runner ----------------------------------------------------------------
# A test's stderr (prompts, warnings) is shown only when the test fails.

passed=0
failed=0
for t in $(declare -F | awk '{print $3}' | grep '^test_'); do
  log="$(mktemp)"
  if (
    T="$(mktemp -d)"
    export T
    trap 'rm -rf "$T"' EXIT
    FAILED=0
    "$t"
    exit "$FAILED"
  ) 2>"$log"; then
    passed=$((passed + 1))
  else
    echo "FAILED: $t"
    sed 's/^/  stderr: /' "$log"
    failed=$((failed + 1))
  fi
  rm -f "$log"
done
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
