# Development record

Recorded 2026-10-18 (America/Fortaleza). This record distinguishes implemented
backend work, hardware observations, reverted UI experiments and pending work.

## Compatibility foundation

- The project runs user-supplied original Acer NitroSense assets on Linux using
  pinned Electron 26.6.10. Vendor integrity is checked before narrow in-memory
  source transformations; the imported ASAR is not modified on disk.
- Setup downloads the official NitroSense 5.2.84 ZIP, verifies pinned hashes,
  extracts with Linux tools, imports required resources and installs Electron.
  The fresh import verified 762 files. Acer assets remain private and ignored.
- Windows native/service boundaries are adapted to Linux or explicitly report
  unsupported operations. RPC callbacks are registered before publication,
  requests have deadlines, and errors settle instead of leaving pending work.
- Optional identity, analytics, lighting and online integration failures are
  isolated so independent local monitoring can initialize. Missing identities
  and unsupported capabilities are not fabricated.
- A stable single-instance lock prevents competing fixed-port service sessions.
  Linux title-bar handling and early Chromium compatibility flags were fixed.
  Sandbox/certificate hardening and runtime migration remain release blockers.

## Linux monitoring and application discovery

- CPU usage, frequency, temperature and memory readings use procfs/sysfs.
- NVIDIA monitoring uses `nvidia-smi`. A driver/userspace mismatch prevented
  readings until the graphics driver was updated and the machine rebooted.
- Acer fan RPM and GPU temperature use reviewed hwmon channels, scoped to
  ANV15-52, `acer-wmi` and Linux 7.0.x. Unknown channels remain unassigned.
- System battery percentage, cycle count and full/design capacity ratio are
  exposed when available. Peripheral and ambiguous multiple batteries are
  excluded. Missing readings remain unavailable rather than zero or simulated.
- Device models settle failures, invalidate stale replies and avoid optimistic
  local hardware state. Monitor views handle unavailable values and history gaps.
- Linux desktop entries populate the original AppCenter catalog. Launching,
  automatic association and game integration remain incomplete.
- Earlier general hardware observations used NitroSense 5.1.392. Later Scenario
  and battery experiments ran with 5.2.84; this is partial acceptance, not proof
  that every 5.2.84 page or Windows feature works.

## Scenario investigation and UI correction

1. Saved logs showed the original Scenario page dereferencing unavailable audio
   capabilities (`null.length`) and a missing profile (`undefined.name`).
2. A custom Linux Scenario component replaced the original component and placed
   new 80%/100% charging buttons there. This was an incorrect UI direction.
3. A separate blank-page cause was identified in real Electron inspection: the
   Home webview was created on other tabs, covering their content with an empty
   `/aframe` guest. `createReadOnlyHome` now creates it only on Home. This
   compatibility fix remains and has regression coverage.
4. The custom panel was rendered and its buttons tested against real firmware,
   including screenshot inspection. These checks apply only to that experiment.
5. The custom component, replacement source patch, panel tests and its dedicated
   hardware inspection harness were removed. The original Scenario component and
   template are restored, with an integration test checking they remain intact.
   UI banners no longer direct users to battery options in Scenario.

The original Scenario capability/profile problems remain pending. Restoring its
UI does not resolve those backend assumptions. Future work must preserve Acer's
existing pages and controls, using original-app screenshots as references.
Battery charging belongs in **Personal Settings**. No new UI or alternative
panel should be introduced. Connecting the original Personal Settings controls
to the working backend is the next battery UI task.

## Battery driver implementation and deployment

The target machine exposes Acer's battery-health WMI GUID but lacked a standard
power-supply charge-threshold file. A dedicated GPL-2.0-only module was written
in `drivers/nitrosense-charge/`, scoped to Acer Nitro ANV15-52.

- WMI method 20 queries health capability/state; method 21 changes health mode.
  The protocol reference is linked in the driver documentation.
- The device-bound driver validates firmware output type and length before
  access, serializes requests, accepts only 80 and 100, refuses writes while
  calibration is active, and confirms changes through a separate firmware read.
- Probe/unload do not change charge state. There are no EC register writes,
  calibration controls, fan controls or performance-profile writes.
- `lib/battery-charge.cjs` detects a single system battery and uses either the
  standard power-supply threshold ABI or the new Acer WMI driver attribute.
  Unsupported values, permissions and unconfirmed writes are reported as errors.
- `scripts/load-battery-driver.sh` builds unprivileged, then uses Ubuntu's
  authentication dialog to load the module and grant the desktop UID access to
  its single validated setting for the current boot.
- `scripts/install-battery-driver.sh` additionally installs the module in the
  running kernel's `extra/`, runs depmod, writes the modules-load configuration
  and a narrow udev bind rule. The desktop application remains unprivileged.
- Installation completed on kernel 7.0.0-38-generic. The module, boot configuration
  and permission rule were inspected; udev rule evaluation selected the intended
  attribute. Reboot execution of that rule has not yet been accepted on hardware.
- Automatic DKMS rebuilding is not implemented. Re-run installation after a
  kernel upgrade. Secure Boot is disabled on the checked machine; signing is
  not automated.

### Hardware verification

The initial firmware limit was 80%. The backend changed it to 100%, then 80%,
and separate firmware queries confirmed both values. The temporary panel's
buttons also exercised both settings successfully. The original 80% setting was
restored. An attempted 81% write was rejected by the real driver with `EINVAL`.
Working driver operation was subsequently confirmed on the target machine.

These results verify the firmware mode and driver path. They do not establish
physical charging across a full charge/discharge cycle, reboot persistence,
suspend/resume behavior or integration with the original Personal Settings UI.
The UI rollback does not uninstall or modify the driver or charge setting.

## Verification and next iteration

Before the custom UI rollback, the full suite reported **167 passed, 4 skipped,
0 failed**, alongside separate real Electron and driver checks. That count is a
historical result; removal of custom-panel tests changes the current total.
After restoring the original Scenario component, the full suite reported **165 passed, 4 skipped, 0 failed**. The original Scenario class/template preservation check and driver-backend tests passed. The installed driver still reported 80%; no hardware writes were made during this rollback. `npm test` remains the verification entry point. Local-socket tests need an
execution environment that permits loopback sockets. Private-reference skips do
not establish support for those inputs.

Next iteration:

- Use the supplied original-app screenshots to verify page structure, terminology
  and existing behavior before adapting the UI.
- Resolve original Scenario profile/capability handling without replacing it.
- Connect existing Personal Settings charge controls to the verified driver.
- Complete reboot, suspend/resume and physical charging acceptance checks.
- Keep fan, performance, lighting, automatic scenarios and calibration marked as
  incomplete until their original controls have validated Linux implementations.

See [status](status.md), [manual testing](manual-testing.md),
[driver details](../drivers/nitrosense-charge/README.md) and
[roadmap](roadmap.md) for the remaining release work.

## Windows screenshot reference review

Twenty original-app screenshots supplied from Windows 11 on the target machine
were visually reviewed and indexed in [the reference matrix](../references/README.md).
A manifest records dimensions and hashes. Settings displays version 5.1.392,
whereas the current Linux import is 5.2.84. The user confirmed that the newer
interface is unchanged; these captures are the authoritative UI baseline for
the current import too. The review confirms Scenario's
Mode/Fan Control/Advanced Settings layout, different AC/battery mode sets, and
charging under Personal Settings → Battery & Charge. USB charge limits and
calibration are separate functions. Source anomalies and gaps in captured states
are documented. Validation now requires reference IDs, comparable Linux captures
and separate behavioral/backend evidence. No new UI or driver changes were made
for this review; Linux visual comparisons remain pending.
