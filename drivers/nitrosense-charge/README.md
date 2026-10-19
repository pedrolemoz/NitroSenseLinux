# NitroSense battery charge driver

GPL-2.0-only kernel module scoped to Acer **Nitro ANV15-52**. It binds the
battery-health WMI GUID `79772EC5-04B1-4BFD-843C-61E7F77B6CC9` and exposes:

```
/sys/bus/wmi/devices/79772EC5-04B1-4BFD-843C-61E7F77B6CC9/charge_control_end_threshold
```

Only **80** and **100** are accepted. Probe/unload do not change the setting.
Every read queries firmware; every write requires firmware readback. Writes are
serialized and refused while firmware reports active battery calibration. No
calibration control, EC access, fan or power-profile writes are implemented.

The wire protocol is documented by the independently developed
[acer-wmi-battery driver](https://github.com/frederik-h/acer-wmi-battery): WMI
method 20 queries health capabilities and status; method 21 changes the health
mode using battery index 1. This implementation validates response buffers before
access, uses a device-bound WMI driver, and does not cache requested state.

Build and enable for the current boot (Ubuntu asks for administrator authentication):

```sh
sh scripts/load-battery-driver.sh
```

Install for future boots of the running kernel:

```sh
sh scripts/install-battery-driver.sh
```

Build requires `make`, a C compiler and headers matching `uname -r`. The installer
copies the module into the running kernel's `extra/`, runs depmod, adds
`/etc/modules-load.d/nitrosense-charge.conf`, and a narrow udev bind rule giving
the installing user's UID write access to this attribute. Re-run after a kernel
upgrade; automatic DKMS rebuilding is not implemented. Secure Boot module signing
is not automated. The development machine has Secure Boot disabled.

On ANV15-52, Ubuntu kernel 7.0.0-38-generic: compiled and loaded; queried initial
80%; wrote 100% and 80% and confirmed both through separate firmware reads;
restored initial 80%. This verifies the firmware health-mode switch, not a timed
physical charge/discharge experiment or reboot acceptance.

To uninstall:

```sh
sudo rm /etc/modules-load.d/nitrosense-charge.conf /etc/udev/rules.d/80-nitrosense-charge.rules
sudo modprobe -r nitrosense_charge
sudo rm /lib/modules/$(uname -r)/extra/nitrosense_charge.ko
sudo depmod -a
sudo udevadm control --reload-rules
```

Unloading leaves the selected firmware charge setting in place. Select 100% first
if full charging is desired.

## Application integration and confirmed installation

The driver remains installed and working after removal of the temporary custom
Scenario UI. Working operation was confirmed on the target machine. Charging
controls belong to the original application's **Personal Settings** page. Wiring
those existing controls to the Rust backend remains incomplete; all 20 reference
screenshots are available in `references/`. No custom Scenario charging panel remains.

The current Rust charge adapter in `backend/crates/linux/src/charge.rs` detects
the supported device/driver ABI and distinguishes requested state from independent
readback. The application validates 80/100 limits. Hardware writes are disabled
by the frontend launcher and require an explicitly enabled standalone service;
see [the backend API](../../backend/README.md). Automated tests use fixtures and
do not write hardware. The old Node adapter is archived in `legacy/lib/` and is
not the production backend.

For a deliberate read-only query from the repository root after building:

```sh
backend/target/debug/nitrosense-backend charge-status
```

This connects to a running service. `nitrosense-backend diagnose` can instead
query actual sources directly without a socket or hardware writes. Historical
driver verification below is not Rust original-frontend or physical charging acceptance.

Actual installation on 7.0.0-38-generic created:

- `/lib/modules/7.0.0-38-generic/extra/nitrosense_charge.ko`
- `/etc/modules-load.d/nitrosense-charge.conf`
- `/etc/udev/rules.d/80-nitrosense-charge.rules`

The rule grants the installing desktop UID ownership of only the threshold
attribute on this driver's bind event. Installed files and rule evaluation were
checked. Boot autoload is configured; reboot acceptance remains outstanding.
An unsupported 81% request was rejected by the loaded driver with `EINVAL`.
The verified initial and restored limit was 80%.
