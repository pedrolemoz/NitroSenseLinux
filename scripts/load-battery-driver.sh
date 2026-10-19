#!/bin/sh
# Build as the desktop user; elevate only module loading and one sysfs owner.
set -eu
project=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
module="$project/drivers/nitrosense-charge/nitrosense_charge.ko"
attribute=/sys/bus/wmi/devices/79772EC5-04B1-4BFD-843C-61E7F77B6CC9/charge_control_end_threshold
if [ "${1:-}" = --root ]; then
    [ "$(id -u)" = 0 ] || { echo 'Administrator authentication required.' >&2; exit 1; }
    uid=${2:-}
    case "$uid" in ''|*[!0-9]*|0) echo 'Invalid desktop UID.' >&2; exit 1;; esac
    [ "$(cat /sys/class/dmi/id/sys_vendor)" = Acer ]
    [ "$(cat /sys/class/dmi/id/product_name)" = 'Nitro ANV15-52' ]
    if [ ! -d /sys/module/nitrosense_charge ]; then
        /usr/sbin/insmod "$module"
    fi
    if [ ! -f "$attribute" ]; then
        echo 'Firmware query did not expose a supported charge limit. Driver log:' >&2
        dmesg | tail -20 >&2
        exit 1
    fi
    # Grant access to this one validated 80/100-only attribute, for this boot.
    chown "$uid" "$attribute"
    chmod 0644 "$attribute"
    printf 'Firmware charge limit: '
    cat "$attribute"
    exit
fi
[ "$#" = 0 ] || { echo 'Usage: sh scripts/load-battery-driver.sh' >&2; exit 1; }
[ "$(id -u)" != 0 ] || { echo 'Run as your desktop user.' >&2; exit 1; }
make -C "$project/drivers/nitrosense-charge"
exec pkexec /bin/sh "$project/scripts/load-battery-driver.sh" --root "$(id -u)"
