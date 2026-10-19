#!/bin/sh
# The explicit experimental flag keeps the inherited Electron security gap visible.
set -eu
umask 077
project=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ "${1:-}" != --experimental-runtime ]; then
    echo 'Usage: sh frontend/start.sh --experimental-runtime [verified-vendor-directory]' >&2
    echo 'Electron 26 hosting is experimental: sandbox/TLS hardening is still a release blocker.' >&2
    exit 1
fi
shift
inspect=
if [ "${1:-}" = --inspect ]; then inspect=--inspect; shift; fi
if [ "$#" -gt 1 ]; then echo 'Too many arguments' >&2; exit 1; fi
vendor=${1:-"$project/vendor/nitrosense-5.2.84-official"}
backend="$project/backend/target/debug/nitrosense-backend"
tools="$project/backend/target/debug/nitrosense-tools"
electron="$project/.tools/electron-runtime/node_modules/.bin/electron"
for program in "$backend" "$tools" "$electron"; do
    if [ ! -x "$program" ]; then echo "Missing executable: $program; build the Rust workspace and install the frontend runtime first." >&2; exit 1; fi
done
"$tools" check-original --vendor "$vendor"
mkdir -p "$project/.state"
session=$(mktemp -d "$project/.state/rust-frontend-XXXXXXXX")
export NITROSENSE_BACKEND_SOCKET="$session/backend.sock"
export NITROSENSE_STATE_DIR="$session/frontend"
mkdir "$NITROSENSE_STATE_DIR"
backend_pid=
frontend_pid=
cleanup() {
    trap - EXIT INT TERM
    if [ -n "$frontend_pid" ]; then kill "$frontend_pid" 2>/dev/null || :; wait "$frontend_pid" 2>/dev/null || :; fi
    if [ -n "$backend_pid" ]; then kill "$backend_pid" 2>/dev/null || :; wait "$backend_pid" 2>/dev/null || :; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"$backend" serve --socket "$NITROSENSE_BACKEND_SOCKET" > "$session/backend.log" 2>&1 &
backend_pid=$!
attempt=0
while [ ! -S "$NITROSENSE_BACKEND_SOCKET" ]; do
    if ! kill -0 "$backend_pid" 2>/dev/null; then echo "Backend failed; inspect $session/backend.log" >&2; exit 1; fi
    attempt=$((attempt+1)); if [ "$attempt" -gt 100 ]; then echo 'Backend startup timed out' >&2; exit 1; fi
    sleep 0.1
done
echo "Original Acer frontend with Rust backend. Private evidence: $session"
"$electron" --no-sandbox --ignore-certificate-errors "$project/frontend/host" --experimental-runtime ${inspect:+"$inspect"} --vendor "$vendor" > "$session/frontend.log" 2>&1 &
frontend_pid=$!
result=0
wait "$frontend_pid" || result=$?
frontend_pid=
exit "$result"
