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

# --- runner ----------------------------------------------------------------

passed=0
failed=0
for t in $(declare -F | awk '{print $3}' | grep '^test_'); do
  if (
    T="$(mktemp -d)"
    trap 'rm -rf "$T"' EXIT
    FAILED=0
    "$t"
    exit "$FAILED"
  ); then
    passed=$((passed + 1))
  else
    echo "FAILED: $t"
    failed=$((failed + 1))
  fi
done
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
