# Manual testing with real hardware

Use only the [checked configuration](../README.md#checked-compatibility) for the current acceptance run. Finish the README setup first. This checklist does not require Windows.

## Start and stop

1. Run `nvidia-smi` in your desktop terminal. It must identify the GPU without a driver/library mismatch.
2. From the repository root, run `npm start`. It verifies the vendor import and starts read-only mode; it never falls back to the Acer simulator.
3. If Acer sensors are missing, finish the session and run `npm run start:acer`. This checks existing interfaces, then may request sudo for a temporary `acer_wmi` reload with `predator_v4=1`. Reloading initializes firmware interfaces; no PWM/profile values or persistent boot configuration are written. Do not run the entire application as root. A reboot returns to the system's boot module configuration.
4. Wait 30–60 seconds and open Monitoring. Record whether readings change over time.
5. Stop with Ctrl+C in the same terminal. The original X may only hide the window. Code 130 after your interrupt is expected.
6. Run `npm run verify:readings`. Keep the evidence directory printed by the launcher.

## Compare actual readings

| Check | Expected behavior / comparison |
| --- | --- |
| CPU and memory | Values refresh and broadly agree with Ubuntu System Monitor or `top` / `free -m`. Sampling time and units can differ. |
| GPU | Name, utilization and clocks agree approximately with `nvidia-smi`; unavailable fields stay `--`. |
| CPU/GPU fans and temperature | Compare against identified `coretemp` / Acer hwmon channels, not an arbitrary numbered temperature sensor. `node scripts/read-linux-sensors.cjs` reads the available channels. |
| Battery | Charge agrees with Ubuntu's battery indicator; cycles and capacity ratio appear only if the system battery exposes them. |
| AppCenter | Lists real desktop entries. Do not treat listing as proof that application launch/association is finished. |
| Unsupported features | No claim of functional Linux fan control, lighting, profiles, calibration or full Checkup. Avoid changing these controls. |
| Simulator state | `verify:readings` confirms read-only mode, SimulatorMode=0 and multiple CPU/RAM samples from Linux sources. This is backend evidence; visually check the screen as well. |

Do not compare numbers as if samples were simultaneous. Missing telemetry is a failure to investigate or an explicitly unsupported field; it is not permission to substitute sample data.

## Regression acceptance still to perform

For the initial release, repeat after a cold boot and suspend/resume, test AC/battery transitions, and observe a longer monitoring session. These are pending acceptance tasks, not claims that the project has already passed them. Do not deliberately break your graphics driver or unload modules while another session is running.

## Reporting

Include the project revision, OS/kernel, session type, laptop model, driver version, exact command, affected field and expected/actual behavior. Identify whether you used `start:acer` and whether a reboot helped. Review summaries before sharing; raw diagnostics can contain private identifiers and credentials. Never attach Acer archives, extracted code/resources, or the entire `.state` directory.

The developer command `sh scripts/test-linux-ui.sh` is explicitly a simulator experiment. It cannot validate real hardware readings.
