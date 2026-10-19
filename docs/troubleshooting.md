# Troubleshooting

## Nothing opens

Launch from a graphical desktop terminal using `npm start`. Read the printed evidence directory and inspect its error files locally. Confirm `node --version` is at least 18, run `npm run setup:electron`, then `npm run check`.

If Electron reports a missing shared library, install the desktop dependencies in the README. You can inspect unresolved libraries with:

```sh
ldd .tools/electron-runtime/node_modules/electron/dist/electron | grep 'not found'
```

A terminal launched outside the desktop session may not have the required display environment. Do not run Electron with sudo. If an old process is still hidden after clicking X, return to its original terminal and stop it with Ctrl+C.

## NVIDIA fields are unavailable

Run `nvidia-smi`. If it reports a driver/library version mismatch after a driver update, reboot into the updated kernel/driver and try it again. This resolved the development machine's mismatch. The application cannot repair a broken NVIDIA installation and does not fabricate GPU data. If the tool still fails, fix the system driver installation before expecting GPU telemetry.

## Fan RPM or Acer GPU temperature is missing

The mapping currently requires ANV15-52, Linux 7.0.x and hwmon bound to `acer-wmi`. Inspect `node scripts/read-linux-sensors.cjs`. For the checked model, `npm run start:acer` can prepare interfaces for this boot; see the module-reload explanation in the manual checklist. Other models/kernels remain unverified. Do not force numbered sensor channels to match this laptop.

## Import is rejected

Confirm you supplied the official reviewed 5.1.392 package, with both its MSI and AppX. The importer checks exact hashes, not just filenames. `msiinfo` and `cabextract` must be available. Choose a new output directory when a previous or partial extraction exists; inspect and preserve the old directory instead of overwriting it or disabling checks.

## The screen appears simulated

Use `npm start`, not `test-linux-ui.sh`. Wait for multiple samples, inspect Monitoring and run `npm run verify:readings`. Use a new read-only session rather than reusing the UI-only experiment's state. Missing fields should show `--`. If evidence confirms real backend sampling but the screen does not match, report the specific screen/field as a UI integration defect.

## Sharing evidence safely

Start with the assessed summary and your observations. Review even summaries before posting. Raw `launch.log`, inventory files, extracted resources and cached application data may include credentials, cookies, serial numbers and personal paths. They are intentionally excluded from Git.
