# Manual testing with real hardware

Use only the target ANV15-52 configuration for the current acceptance run. Finish the README setup first. These Linux checks do not replace the unresolved Windows captures linked in the migration ledger.

## Original Windows screenshot baseline

Use the [reviewed reference matrix](../references/README.md) and
[image manifest](../references/manifest.json) for every affected page. The 20
captures were supplied from Windows 11 on the target ANV15-52. Settings shows
NitroSense 5.1.392; the Linux import is 5.2.84. The user confirmed that the
newer interface is unchanged, so this is the authoritative UI baseline for both. Follow the matrix's comparison
procedure and record reference IDs, viewport/scale, power/mode/sidebar state,
Linux evidence paths, visual results and separately verified behavior. These
references have been reviewed; comparison against the restored Linux UI remains
pending. Screenshot review alone is not Linux acceptance.

Scenario must retain its Mode/Fan Control/Advanced Settings structure. AC captures
show Quiet/Balanced/Performance; battery captures show Eco/Balanced. Charging must
use the existing Personal Settings → Battery & Charge radio choices. USB charging
and calibration are separate functions and are not covered by the health driver.

## Start and stop

1. Run `nvidia-smi` in your desktop terminal. It must identify the GPU without a driver/library mismatch.
2. From the repository root, run `sh frontend/start.sh --experimental-runtime`. It verifies the vendor import and starts read-only mode; it never falls back to the Acer simulator.
3. If Acer sensors are missing, finish the session and run `sh scripts/validate-linux-sensors.sh`, followed by the frontend launcher. This checks existing interfaces, then may request sudo for a temporary `acer_wmi` reload with `predator_v4=1`. Reloading initializes firmware interfaces; no PWM/profile values or persistent boot configuration are written. Do not run the entire application as root. A reboot returns to the system's boot module configuration.
4. Wait 30–60 seconds and open Monitoring. Record whether readings change over time.
5. Stop with Ctrl+C in the same terminal. The original X may only hide the window. Code 130 after your interrupt is expected.
6. Run `cargo run --manifest-path backend/Cargo.toml -p nitrosense-service --bin nitrosense-backend -- diagnose`. Keep the evidence directory printed by the launcher.

## Compare actual readings

| Check | Expected behavior / comparison |
| --- | --- |
| CPU and memory | Values refresh and broadly agree with Ubuntu System Monitor or `top` / `free -m`. Sampling time and units can differ. |
| GPU | Name, utilization and clocks agree approximately with `nvidia-smi`; unavailable fields stay `--`. |
| CPU/GPU fans and temperature | Compare against identified `coretemp` / Acer hwmon channels, not an arbitrary numbered temperature sensor. The Rust `diagnose` command reports available readings and their sources; identify hwmon channels independently. |
| Battery | Charge agrees with Ubuntu's battery indicator; cycles and capacity ratio appear only if the system battery exposes them. |
| AppCenter | Lists real desktop entries. Do not treat listing as proof that application launch/association is finished. |
| Unsupported features | No claim of functional Linux fan control, lighting, profiles, calibration or full Checkup. Avoid changing these controls. |
| Simulator state | The Rust launcher has no simulator fallback. `diagnose` reads actual sources separately; compare simultaneous values with the original UI. |

Do not compare numbers as if samples were simultaneous. Missing telemetry is a failure to investigate or an explicitly unsupported field; it is not permission to substitute sample data.

## Regression acceptance still to perform

For the initial release, repeat after a cold boot and suspend/resume, test AC/battery transitions, and observe a longer monitoring session. These are pending acceptance tasks, not claims that the project has already passed them. Do not deliberately break your graphics driver or unload modules while another session is running.

## Reporting

Include the project revision, OS/kernel, session type, laptop model, driver version, exact command, affected field and expected/actual behavior. Identify whether you ran sensor/module preparation and whether a reboot helped. Review summaries before sharing; raw diagnostics can contain private identifiers and credentials. Never attach Acer archives, extracted code/resources, or the entire `.state` directory.

The developer command `sh legacy/scripts/test-linux-ui.sh` is explicitly a simulator experiment. It cannot validate real hardware readings.

## Battery driver and original UI

1. Build/load the driver with `sh scripts/load-battery-driver.sh`, or install it
   for future boots using `sh scripts/install-battery-driver.sh`. Authenticate in
   Ubuntu's dialog; keep the desktop app unprivileged.
2. Read the current limit from
   `/sys/bus/wmi/devices/79772EC5-04B1-4BFD-843C-61E7F77B6CC9/charge_control_end_threshold`.
   The Rust `charge-status` command reports actual threshold/readback. Deliberate
   writes require a separately started service with `--allow-charge-writes` and
   API `set_charge_limit`; see the backend API. Record and restore the original
   setting. This does not enable the unfinished original-UI integration.
3. Firmware readback verifies the selected setting, not physical charging across
   a full cycle. Observe charge behavior over time on AC.
4. After persistent installation, reboot and confirm module autoload, user write
   permission and the selected limit. Rebuild after a kernel upgrade.
5. Use the supplied [original-app screenshots](../references/README.md) for UI validation. Preserve
   the original Scenario and Personal Settings layouts and controls. Charge-limit
   integration belongs in Personal Settings. Scenario compatibility and charging
   through the original UI are currently pending; the custom panel was removed.

Previous custom-panel screenshots and button checks are historical evidence only.
They do not verify the restored original UI. The custom-panel inspection harness
was removed along with that UI.
