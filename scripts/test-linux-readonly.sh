#!/bin/sh
# Operator-run real reading experiment. Never invoke this from automated tests.
set -eu
umask 077
acer_wmi=0
case "$#:${1:-}" in
    0:) ;;
    1:--with-acer-wmi) acer_wmi=1 ;;
    *) echo 'Usage: sh scripts/test-linux-readonly.sh [--with-acer-wmi]' >&2; exit 1 ;;
esac
if [ "$(uname -s)" != Linux ]; then echo 'Requires Linux.' >&2; exit 1; fi
if [ "$(id -u)" -eq 0 ]; then echo 'Run as the desktop user, without sudo.' >&2; exit 1; fi
project=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project"
output="$project/.state/linux-readonly-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$project/.state"
mkdir "$output"
echo "Evidence directory: $output"
for cmd in node npm; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "Missing command: $cmd" | tee "$output/error.txt" >&2
        exit 1
    fi
done
if ! node -e 'if(Number(process.versions.node.split(".")[0])<18)process.exit(1)'; then
    echo 'Requires Node.js 18 or newer.' | tee "$output/error.txt" >&2
    exit 1
fi
{
    date -u +%Y-%m-%dT%H:%M:%SZ
    uname -srmo
    node --version
    npm --version
    printf 'mode=read-only\nDISPLAY=%s\nWAYLAND_DISPLAY=%s\nXDG_SESSION_TYPE=%s\n' "${DISPLAY:-}" "${WAYLAND_DISPLAY:-}" "${XDG_SESSION_TYPE:-}"
    if command -v nvidia-smi >/dev/null 2>&1; then printf 'nvidia-smi=present\n'; else printf 'nvidia-smi=absent\n'; fi
    printf 'acer-wmi-preparation-requested=%s\n' "$acer_wmi"
} > "$output/environment.txt"
if ! node scripts/check-runtime.cjs > "$output/vendor-check.json" 2> "$output/vendor-check-error.txt"; then
    echo "Vendor verification failed. Preserve $output; do not reimport vendor." >&2
    exit 1
fi
export NITROSENSE_STATE_DIR="$output/app-state"
unset NITROSENSE_ELECTRON
electron="$project/.tools/electron-runtime/node_modules/.bin/electron"
if [ ! -x "$electron" ] || ! node -e 'if(require("./.tools/electron-runtime/node_modules/electron/package.json").version!=="26.6.10")process.exit(1)' 2>/dev/null; then
    echo 'Installing local Electron 26.6.10. This may download the Linux runtime.'
    if ! npm install --prefix .tools/electron-runtime --save-exact --no-audit --no-fund electron@26.6.10 > "$output/install.log" 2>&1; then
        echo "Runtime installation failed. Preserve $output/install.log locally." >&2
        exit 1
    fi
fi
if [ "$acer_wmi" -eq 1 ]; then
    echo 'Preparing Acer sensor/profile interfaces for this boot before opening the UI.'
    echo 'Only a module reload may request sudo; Electron will run as the desktop user.'
    if sh scripts/validate-linux-sensors.sh --output "$output/acer-wmi"; then
        printf '0\n' > "$output/acer-wmi-exit-code.txt"
    else
        result=$?
        printf '%s\n' "$result" > "$output/acer-wmi-exit-code.txt"
        echo "Acer module preparation failed; UI was not started. Preserve $output." >&2
        exit "$result"
    fi
else
    echo 'CPU/RAM monitoring does not require predator_v4; no module reload requested.'
    echo 'For the Acer sensor/profile preparation in this same boot, use --with-acer-wmi.'
fi
{
    printf 'boot_id='
    cat /proc/sys/kernel/random/boot_id
    if [ -d /sys/module/acer_wmi ]; then
        echo 'acer_wmi_loaded=yes'
        printf 'predator_v4='
        if [ -r /sys/module/acer_wmi/parameters/predator_v4 ]; then
            cat /sys/module/acer_wmi/parameters/predator_v4
        else
            echo 'unavailable'
        fi
    else
        echo 'acer_wmi_loaded=no'
    fi
} > "$output/module-at-launch.txt"
if ! node scripts/read-linux-sensors.cjs "$output/sensors-at-launch.json"; then
    echo 'Sensor inventory failed; CPU/RAM/GPU availability will still be recorded by the backend.' >&2
fi
echo 'Opening original Acer UI with Linux readings, SimulatorMode=0. Hardware controls unavailable.'
echo 'Wait 30-60 seconds, inspect monitoring and AppCenter; do not change profiles/fans/settings.'
echo 'To finish, press Ctrl+C in THIS terminal, then wait for the summary below.'
echo 'The original X hides the window and may leave the process running.'
interrupted=0
# Ctrl+C reaches both the foreground Electron and this shell. Keep the shell
# alive long enough to record termination and summarize, without forcing X exit.
trap 'interrupted=1' INT
if sh scripts/start-linux.sh --read-only > "$output/launch.log" 2>&1; then result=0; else result=$?; fi
printf '%s\n' "$result" > "$output/exit-code.txt"
if grep -Fq 'NitroSense is already running; bringing its window forward.' "$output/launch.log"; then
    echo 'NitroSense is already running. Its existing window has been brought forward.'
    exit "$result"
fi
if [ "$result" -ne 0 ] && grep -Fq 'EADDRINUSE' "$output/launch.log"; then
    echo 'NitroSense could not start: a local service port is already occupied.' >&2
    echo 'Stop any older NitroSense session with Ctrl+C in its terminal, then retry npm start.' >&2
fi

printf 'terminalInterruptObserved=%s\n' "$interrupted" > "$output/collector-status.txt"
if node scripts/summarize-ui-session.cjs "$output" > "$output/session-summary.json"; then
    cat "$output/session-summary.json"
else
    echo 'Summary failed; preserve the evidence directory locally.' >&2
fi
if node scripts/check-manual-readings.cjs "$output" > "$output/manual-reading-check.json"; then
    echo 'CPU/RAM backend evidence confirmed: simulator disabled, procfs sources and multiple samples.'
else
    echo 'Real CPU/RAM backend evidence not confirmed; preserve manual-reading-check.json for diagnosis.' >&2
fi
echo "Test finished. Evidence saved: $output"
echo 'Raw launch.log can contain credentials. Do not paste it into chat.'
trap - INT
exit "$result"
