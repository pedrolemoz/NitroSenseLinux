#!/bin/sh
# Operator-run original Acer UI experiment. Logs survive when project storage does.
set -eu
if [ "$#" -ne 0 ]; then echo 'Usage: sh scripts/test-linux-ui.sh' >&2; exit 1; fi
if [ "$(uname -s)" != Linux ]; then echo 'Requires Linux.' >&2; exit 1; fi
project=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project"
output="$project/.state/linux-ui-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$project/.state"
mkdir "$output"
echo "Evidence directory: $output"
for cmd in node npm; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "Missing command: $cmd" | tee "$output/error.txt" >&2
        exit 1
    fi
done
if [ "$(id -u)" -eq 0 ]; then
    echo 'Run as the desktop user, without sudo.' | tee "$output/error.txt" >&2
    exit 1
fi
{
    date -u +%Y-%m-%dT%H:%M:%SZ
    uname -srmo
    node --version
    npm --version
    printf 'DISPLAY=%s\nWAYLAND_DISPLAY=%s\nXDG_SESSION_TYPE=%s\n' "${DISPLAY:-}" "${WAYLAND_DISPLAY:-}" "${XDG_SESSION_TYPE:-}"
} > "$output/environment.txt"
if node scripts/check-runtime.cjs > "$output/vendor-check.json" 2> "$output/vendor-check-error.txt"; then
    :
else
    cat "$output/vendor-check-error.txt" >&2
    echo 'Vendor verification failed; preserve the evidence directory.' >&2
    exit 1
fi

# Keep both Electron state and any Acer logs on persistent project storage.
export NITROSENSE_STATE_DIR="$output/app-state"
unset NITROSENSE_ELECTRON
electron="$project/.tools/electron-runtime/node_modules/.bin/electron"
if [ ! -x "$electron" ] || ! node -e 'if(require("./.tools/electron-runtime/node_modules/electron/package.json").version!=="26.6.10")process.exit(1)' 2>/dev/null; then
    echo 'Installing the local Electron 26.6.10 runtime. Download may take a few minutes.'
    if npm install --prefix .tools/electron-runtime --save-exact --no-audit --no-fund electron@26.6.10 > "$output/install.log" 2>&1; then
        :
    else
        cat "$output/install.log" >&2
        echo "Runtime installation failed. Preserve $output" >&2
        exit 1
    fi
fi
echo 'Opening the original Acer UI with its simulator. No real hardware control.'
echo 'Check whether the window opens, then close it to finish collecting logs.'
echo "If no window opens, inspect $output/launch.log from another terminal; Ctrl+C stops this test."
if sh scripts/start-linux.sh --ui-only > "$output/launch.log" 2>&1; then
    result=0
else
    result=$?
fi
printf '%s\n' "$result" > "$output/exit-code.txt"
# Do not print raw Acer logs: they can contain push tokens and cookies.
if node scripts/summarize-ui-session.cjs "$output" > "$output/session-summary.json"; then
    cat "$output/session-summary.json"
else
    echo 'Could not summarize this session; preserve launch.log locally.' >&2
fi
echo "Test finished. Share this directory: $output"
exit "$result"
