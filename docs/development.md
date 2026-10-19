# Rust development

Read [AGENTS.md](../AGENTS.md), [the research workflow](reverse-engineering/README.md), the applicable screenshot and feature evidence before changing behavior. The objective is the original Acer Windows behavior on Linux; source tests and matching images do not establish parity.

## Architecture

- `backend/`: Cargo workspace with domain, application, Linux adapter, service and tools crates. Domain/application depend inward and contain no Acer protocol, Electron or concrete OS paths. See [the API and architecture](../backend/README.md).
- `frontend/`: original Acer application hosted with minimal Electron transport/resource glue. Original factories and stores remain original. Our hardware, discovery and preferences use Rust. See [the host boundary](../frontend/README.md).
- `drivers/`: retained verified GPL C charge driver and its existing ABI.
- `scripts/`: current driver/operator scripts and shared evidence audit. These are not the retired Node service.
- `legacy/`: archived Node backend, old Electron host, tools, regression tests and historical records. See [archive notes](../legacy/README.md). It is not a dependency of the Rust service or current frontend.
- `docs/migration/`: inventory, original-native metadata, 50 feature goals/all 20 screenshot references, generated checklist, validation handoff and unresolved Windows capture procedure.

## Build and verify

Run from the repository root:

```sh
cargo build --manifest-path backend/Cargo.toml --locked
cargo test --manifest-path backend/Cargo.toml --locked
cargo fmt --manifest-path backend/Cargo.toml --all -- --check
cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
cargo run --manifest-path backend/Cargo.toml -p nitrosense-tools -- audit
cargo run --manifest-path backend/Cargo.toml -p nitrosense-tools -- audit --verify-original
cargo run --manifest-path backend/Cargo.toml -p nitrosense-tools -- checklist --check
node --test frontend/host/*.test.cjs tests/*.test.cjs
```

The last command tests the remaining JavaScript host and shared audit, not a Node backend. Rust source tests use synthetic fixtures only within tests. Original-source integration tests need private local assets and may skip; skips are not acceptance. For changes affecting archived sources or shared contracts, also run `node --test legacy/tests/*.test.cjs legacy/runtime/*.test.cjs`. The root package scripts remain optional convenience wrappers, not the canonical backend build system.

`check-original` validates imported bytes. `nitrosense-backend diagnose` reads actual Linux sources independently of a running service; it does not assess old session logs. `sh frontend/start.sh --experimental-runtime` launches the original application against Rust with hardware writes disabled. `--inspect` performs bounded navigation/captures; it does not operate hardware controls.

## Evidence and private data

Record exact original versions/hashes/symbols, trace, file hashes, failures/recovery and Linux readback in `docs/reverse-engineering/*.json`. Preserve prior observations; do not transfer their pass status to the rewrite. The ledger records visual and behavioral results separately. When native contracts remain unresolved, use [targeted Windows captures](migration/windows-capture.md); never guess firmware operations.

Keep installers, imported assets, source extractions, disassembly, captures and personal/device data ignored under `vendor/`, `analysis/` or `.state/`. Runtime downloads belong in `.tools/`. No Acer assets are distributed. The license remains undecided. Electron support/security, full dependency/file audit, native features, packaging and full acceptance remain open; [the handoff](migration/handoff.md) states the actual completed work.

The retained sensor/module operator scripts still call archived read-only inventory utilities for diagnostic captures. This is a documented temporary operator-tool dependency, separate from the Rust service and normal frontend launcher.
