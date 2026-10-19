# Original Windows evidence still required

The Rust rewrite does not resolve unpublished Acer native/service behavior by changing language. Static inspection has located dispatcher identifiers in AcerAgentService, battery-health identifiers in the agents and DTS-related functions in AcerHardwareService. `native-inventory.json` records exact official ZIP members and hashes; private PE imports, strings and disassembly are under `analysis/rust-migration/native/`. These dumps are not a completed native-function trace.

When ready, boot Windows on the ANV15-52 with the original NitroSense installed. This Linux session does not provide direct Windows desktop/debugger access. If a Windows-access tool becomes available, the agent should conduct the inspection itself; otherwise collect the following privately. Do not send credentials, account identifiers or full memory dumps in chat.

## First capture: mode and fans

- Original actions: on AC, Balanced → Quiet → Balanced; Fan Auto → Max → Auto; then inspect Custom's CPU and GPU slider ranges and per-fan Auto separately. Record the starting state and restore it. Do not probe arbitrary firmware values.
- Capture the original application/service versions and file hashes, AC state, action timestamps, successful replies, notifications and visible refresh. Keep screenshots before/after, plus RPM/operating-mode observations independently of selected cards.
- Use Process Explorer/service enumeration to associate the original app with AcerAgentService, AcerHardwareService and AcerSysMonitorService. Use Procmon for process, registry, file and named-pipe activity. Procmon alone does not capture complete TCP payloads or firmware buffers.
- Use loopback packet capture (Wireshark with Npcap loopback support) for the app's known 46933/46753 service channels. Verify actual listeners/PIDs first; capture additional discovered local agent/WebSocket channels. Record complete request/reply streams across the action, including initialization capability queries.
- With a debugger/API tracing tool, inspect the dispatch paths identified in the private static disassembly. Record native/WMI/IOCTL method IDs, input buffers, returned buffers and errors. Do not claim a UI packet proves the firmware operation.
- Resolve: real capability lists, mode enum mapping, custom-fan bounds/units, separate CPU/GPU addressing, acknowledgement versus readback, AC-transition behavior, persistence and recovery after service interruption.

## Second capture: Personal Settings and Checkup

- Trace Personal Settings → Battery Charge Mode separately from power-off USB charging, its battery cutoff dropdown and battery calibration. The original charge radio routes through `ChangeBatteryMode` → `setBatteryHealthy` → the real-machine adapter → Care Center `BatteryHealthy`; it does not use the fan/mode SDK channel.
- Capture function discovery, battery-health query values and responses for Full → Optimized → original state, plus confirmation by the original service. The existing Linux health driver only exposes 80/100 mode; it does not establish the USB or calibration contract.
- Inspect TrueHarmony preset switching and the speaker/headphone restrictions separately. Inspect boot-logo validation/error behavior without writing an unverified logo or changing firmware.
- Calibration, boot-logo writes and prolonged charging experiments need their own deliberate procedure after their contracts and recovery behavior are established; they are not part of the initial exploratory capture.

Retain raw captures under ignored `analysis/` or `.state/`. Summarize only hashes, members, symbols, input/output semantics, observations and unresolved questions in committed research records. Independent Linux/tooling work can continue while these captures are pending; speculative hardware implementation cannot.
