# Script guide

The active backend and research/import/setup/audit tools are now Rust. Root npm
commands wrap those Rust binaries; see the root and `backend/` README files.
This directory retains earlier Node utilities and explicit kernel-operator
scripts as migration/regression evidence. Tables below describe those historical
entrypoints. They are not dependencies of the new frontend's backend. Use
`npm run start:legacy` only when deliberately testing the earlier implementation.

Run commands from the repository root. Normal users should follow the root README and its npm commands.

| Purpose | Entry point |
| --- | --- |
| Download official Acer 5.2.84, verify, import and install Electron | `setup.cjs` / `npm run setup` (optional `-- --zip <official.zip>`) |
| Extract and verify a supplied official installer on Linux | `prepare-linux-vendor.cjs` / `npm run prepare:vendor -- <installer-directory> <new-vendor-directory>` |
| Verify an existing local import | `check-runtime.cjs` / `npm run check` |
| Real UI monitoring with private session diagnostics | `test-linux-readonly.sh` / `npm start` |
| Same, with optional current-boot Acer module preparation | `npm run start:acer` |
| Direct launcher (read-only by default, no collector) | `sh scripts/start-linux.sh [--read-only] [vendor-directory]` |
| Assess saved real CPU/RAM sampling | `check-manual-readings.cjs` / `npm run verify:readings` |
| Inspect available Linux sensors | `read-linux-sensors.cjs` |
| Inspect Linux interfaces without hardware writes | `inspect-linux.cjs`, `summarize-linux.cjs` |
| Current-boot Acer interface preparation | `validate-linux-sensors.sh`, `probe-acer-wmi.sh` (operator-run; may reload a module with sudo) |
| Summarize private session diagnostics | `summarize-ui-session.cjs`, `summarize-reference.cjs` |

## Developer-only tools

`test-linux-ui.sh` and `start-linux.sh --ui-only` explicitly run the original **simulator**. They are isolated UI experiments, not real monitoring commands. `smoke-original-ui.cjs`, `inspect-live-ui.cjs`, `capture-reference.cjs` and related tools inspect/capture application behavior; check their arguments before use and keep outputs private.

`inspect-asar.cjs`, `inspect-runtime.cjs`, `map-boundaries.cjs`, `map-startup.cjs` and `map-protocol.cjs` support private static research. The mapping tools expect locally extracted original sources under `analysis/extracted/selected/` and a local Babel parser installation:

```sh
npm install --prefix .tools/rea --no-audit --no-fund @babel/parser
```

These tools are not part of the normal installation or source-only test prerequisites. Their output can contain proprietary code and must stay in ignored `analysis/`. `import-vendor.cjs` is the lower-level AppX/OEM importer; prefer the Linux preparation wrapper for end users.

`windows/*.ps1` preserves historical Windows MSI/AppX/WMI inspection tools. They are optional research utilities, not Linux prerequisites. Run them from the repository root if continuing Windows research; document any future need to return to Windows separately. No Windows execution was required for this reorganization.

## Battery charge driver

- `sh scripts/load-battery-driver.sh`: build and load the ANV15-52 driver for this
  boot. Ubuntu authentication is required only for module loading and access to
  the validated charge attribute.
- `sh scripts/install-battery-driver.sh`: additionally install for future boots
  of the current kernel. Re-run after kernel upgrades; no DKMS rebuild is added.

See [driver documentation](../drivers/nitrosense-charge/README.md) for protocol,
permission scope, manual checks and removal. The driver and Node backend remain
available independently of the original UI. Personal Settings integration is
pending; the temporary custom Scenario UI and its inspection script were removed.

## Mandatory reverse engineering checks

- `npm run inspect:original -- --symbol <symbol>` verifies the pinned ASAR and
  main/renderer hashes, extracts inert JavaScript and indexes literal symbol
  offsets under ignored `analysis/original-5.2.84/`. It does not execute Acer code,
  decompile native binaries, or recover the original source project.
- `npm run audit:changes` checks current implementation changes against research
  records and flags common replacement-UI patterns. `-- --base <revision>` selects
  a diff base; `-- --verify-original` additionally verifies recorded members and
  symbols against the local original ASAR. Exit 1 means findings or invalid input.

Follow [AGENTS.md](../AGENTS.md) and the [evidence workflow](../docs/reverse-engineering/README.md).
Screenshots complement behavioral verification; visual similarity is never the
implementation goal. Request targeted Windows inspection when local evidence
cannot resolve an original native/service contract.
