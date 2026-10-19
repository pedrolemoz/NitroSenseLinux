# Screenshot implementation checklist

Generated from `features.json` with `cargo run --manifest-path backend/Cargo.toml -p nitrosense-tools -- checklist`.

Historical Node observations are not Rust acceptance. A checked item requires independent behavioral evidence and original-frontend acceptance.

| Feature | References | Rust backend | Acer integration | Visual | Behavior | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] Home telemetry and real unavailable states | HOME-01, HOME-02 | Rust implemented; live acceptance pending | live partial | fail | fail | Verify live gauges against Linux sources |
| [ ] Home navigation and sidebar toggle | HOME-01, HOME-02 | original Acer UI retained | host migrated | not-tested | not-tested | Capture both sidebar states |
| [ ] Sidebar profile/mode/fan summary | HOME-01, HOME-02 | saved state distinct from hardware | original models retained | fail | fail | Trace summaries to confirmed hardware state |
| [ ] Sidebar shortcuts and details | HOME-01, HOME-02 | not implemented | not integrated | not-tested | not-tested | Trace original control and native boundary |
| [ ] Home live update | HOME-01, HOME-02 | not implemented | not integrated | not-tested | not-tested | Trace original control and native boundary |
| [ ] Scenario profile creation/selection/persistence | MODE-AC-B, MODE-AC-Q, MODE-AC-P, MODE-DC-B, MODE-DC-E | original factories retained; stable original store; Rust preferences separate | store reuse verified; manager acceptance pending | not-tested | not-tested | Exercise manager dialogs and persistence |
| [ ] Profile application associations and automatic switching | MODE-AC-B, MODE-AC-Q, MODE-AC-P, MODE-DC-B, MODE-DC-E | not implemented | not integrated | not-tested | not-tested | Trace original control and native boundary |
| [ ] Balanced on AC | MODE-AC-B | not implemented | not integrated | fail | fail | Inspect native service and capture Windows mode transition |
| [ ] Quiet on AC | MODE-AC-Q | not implemented | not integrated | not-tested | not-tested | Inspect native service and capture Windows mode transition |
| [ ] Performance on AC | MODE-AC-P | not implemented | not integrated | not-tested | not-tested | Inspect native service and capture Windows mode transition |
| [ ] Balanced on battery | MODE-DC-B | not implemented | not integrated | not-tested | not-tested | Inspect native service and capture Windows mode transition |
| [ ] Eco on battery | MODE-DC-E | not implemented | not integrated | not-tested | not-tested | Inspect native service and capture Windows mode transition |
| [ ] AC/battery mode availability and restoration | MODE-AC-B, MODE-AC-Q, MODE-AC-P, MODE-DC-B, MODE-DC-E | Rust positive-mains and ambiguous-USB observation implemented | Acer status adapter implemented | not-tested | not-tested | Verify unplug/replug transitions and error recovery |
| [ ] Original NVIDIA Whisper notices and behavior | MODE-AC-Q, MODE-DC-E | not implemented | not integrated | not-tested | not-tested | Trace original control and native boundary |
| [ ] Fan Auto | FAN-A | not implemented | not integrated | not-tested | not-tested | Capture fan command plus actual RPM/readback on Windows |
| [ ] Fan Max | FAN-M | not implemented | not integrated | not-tested | not-tested | Capture fan command plus actual RPM/readback on Windows |
| [ ] Independent CPU/GPU fan sliders and per-fan Auto | FAN-C | not implemented | not integrated | not-tested | not-tested | Capture fan command plus actual RPM/readback on Windows |
| [ ] CPU/GPU fan RPM attribution | FAN-A, FAN-M, FAN-C | Rust hwmon adapter scoped to verified model/driver/kernel | bridge implemented | not-tested | not-tested | Compare actual RPM with independent hwmon reads |
| [ ] TrueHarmony presets and custom audio | SCENARIO-ADV | not implemented | not integrated | not-tested | not-tested | Inspect original audio service; capture speaker/headphone behavior |
| [ ] Optimized 80% / Full 100% charging | PERSONAL-01 | Rust charge adapter and readback use case implemented | original control connection pending | fail | fail | Integrate the original Care Center BatteryHealthy boundary; then verify radio/readback and recovery |
| [ ] Battery health information and navigation | PERSONAL-01, CHECKUP-01 | not implemented | not integrated | not-tested | not-tested | Trace original control and native boundary |
| [ ] Power-off USB Charger | PERSONAL-01 | not implemented | not integrated | not-tested | not-tested | Trace original control and native boundary |
| [ ] USB charge limit while on battery | PERSONAL-01 | not implemented | not integrated | not-tested | not-tested | Trace original control and native boundary |
| [ ] Bluelight Shield and reduction level | PERSONAL-01, PERSONAL-02 | not implemented | not integrated | not-tested | not-tested | Trace original control and native boundary |
| [ ] Sticky keys | PERSONAL-01, PERSONAL-02 | not implemented | not integrated | not-tested | not-tested | Trace original control and native boundary |
| [ ] Backlight off after 30 seconds | PERSONAL-01, PERSONAL-02 | not implemented | not integrated | not-tested | not-tested | Trace original control and native boundary |
| [ ] Boot logo browse/preview/validation/apply | PERSONAL-02 | not implemented | not integrated | not-tested | not-tested | Trace original control and native boundary |
| [ ] Checkup All and per-component diagnostics | CHECKUP-01 | not implemented | not integrated | fail | fail | Trace original control and native boundary |
| [ ] Battery charge/temperature/cycles/health | CHECKUP-01 | Rust percentage/cycles/health where available; temperature missing | live partial | fail | fail | Verify all fields and original check result flow |
| [ ] Battery calibration lifecycle and last check | CHECKUP-01 | not implemented | not integrated | not-tested | not-tested | Trace original control and native boundary |
| [ ] Per-drive storage health and checks | CHECKUP-01 | not implemented | not integrated | fail | fail | Trace original control and native boundary |
| [ ] RAM check and diagnostics | CHECKUP-01 | not implemented | not integrated | fail | fail | Trace original control and native boundary |
| [ ] System Info fields and navigation | CHECKUP-INFO | Rust basic identity; full inventory pending | native query bridge partial | not-tested | not-tested | Trace and implement actual Linux fields without Windows fixtures |
| [ ] CPU temperature/usage/frequency/fan/history | MONITOR-01 | Rust sampler implemented; temporal acceptance pending | live partial | fail | fail | Verify units, extrema, gaps and live sources |
| [ ] GPU temperature/usage/frequency/fan/history | MONITOR-01 | Rust NVIDIA plus scoped hwmon implemented | live partial | fail | fail | Verify idle/failure/recovery and driver mismatch |
| [ ] System temperature | MONITOR-01 | not implemented | not integrated | fail | fail | Trace original control and native boundary |
| [ ] Memory usage and clock | MONITOR-01 | Rust usage implemented; clock unresolved | bridge partial | fail | fail | Validate usage; establish RAM clock source |
| [ ] Ethernet and Wi-Fi throughput | MONITOR-01 | not implemented | not integrated | fail | fail | Trace original control and native boundary |
| [ ] App discovery/search/filter/sort/refresh | APPS-01 | Rust XDG catalog implemented; compatibility audit pending | bridge implemented; default Preload inspected | not-tested | not-tested | Verify desktop visibility, overrides and original controls |
| [ ] Application pinning and sidebar shortcuts | APPS-01, HOME-02 | not implemented | not integrated | not-tested | not-tested | Trace original control and native boundary |
| [ ] Launch and Cannot find app workflow | APPS-01 | not implemented | not integrated | not-tested | not-tested | Trace original control and native boundary |
| [ ] Experience carousel and navigation | EXPERIENCE-01 | not implemented | not integrated | not-tested | not-tested | Trace original control and native boundary |
| [ ] Recommended Apps and Highlight Features | EXPERIENCE-01 | not implemented | not integrated | not-tested | not-tested | Trace original control and native boundary |
| [ ] Membership signup/signin and registration | HELP-01 | not implemented | not integrated | not-tested | not-tested | Trace original control and native boundary |
| [ ] Acer Live Update | HELP-01 | not implemented | not integrated | not-tested | not-tested | Trace original control and native boundary |
| [ ] Find an Answer/country/service center search | HELP-01 | not implemented | not integrated | not-tested | not-tested | Trace original control and native boundary |
| [ ] About, actual version and update controls | SETTINGS-01 | Rust original import verifier implemented | actual imported version retained | not-tested | not-tested | Verify version and update workflow separately |
| [ ] Privacy preference and downstream consent | SETTINGS-01 | Rust preference store implemented | original consent model retained | not-tested | not-tested | Trace consent propagation and unavailable integrations |
| [ ] Celsius/Fahrenheit and persistence | SETTINGS-01 | Rust preference store implemented | original conversion retained | not-tested | not-tested | Verify conversion across gauges/history and restart |
| [ ] Homepage live-3D avatar toggle | SETTINGS-01 | original Acer asset and UI retained | host migrated | not-tested | not-tested | Verify toggle, loading and navigation regression |
