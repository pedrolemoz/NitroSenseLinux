#!/bin/sh
# Operator-run, temporary driver trial. No persistent module configuration.
set -eu
if [ "${1:-}" != --trial-v4 ] || [ "$#" -ne 1 ]; then
    echo 'Usage: sh scripts/probe-acer-wmi.sh --trial-v4' >&2; exit 1
fi
if [ "$(uname -s)" != Linux ]; then echo 'Requires Linux.' >&2; exit 1; fi
if [ "$(cat /sys/class/dmi/id/sys_vendor)" != Acer ] ||
   [ "$(cat /sys/class/dmi/id/product_name)" != 'Nitro ANV15-52' ]; then
    echo 'This experiment was prepared only for Acer Nitro ANV15-52.' >&2; exit 1
fi
guid=/sys/bus/wmi/devices/7A4DDFE7-5B5D-40B4-8595-4408E0CC7F56
if [ ! -d "$guid" ]; then echo 'Required Acer gaming WMI GUID is absent.' >&2; exit 1; fi
for cmd in node modprobe modinfo sudo; do
    if ! command -v "$cmd" >/dev/null 2>&1; then echo "Missing command: $cmd" >&2; exit 1; fi
done
if ! modinfo -p acer_wmi | grep -q '^predator_v4:'; then
    echo 'Installed acer_wmi does not advertise predator_v4; no change made.' >&2; exit 1
fi
project=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
output="$project/.state/acer-wmi-$stamp"
mkdir -p "$project/.state"
mkdir "$output"
node "$project/legacy/scripts/inspect-linux.cjs" "$output/before.json"
loaded=no
if [ -d /sys/module/acer_wmi ]; then loaded=yes; fi
printf '%s\n' "$loaded" > "$output/previously-loaded.txt"
: > "$output/previous-parameters.txt"
if [ "$loaded" = yes ]; then
    for file in /sys/module/acer_wmi/parameters/*; do
        [ -f "$file" ] || continue
        name=${file##*/}
        case "$name" in *[!a-zA-Z0-9_]*) echo 'Invalid parameter name' >&2; exit 1;; esac
        value=$(cat "$file")
        case "$value" in ''|*[!0-9NYny-]*) echo 'Unexpected module parameter value' >&2; exit 1;; esac
        printf '%s=%s\n' "$name" "$value" >> "$output/previous-parameters.txt"
    done
fi
echo 'Temporarily reloading acer_wmi with predator_v4=1; no configuration file is changed.'
echo 'The script does not write PWM or profile values. Loading the driver initializes firmware interfaces.'
if [ "$loaded" = yes ]; then
    if ! sudo modprobe -r acer_wmi; then
        echo 'Module could not be removed; no forced removal attempted.' >&2; exit 1
    fi
fi
set --
while IFS= read -r parameter; do
    case "$parameter" in predator_v4=*) continue;; esac
    set -- "$@" "$parameter"
done < "$output/previous-parameters.txt"
if ! sudo modprobe acer_wmi "$@" predator_v4=1; then
    echo 'Trial load failed.' >&2
    if [ "$loaded" = yes ]; then
        set --
        while IFS= read -r parameter; do set -- "$@" "$parameter"; done < "$output/previous-parameters.txt"
        if ! sudo modprobe acer_wmi "$@"; then
            echo 'Could not restore the previous module load; reboot restores boot configuration.' >&2
        fi
    fi
    echo "Evidence directory: $output" >&2; exit 1
fi
node "$project/legacy/scripts/inspect-linux.cjs" "$output/after.json"
cat /sys/module/acer_wmi/parameters/predator_v4 > "$output/trial-parameter.txt"
echo "Evidence directory: $output"
echo 'Trial remains active for this boot. Reboot to return to the original boot configuration.'
