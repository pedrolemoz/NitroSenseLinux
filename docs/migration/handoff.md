# Rust rewrite handoff — 2026-10-19

Work stops at the user's requested handoff. The rewrite is substantial but **the complete migration and Windows feature parity are not finished**. No feature is accepted solely because a page renders, a preference saves, or a test passes.

## Delivered

- `backend/`: independent Rust domain, application ports/use cases, Linux adapters, versioned private Unix-socket service and research tooling. Dependency checks enforce inward direction. Acer packet compatibility stays outside the core.
- Real CPU, memory, battery, supported sensor/NVIDIA and desktop queries; provenance and unavailable values remain explicit. Charge commands separate requested and observed state and require policy/readback. This rewrite performed no hardware writes.
- Socket ownership/permissions, frame/client/deadline limits, disconnect handling, subscriptions, exclusive state locking, atomic preference persistence and shutdown cleanup.
- Rust original-hash verifier, static source inspector, transactional importer, cached setup, source/evidence audit and checklist generator. Fresh import matched all 762 baseline members by path, size and hash. Fresh network setup/runtime installation was not accepted.
- `frontend/`: original Acer assets, components, factories and workflows with Electron transport/hosting glue. Our OS queries/preferences go through Rust. Stable original ProfilePool storage survives restart. Original ASAR bytes remain untouched; no Acer assets are distributed.
- Final source-traced fix: Acer's bundled push receiver emits a plain error string, but the renderer attempted JSON parsing. The narrow guarded patch logs the original error without a secondary exception. The underlying push service still returns 404; online functionality is not accepted.
- The verified C charge driver remains unchanged. Legacy Node sources remain explicit regression/research material and are not dependencies of the new host. Their retirement is incomplete.

## Evidence and validation

The final combined suite passed 21 Rust tests and 209 JavaScript assertions with 4 private-input skips and no failures, recorded in `.state/rust-validation/final-tests.log`. Both Rust and retained legacy original-hash audits passed for 46 maintained files. The generated checklist, Rust formatting and Git whitespace checks passed. Rust formatting, Clippy with warnings denied and offline build passed. Original-hash and change audits must be read as heuristic/evidence checks, not functional certification.

Live read-only API checks covered real snapshots, independent procfs comparison, null preferences, rejected writes, concurrency, malformed/version input recovery, subscriptions and cleanup. The frontend reached six original pages with actual telemetry; the last bounded capture reported no renderer errors. A restart reused the original store. The latest private capture is `.state/rust-frontend-YEKt2mYO/frontend/inspection/`; earlier captures and failures remain preserved. Local logs, installed-app/device details, source extractions and captures remain ignored.

`features.json` contains 50 granular goals spanning all 20 screenshot IDs; `checklist.md` is generated from it. Original symbol locations are research entrypoints, not completed native traces. Historical Node observations do not pass Rust acceptance. `baseline.json` inventories file dispositions and identifies review still pending. `native-inventory.json` records six statically inspected native binaries; none was executed.

## Unfinished acceptance

Original modes/profiles/fans, TrueHarmony effects, separate USB charging, screen/keyboard/boot effects, charge-radio integration, calibration/checkup and online/account contracts remain incomplete. App discovery is not full launching/association acceptance. Missing telemetry fields and screenshot differences remain visible in the checklist. AC changes, suspend/resume, reboot, physical charging and end-to-end hardware recovery were not accepted for this rewrite.

Supported Electron migration and sandbox/TLS hardening are release blockers: the explicit experimental launcher retains inherited Electron 26 exceptions. Complete dependency/security review, packaging, legacy retirement, previous-preference migration, all 20 visual states and full file-by-file audit remain open. No project license was selected. No full release or parity claim is made.

`windows-capture.md` specifies the remaining targeted captures and questions. No Windows inspection was performed in this Linux session. Speculative native/firmware implementation stopped at those unresolved boundaries.

## Reproduction

```sh
cargo build --offline --manifest-path backend/Cargo.toml
cargo test --manifest-path backend/Cargo.toml --locked
cargo run --manifest-path backend/Cargo.toml -p nitrosense-tools -- audit
cargo run --manifest-path backend/Cargo.toml -p nitrosense-tools -- audit --verify-original
node scripts/audit-reverse-engineering.cjs --verify-original
cargo run --manifest-path backend/Cargo.toml -p nitrosense-tools -- checklist --check
sh frontend/start.sh --experimental-runtime
```

The GUI requires the user's verified import, provisioned runtime and a graphical session. The launcher disables backend hardware writes. Test sockets/processes may require execution outside a restrictive sandbox. Original-source integration tests may skip without private assets; skipped checks are not passes. See `backend/README.md` and `frontend/README.md` for API, lifecycle and runtime details. No commit or release was created.

## Subsequent archive and documentation update

Retired Node implementation, research tools, regression tests and historical records now live under `legacy/`. Current Cargo/host commands, agent rules, contributor/development/manual/troubleshooting and driver integration documentation were updated. `legacy-relocation.json` records the moved paths and current hashes; this does not transfer historical acceptance to Rust. The combined suite again passed 21 Rust tests and 209 JavaScript assertions with four skips.
