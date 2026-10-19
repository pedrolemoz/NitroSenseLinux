# Historical Node implementation status

Preserved historical observations; these do not certify Rust behavior. Paths and commands below describe the pre-rewrite checkout.

Updated 2026-10-18. This is an experimental Linux compatibility layer, prior to its initial release. The version in `package.json` is a development identifier, not a stable release announcement.

## Evidence and progress

- The original NitroSense 5.1.392 interface was observed opening in Linux Electron 26.6.10. Startup fixes apply compatibility flags before Chromium initialization, and in-memory main/renderer patches preserve the imported ASAR bytes.
- CPU/RAM data was observed in the real interface using Linux procfs/sysfs. The backend records sample timestamps and sources; unsupported readings are omitted rather than invented.
- Acer CPU/GPU fan RPM and GPU temperature were observed through `acer-wmi`. Channel attribution is deliberately limited to ANV15-52 on Linux 7.0.x with the verified driver binding.
- Battery charge, cycle count, and capacity ratio are connected to the system battery where available. Ambiguous multiple-battery configurations and peripheral batteries are excluded.
- NVIDIA telemetry uses `nvidia-smi`. A driver kernel-module/userspace mismatch previously prevented readings. Operation succeeded after rebooting following the driver update. This is a single-machine confirmation, not a broader GPU compatibility claim.
- Linux desktop application discovery is integrated into the original AppCenter. It does not establish complete application launching or association support.
- Source-only unit/regression tests and optional local vendor integration tests cover parsing, data provenance, protocol handling, patches, import validation, and startup behavior. Tests are not a substitute for on-hardware acceptance.

## Verification for NitroSense 5.2.84

- Downloaded the official Acer ZIP and pinned its SHA-256, main AppX filename, MSI, ASAR, main source and renderer source hashes.
- Completed a fresh Linux resource import using read-only `msiinfo`/`cabextract` extraction: **762 files verified**, original ASAR intact.
- Updated the main and renderer patches for the new build and checked their JavaScript syntax and isolated vendor behavior.
- Initial import-era automated suite with the official local ASAR: **155 passed, 4 skipped, 0 failed**. Skips require private protocol/reference inputs or the optional MSI fixture path.
- `npm run setup` automates download, verification, resource import and pinned Electron installation. The setup command requires installed Linux extraction tools.
- These checks do not certify graphical startup or real hardware readings for 5.2.84. Earlier on-device observations above belong to 5.1.392; repeat the manual checklist for this update.

Only the exact hardware/software configuration in the root README has been checked. No fresh-machine installer acceptance, multi-model compatibility, long-duration reliability, or security audit is claimed.

## Remaining gaps

- Hardware writes: fan mode/speed, performance profiles, lighting, overclocking and battery calibration are not implemented/validated.
- Original Windows integrations and Acer online functionality are incomplete or intentionally unavailable.
- Full Checkup, complete system information, network throughput and RAM clock reporting remain incomplete. A visible UI section does not mean every field is supported.
- Native Wayland rendering has not been established separately from running in a Wayland desktop session.
- The normal launcher uses read-only monitoring. The separately installed charge driver supports explicit 80%/100% writes. The legacy `test-linux-ui.sh` experiment explicitly uses simulated Acer data and must not be used as real monitoring evidence.
- Some vendor integration tests need privately generated protocol/MSI reference captures in addition to the local vendor import. These skip when the required inputs are missing.
- The supported runtime is old and starts without normal sandbox/certificate protections. Hardening and runtime migration remain necessary before a stable release.

See the [roadmap](roadmap.md) for acceptance criteria and [manual testing](manual-testing.md) for what users can verify today.

## Scenario and battery control

The temporary custom Scenario component and its charge buttons have been removed.
The original Acer Scenario class and template are preserved. Its missing-profile
and unavailable-capability failures remain unresolved; restoring the original UI
must not be described as completing Scenario compatibility. The Home webview
visibility fix remains: Home content must not cover other tabs.

Battery control belongs in **Personal Settings**, using the original program's
existing controls. That UI integration is pending reference screenshots from the
original app. No replacement panel or newly designed controls should be added.

The bundled GPL-2.0-only WMI driver remains intact and installed on the target
machine. It was built against 7.0.0-38-generic. Both 80% and 100% were confirmed by
separate firmware queries; the initial 80% setting was restored. Working driver
operation was subsequently confirmed on the machine. Loading does not change the
limit. Physical charge-cycle and reboot acceptance tests remain outstanding.
The installer supports the current kernel and must be rerun after kernel upgrades.
See the [driver documentation](../drivers/nitrosense-charge/README.md) and
[development record](development-history.md).

After the custom UI rollback, the full regression suite passed: **165 passed, 4 skipped, 0 failed**. The original Scenario class/template preservation test and driver-backend tests passed. This is source/integration evidence, not original Scenario graphical acceptance.

The 20 Windows 11 screenshots from the target machine have been reviewed and incorporated into the [validation matrix](../references/README.md). Settings displays 5.1.392; the user confirmed the interface is unchanged in the 5.2.84 Linux import, so the captures are authoritative for current UI validation. Reference review is complete; matched Linux visual acceptance remains pending.

## Scenario missing-data guards (2026-10-19)

Narrow in-memory patches now guard unavailable audio capability data, active
profile names, operating-mode lists and mode getters. The original Scenario
component/template remains in place. Regression coverage checks missing values,
recovery and preservation of the original component apart from those guards.
The full suite passed 168 tests with 4 private-input skips; an additional isolated
mode-getter regression also passed afterward.

Real read-only Electron inspection reached Scenario, Personal Settings and four
other pages. The final Scenario capture shows original CPU/GPU gauges and no
repeated `length`, `name`, `filter` or `opMode` errors in the bounded diagnostic
report. A separate existing JSON parsing error remains. Local evidence is in
`.state/linux-live-inspection-2026-10-19T04-04-58-788Z/`.

Comparison with MODE-AC-B is still **fail/incomplete**: no active profile or
supported mode cards, an extra Pulsar Lighting tab, and
`MUI_Mode_Intro_undefined` remain. Viewport/sidebar framing also differs.
Personal Settings still omits Battery Charge Mode; its original controls are not
yet integrated with the driver. No charge setting or other hardware state was
written during this iteration. This is crash-path progress, not complete Scenario
or battery UI acceptance.

## Original default profile compatibility (2026-10-19)

The missing profile was traced to Acer's preset initialization being coupled to
Windows keyboard/lighting discovery. In read-only Linux mode, the original
`Scenario.getScenario()` now initializes an empty list through Acer's existing
`getInitialProfile("MUI_DAILY_USE")` and `InsertProfile()` methods. Existing
profiles and valid selections are preserved; invalid active/select indices are
repaired and saved through the original store. No replacement UI, component or
profile schema was added, and the original profile factories are unchanged.

The full suite passed **170 tests, 4 skipped, 0 failed**. Real Electron capture
`.state/linux-live-inspection-2026-10-19T04-08-50-501Z/Scenario.png` shows **Daily
Use** selected in the original page and sidebar, with the original everyday-use
mode description. This supersedes the missing-profile and undefined-description
findings above. The sidebar's Balanced/Auto labels describe the saved Acer
profile, not verified firmware settings. No hardware write was made.
MODE-AC-B remains incomplete because supported mode cards are absent and the
extra lighting tab remains. Battery controls and the existing JSON parsing error
remain separate pending work.
