# Current operator scripts

The backend, resource import/setup, static inspection, diagnostics and primary evidence audit are Rust commands. See [development](../docs/development.md) and [backend commands](../backend/README.md).

This directory retains current kernel maintenance tools:

- `sh scripts/load-battery-driver.sh`: build/load the verified charge driver for this boot.
- `sh scripts/install-battery-driver.sh`: install it for future boots of the current kernel; repeat after kernel upgrades.
- `sh scripts/validate-linux-sensors.sh`: inspect/prep the checked Acer interfaces; may request privilege for module reload.
- `sh scripts/probe-acer-wmi.sh`: explicit operator research, not automatic hardware acceptance.
- `node scripts/audit-reverse-engineering.cjs --verify-original`: retained shared evidence audit until replacement coverage is fully accepted. Its inert ASAR parser is in `legacy/lib/`.

Keep the desktop application unprivileged. See [driver documentation](../drivers/nitrosense-charge/README.md) for scope and removal. These scripts do not complete original Personal Settings integration.

Retired Node launchers, importers, diagnostics, static mapping and Windows research tools have moved to [legacy/scripts](../legacy/scripts/). Do not use their simulator as production evidence. The original production UI is launched with `sh frontend/start.sh --experimental-runtime`; our backend is Rust.

The retained sensor/module operator scripts still call archived read-only inventory utilities for diagnostic captures. This is a documented temporary operator-tool dependency, separate from the Rust service and normal frontend launcher.
