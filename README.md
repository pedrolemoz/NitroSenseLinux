# NitroSense Linux

An independent reverse engineering project to make Acer NitroSense's original Windows features work on Linux. The current rewrite separates an independent **Rust backend** from the **original Acer frontend**. No custom frontend or screenshot recreation is included.

The implementation is incomplete. Original-source traces, real Linux behavior and independent readback determine completion; screenshots organize the required controls and visual comparisons. See the [50-feature checklist](docs/migration/checklist.md), [machine-readable ledger](docs/migration/features.json) and [current status](docs/status.md).

## Build and run

The first target is Acer Nitro ANV15-52. The Rust workspace has been compiled and checked using Rust/Cargo 1.99.1; minimum-version acceptance remains pending. Node/npm are needed only for the retained Electron frontend and legacy regression tooling.

```sh
cargo build --manifest-path backend/Cargo.toml --locked
cargo test --manifest-path backend/Cargo.toml --locked
```

`npm run setup` now orchestrates the verified import and frontend runtime through Rust. You may also supply your own original Acer NitroSense 5.2.84 resources. For a fresh import from the reviewed official ZIP, install `unzip`, `msitools` and `cabextract`, then:

```sh
backend/target/debug/nitrosense-tools import --zip /path/to/official.zip --output /absolute/path/to/new-import
backend/target/debug/nitrosense-tools check-original --vendor /absolute/path/to/new-import
```

The importer checks pinned ZIP/AppX/MSI/ASAR hashes, extracts data without executing Windows binaries or custom actions, and publishes a verified private import. It refuses existing destinations and staging. Acer files, extracted source, native disassembly and captures stay local and ignored; they are never release contents.

Install the currently required frontend runtime with `npm run setup:electron`. For the existing default import:

```sh
sh frontend/start.sh --experimental-runtime
```

An alternate verified import can follow the flag. The frontend launcher starts a separate Rust service on a private Unix socket with hardware writes disabled. Ctrl+C stops both processes. `--inspect` after the experimental flag performs bounded original-page captures under `.state/`.

**The frontend remains experimental:** the inherited Electron 26.6.10 host still requires sandbox/TLS exceptions. Supported-runtime migration and security hardening are release blockers. Starting the application does not establish hardware-control parity.

For a frontend-independent backend or another future frontend:

```sh
backend/target/debug/nitrosense-backend serve
backend/target/debug/nitrosense-backend snapshot
backend/target/debug/nitrosense-backend capabilities
```

See the [backend API and architecture](backend/README.md) and [frontend boundary](frontend/README.md). Hardware state and user preferences are separate. Missing readings are unavailable, and no simulator backs the Rust production path.

## Evidence and remaining work

The Rust import has reproduced all 762 baseline resource members byte-for-byte. Rust adapters and socket delivery have observed real CPU/RAM/battery/NVIDIA readings on the target laptop. The existing battery C driver is retained separately; its earlier 80/100 firmware verification is not inherited by the rewritten original-UI integration or physical charge/reboot acceptance.

Fan/performance/audio/USB charging/calibration/boot-logo behavior, complete Checkup and system information, all screenshot states, extended reliability, security auditing and release packaging remain incomplete. The frontend still needs original Care Center integration for its battery-health radio controls. No unverified firmware/EC writes are permitted.

Root `lib/`, `runtime/` and legacy scripts are retained as explicit migration/regression evidence while corresponding acceptance is completed. They are not dependencies of the new frontend or Rust backend. `npm run start:legacy` selects the old path deliberately. Some historical research utilities and driver operator scripts still await retirement or migration; this is not yet an entirely retired Node project.

## Development checks

```sh
cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
backend/target/debug/nitrosense-tools audit
backend/target/debug/nitrosense-tools audit --verify-original
backend/target/debug/nitrosense-tools checklist --check
npm test
npm run test:frontend
```

Both Rust and legacy audit entrypoints remain available. The evidence gate requires file-bound research records; it is a heuristic, not proof of behavior or a completed security audit. Source-only CI must not download Acer assets. See [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md), [research workflow](docs/reverse-engineering/README.md) and the [Windows investigation procedure](docs/migration/windows-capture.md).

This is not an official Acer product. The project-wide license remains undecided; no license is selected by this rewrite. The retained battery kernel module has its own GPL-2.0-only license.
