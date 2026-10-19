# Development status

Updated 2026-10-18. This is an experimental read-only compatibility layer, prior to its initial release. The version in `package.json` is a development identifier, not a stable release announcement.

## Evidence and progress

- The original NitroSense 5.1.392 interface was observed opening in Linux Electron 26.6.10. Startup fixes apply compatibility flags before Chromium initialization, and in-memory main/renderer patches preserve the imported ASAR bytes.
- CPU/RAM data was observed in the real interface using Linux procfs/sysfs. The backend records sample timestamps and sources; unsupported readings are omitted rather than invented.
- Acer CPU/GPU fan RPM and GPU temperature were observed through `acer-wmi`. Channel attribution is deliberately limited to ANV15-52 on Linux 7.0.x with the verified driver binding.
- Battery charge, cycle count, and capacity ratio are connected to the system battery where available. Ambiguous multiple-battery configurations and peripheral batteries are excluded.
- NVIDIA telemetry uses `nvidia-smi`. A driver kernel-module/userspace mismatch previously prevented readings. The maintainer reports that operation succeeded after rebooting following the driver update. This is a single-machine confirmation, not a broader GPU compatibility claim.
- Linux desktop application discovery is integrated into the original AppCenter. It does not establish complete application launching or association support.
- Source-only unit/regression tests and optional local vendor integration tests cover parsing, data provenance, protocol handling, patches, import validation, and startup behavior. Tests are not a substitute for on-hardware acceptance.

## Verification for NitroSense 5.2.84

- Downloaded the official Acer ZIP and pinned its SHA-256, main AppX filename, MSI, ASAR, main source and renderer source hashes.
- Completed a fresh Linux resource import using read-only `msiinfo`/`cabextract` extraction: **762 files verified**, original ASAR intact.
- Updated the main and renderer patches for the new build and checked their JavaScript syntax and isolated vendor behavior.
- Automated suite with the official local ASAR: **155 passed, 4 skipped, 0 failed**. Skips require private protocol/reference inputs or the optional MSI fixture path.
- `npm run setup` automates download, verification, resource import and pinned Electron installation. The setup command requires installed Linux extraction tools.
- These checks do not certify graphical startup or real hardware readings for 5.2.84. Earlier on-device observations above belong to 5.1.392; repeat the manual checklist for this update.

Only the exact hardware/software configuration in the root README has been checked. No fresh-machine installer acceptance, multi-model compatibility, long-duration reliability, or security audit is claimed.

## Remaining gaps

- Hardware writes: fan mode/speed, performance profiles, lighting, overclocking, battery settings and calibration are not implemented/validated.
- Original Windows integrations and Acer online functionality are incomplete or intentionally unavailable.
- Full Checkup, complete system information, network throughput and RAM clock reporting remain incomplete. A visible UI section does not mean every field is supported.
- Native Wayland rendering has not been established separately from running in a Wayland desktop session.
- The normal launcher is read-only. The legacy `test-linux-ui.sh` experiment explicitly uses simulated Acer data and must not be used as real monitoring evidence.
- Some vendor integration tests need privately generated protocol/MSI reference captures in addition to the local vendor import. These skip when the required inputs are missing.
- The supported runtime is old and starts without normal sandbox/certificate protections. Hardening and runtime migration remain necessary before a stable release.

See the [roadmap](roadmap.md) for acceptance criteria and [manual testing](manual-testing.md) for what users can verify today.
