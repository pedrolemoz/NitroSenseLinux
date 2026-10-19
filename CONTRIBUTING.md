# Contributing

The active rewrite lives in `backend/` (Rust) and `frontend/` (the original Acer
host plus minimal glue). Read their architecture notes. Run Cargo tests/Clippy,
the Rust original-source evidence audit, retained frontend tests and the legacy
regression suite where applicable. No historical Node pass certifies Rust parity.

This project is preparing for an open-source release; a license has not been selected yet. Please clarify licensing before proposing substantial code contributions. Do not add a license or third-party material on someone else's behalf.

For development, read the [architecture and test notes](docs/development.md), then run `npm test`. Keep changes focused and describe what changed, why, which tests ran, and whether real hardware was involved. Source-only tests do not require Acer files; vendor integration tests need your own local import and may skip without it.

For a bug report, provide the laptop model, CPU/GPU, Ubuntu/kernel version, desktop session, NVIDIA driver version, command used, observed behavior and a redacted summary. Compatibility outside the README's exact setup is unverified. See [manual testing](docs/manual-testing.md) for hardware checks.

Never submit Acer installer ZIPs, MSI/AppX/ASAR files, extracted application code/resources, credentials or private session logs. The original UI and resources must remain user-supplied. Keep generated data in the ignored local directories and review the staged diff before opening a change.

The [roadmap](docs/roadmap.md) defines initial release scope. Additional hardware controls require model-specific validation. The battery charge driver has been verified on the target ANV15-52; its original-UI integration remains pending.

## Reverse engineering requirement

Read and obey [AGENTS.md](AGENTS.md) before any implementation. Trace the original Acer code and its service/native contract first. The goal is original Windows functionality on Linux, not screenshot compliance or a recreated frontend. Record source hashes/symbols, the end-to-end trace, Linux adaptation and behavioral evidence in `docs/reverse-engineering/*.json`. Run `npm run audit:changes` (use `-- --verify-original` with the local import). Passing this heuristic/evidence gate does not certify parity. When the native contract is unresolved, request a targeted Windows inspection session as described in AGENTS.md.

## Original UI preservation

Preserve the original Acer interface, page structure and existing controls. Do not
add new panels or redesign features. Fix compatibility at the adapter, transport,
device-state or narrowly scoped original-code boundary. Battery charge-limit
controls belong in Personal Settings, not Scenario. Follow the reviewed [Windows screenshot matrix](references/README.md) before changing UI behavior. Record its reference IDs and visual/behavioral results in validation evidence. The
working battery driver and backend must remain independent of UI rework.

See the [development record](docs/development-history.md) for completed work, reverted UI and pending integration.
