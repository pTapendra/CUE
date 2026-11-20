#!/bin/bash
# Tests for scripts/local-canvas.sh. Run: bash scripts/local-canvas.test.sh
# Each test_* function runs in its own subshell, with a fresh temp folder in $T.

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/local-canvas.sh"
# shellcheck source=local-canvas.sh
. "$SCRIPT"

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
