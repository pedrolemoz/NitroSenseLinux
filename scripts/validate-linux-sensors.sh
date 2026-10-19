#!/bin/sh
# Operator-run validation in one Linux session; may perform the temporary trial.
set -eu
requested_output=
case "$#:${1:-}" in
    0:) ;;
    2:--output) requested_output=$2 ;;
    *) echo 'Usage: sh scripts/validate-linux-sensors.sh [--output NEW_DIRECTORY]' >&2; exit 1 ;;
esac
if [ "$(uname -s)" != Linux ]; then echo 'Requires Linux.' >&2; exit 1; fi
project=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project"
output=${requested_output:-"$project/.state/linux-validation-$(date -u +%Y%m%dT%H%M%SZ)"}
mkdir -p "$project/.state"
mkdir "$output"
echo "Evidence directory: $output"

status() {
    date -u +%Y-%m-%dT%H:%M:%SZ
    uname -r
    printf 'boot_id='
    cat /proc/sys/kernel/random/boot_id
    printf 'uptime='
    cat /proc/uptime
    if [ -d /sys/module/acer_wmi ]; then
        echo 'acer_wmi_loaded=yes'
        for file in /sys/module/acer_wmi/parameters/*; do
            [ -f "$file" ] || continue
            printf '%s=' "${file##*/}"
            cat "$file"
        done
    else
        echo 'acer_wmi_loaded=no'
    fi
}

status > "$output/module-before.txt"
node legacy/scripts/read-linux-sensors.cjs "$output/sensors-before.json"
parameter=/sys/module/acer_wmi/parameters/predator_v4
value=absent
if [ -f "$parameter" ]; then value=$(cat "$parameter"); fi
# A newer kernel may recognize the model with the override still at N.
# Preserve native quirks instead of replacing them with the generic override.
acer_hwmon=no
acer_profile=no
for device in /sys/class/hwmon/hwmon*; do
    [ -r "$device/name" ] || continue
    if [ "$(cat "$device/name")" = acer ]; then
        for reading in "$device"/fan*_input "$device"/temp*_input; do
            if [ -r "$reading" ]; then acer_hwmon=yes; break; fi
        done
    fi
done
for device in /sys/class/platform-profile/*; do
    [ -r "$device/name" ] || continue
    if [ "$(cat "$device/name")" = acer-wmi ] && [ -r "$device/profile" ]; then acer_profile=yes; fi
done
if [ "$acer_hwmon" = yes ] && [ "$acer_profile" = yes ]; then
    echo 'Acer sensor/profile interfaces already exposed; preserving native module settings.'
else
case "$value" in
    Y|y|1) echo 'predator_v4 already active; keeping the existing module load.' ;;
    *)
        echo 'Applying the temporary driver trial. sudo may be requested.'
        echo 'This reload initializes firmware interfaces; no PWM/profile value or boot configuration is written.'
        if sh scripts/probe-acer-wmi.sh --trial-v4; then
            printf '0\n' > "$output/trial-exit-code.txt"
        else
            result=$?
            printf '%s\n' "$result" > "$output/trial-exit-code.txt"
            status > "$output/module-after.txt"
            echo "Trial failed; preserve $output and the terminal error." >&2
            exit "$result"
        fi
        ;;
esac
fi
status > "$output/module-after.txt"
node legacy/scripts/read-linux-sensors.cjs "$output/sensors-after.json"
echo "Completed. Share this directory: $output"
echo 'Capture is saved on disk; rebooting afterward does not erase it.'
echo 'The trial parameter remains temporary. No physical control change was tested.'
