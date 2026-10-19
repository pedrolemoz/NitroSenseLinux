#!/bin/sh
# Persistent installation for the running kernel; no desktop app runs as root.
set -eu
project=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ "${1:-}" != --root ]; then
    [ "$#" = 0 ] || { echo 'Usage: sh scripts/install-battery-driver.sh' >&2; exit 1; }
    [ "$(id -u)" != 0 ] || { echo 'Run as the desktop user.' >&2; exit 1; }
    make -C "$project/drivers/nitrosense-charge"
    exec pkexec /bin/sh "$project/scripts/install-battery-driver.sh" --root "$(id -u)"
fi
[ "$(id -u)" = 0 ] && [ "$#" = 2 ]
uid=$2
case "$uid" in ''|*[!0-9]*|0) echo 'Invalid desktop UID.' >&2; exit 1;; esac
getent passwd "$uid" >/dev/null
# Load and confirm a successful firmware query before installing anything.
sh "$project/scripts/load-battery-driver.sh" --root "$uid"
kernel=$(uname -r)
module="$project/drivers/nitrosense-charge/nitrosense_charge.ko"
case "$(/usr/sbin/modinfo -F vermagic "$module")" in "$kernel "*) ;; *) echo 'Kernel mismatch.' >&2; exit 1;; esac
install -D -m 0644 "$module" "/lib/modules/$kernel/extra/nitrosense_charge.ko"
/usr/sbin/depmod -a "$kernel"
install -d -m 0755 /etc/modules-load.d /etc/udev/rules.d
printf '%s\n' nitrosense_charge > /etc/modules-load.d/nitrosense-charge.conf
# Bind happens after probe created the attribute. Access is limited to this UID
# and this driver's single 80/100-only setting; no broad WMI or EC permissions.
printf '%s\n' "ACTION==\"bind\", SUBSYSTEM==\"wmi\", KERNEL==\"79772EC5-04B1-4BFD-843C-61E7F77B6CC9\", DRIVER==\"nitrosense_charge\", RUN+=\"/bin/chown $uid /sys%p/charge_control_end_threshold\"" > /etc/udev/rules.d/80-nitrosense-charge.rules
udevadm control --reload-rules
printf '%s\n' 'Battery charge driver installed for the current kernel and future boots.' 'Re-run this installer after upgrading the kernel.'
