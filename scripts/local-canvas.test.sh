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
