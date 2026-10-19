# Roadmap to an initial release

The proposed first release is scoped to **reliable read-only monitoring on the verified ANV15-52 configuration**. Complete Windows NitroSense feature parity is a later goal. There is no release date yet.

The overall project goal is to reverse engineer the original Acer NitroSense and make the features in the Windows references work equivalently on Linux. The initial read-only release below is an intermediate milestone, not a redefinition of that goal. All work follows [AGENTS.md](../AGENTS.md); no replacement UI or screenshot-only completion is permitted.

## Completed foundation

- [x] Launch the original user-supplied Acer UI on Linux.
- [x] Verify imported resources and preserve the original ASAR.
- [x] Connect real CPU/RAM, NVIDIA, Acer hwmon and battery data sources.
- [x] Represent unavailable readings without simulated fallback in read-only mode.
- [x] Make real monitoring the normal launch path; keep simulator use explicit.
- [x] Document the tested setup, prerequisites, asset boundary and manual checks.

## Initial release acceptance

- [ ] Select a project license before describing the release as open-source licensed.
- [ ] Validate the documented setup from a fresh official ZIP on clean Ubuntu 26.04.1 LTS, including missing dependencies, extraction failures, and repeat installation behavior.
- [ ] Complete and record the manual checklist on the supported laptop after cold boot, suspend/resume, AC/battery transitions and an NVIDIA driver update/reboot.
- [ ] Verify all supported visible fields against independent Linux sources; distinguish unsupported fields throughout the interface.
- [ ] Improve unsupported-control presentation so visible buttons cannot imply implemented fan/profile/lighting features.
- [ ] Resolve security blockers: remove blanket certificate bypass, restore appropriate process isolation/sandboxing, audit IPC/local services and sensitive logging, and migrate to a supported Electron runtime while preserving application compatibility.
- [ ] Provide reliable show/close/quit behavior, clean backend shutdown, and clear startup error reporting.
- [ ] Exercise longer monitoring sessions, GPU idle/unavailable states, source failures and recovery without stale values or UI freezes.
- [ ] Establish source-only CI and define a reproducible, private-input integration test procedure. CI configuration is present; hosted execution remains unverified until publication.
- [ ] Package the compatibility code and installer tooling without bundling Acer assets; verify the public release artifact contents.
- [ ] Tag and document an initial release only after its acceptance criteria pass.

## Later work

- Investigate fan/profile/lighting controls individually, with documented model-specific interfaces, capability detection and recovery behavior before enabling any writes.
- Complete application launching/association and remaining system-information fields.
- Evaluate additional Acer models, kernel versions, graphics stacks and native Wayland support using explicit compatibility reports.
- Improve installation UX and desktop integration while keeping proprietary assets user-supplied.
