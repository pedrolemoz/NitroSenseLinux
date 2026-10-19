# Original Acer frontend host

This directory contains the minimal maintained Electron host and Acer-facing adapters. The actual application, UI, templates, graphics, translations, profile factories and state transitions remain the verified user-supplied Acer import. No custom frontend is included.

The host's original-source transformations and renderer state guards were retained from the earlier host, with their original-source hashes and invariants. This retention is deliberate: these are compatibility glue around the original UI. The Rust backend, use cases, adapters, API and research tooling are independently implemented rather than translations of the old backend modules.

Our host never reads procfs/sysfs, invokes NVIDIA tools, discovers desktop entries, writes firmware or persists our backend preferences. Its native-addon shape adapter delegates these to Rust. Electron window/display/icon APIs and source/resource overlays remain frontend responsibilities. Original Acer-owned stores/factories stay in the original app. Its `oemFolder/ProfilePool` now uses stable XDG user state; session diagnostics cannot reset that store. Earlier per-session stores remain untouched and are not automatically merged.

Build the workspace and supply the existing verified import and pinned Electron runtime, then:

```sh
sh frontend/start.sh --experimental-runtime
```

`--inspect` after that flag performs a bounded diagnostic navigation/capture session at a 1168×934 content size. It never selects hardware controls or enables optional telemetry. It may continue through the original first-run dialog only with its opt-in unchecked. Private captures, viewport/scale, original-page text and error categories stay under `.state/rust-frontend-*/frontend/inspection/`. This is not a pass for all screenshot states.

The launcher starts a separate Rust process on a private Unix socket, with hardware writes disabled, and cleans up both processes on interruption. Imported ASAR bytes remain untouched. No simulated production fallback exists in this path.

**Unresolved runtime blockers:** Electron remains 26.6.10, and the inherited original host requires disabled sandbox/certificate protections. The explicit experimental entrypoint is retained while a supported-runtime and scoped trust/process-isolation migration is researched. This is not a hardened release. Online functionality and other incomplete functions must not be reported as working.

Root `runtime/`, `lib/` and legacy scripts remain temporarily as migration/regression evidence; they are not dependencies of this host. Remove them only after their replacements have corresponding acceptance evidence. The original Node launch path is available explicitly as `npm run start:legacy`.

The final additional hash-guarded renderer fix preserves plain error strings emitted by the original bundled push receiver instead of JSON-parsing them. The actual remote 404 remains visible; this does not implement notifications. See `docs/reverse-engineering/original-push-error.json`.
