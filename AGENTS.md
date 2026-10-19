# Mandatory project rules for every agent

This is a reverse engineering project. Its objective is to make the original
Acer NitroSense features shown in `references/screenshots/` work on Linux with
the same behavior as Windows. A compatibility layer is an implementation
technique, not the product goal. A screenshot-matching recreation is wrong.
These rules apply to all agents, subagents, reviews and future iterations.

## Before implementing or changing a feature

1. Read these rules, `CONTRIBUTING.md`, `references/README.md` and relevant
   development/status records. Inspect the applicable original screenshot.
2. Inspect the downloaded, verified original Acer assets. Extract/unbundle and
   read the original main/renderer code; inspect native/service binaries or
   Windows behavior when the JavaScript boundary does not explain the feature.
   Use `cargo run --manifest-path backend/Cargo.toml -p nitrosense-tools -- inspect-original --symbol <original-symbol>` for a static
   source extraction/index. This does not decompile native DLLs or recover the
   unpublished Acer project. Never execute an unknown binary as an inspection step.
3. Trace the real feature end to end: original control/component → model →
   IPC/RPC → service/native function → protocol/firmware or OS operation → reply,
   errors, persistence and UI refresh. Record exact original version, hashes,
   members and symbols. Distinguish observed facts from hypotheses.
4. Implement the missing Linux boundary while retaining the original app's
   components, templates, controls, terminology, defaults and workflow. Reuse
   original factories and state transitions. Do not introduce a new screen,
   component, replacement panel, lookalike frontend, hardcoded screenshot value,
   fake capability, or simulated production result. Do not hide missing behavior
   or claim completion by disabling/removing controls merely to match a screenshot.
5. Record trace and behavioral verification in `docs/reverse-engineering/*.json`.
   Run `cargo run --manifest-path backend/Cargo.toml -p nitrosense-tools -- audit` and, with a local import,
   `cargo run --manifest-path backend/Cargo.toml -p nitrosense-tools -- audit --verify-original`. The audit is a heuristic plus an
   evidence gate; passing cannot prove intent, correctness or functional parity.
6. Validate original-source behavior and Linux behavior, including failure and
   recovery. Compare screenshots for visual regressions only. A matching image,
   passing mock, selected card, saved preference, or absence of crashes does not
   prove that the original function works. Hardware operations need actual
   readback/behavioral evidence. Mark untested or unsupported behavior honestly.

## When Windows inspection is needed

If original code, native disassembly, available protocol evidence and Linux
observations cannot establish the real contract, tell the user exactly why a
Windows session is needed and ask them to boot Windows. Specify the original
control/action, capture tools, expected inputs/outputs and questions to resolve.
Use available tools to inspect the original app yourself once that Windows
session is accessible. If direct access is unavailable, explain that and provide
precise capture steps; never pretend to have inspected it. Do not substitute an
invented Linux workflow or screenshot imitation for missing Windows evidence.
Continue independent work while waiting, but stop speculative implementation at
the unresolved boundary. No blind firmware/EC writes or unverified hardware controls.

## Assets and reporting

Keep original assets and extracted/decompiled code, disassembly, protocol captures
and personal/device data in ignored `analysis/` or `.state/`. Do not commit Acer
bundles or binaries. Preserve original ASAR bytes and hash checks. Commit only
our code and concise non-proprietary research metadata. Report remaining gaps
against Windows behavior; never redefine success as a visual imitation or a
read-only monitor when a requested feature still does not work.

## Rust rewrite architecture and current commands

The maintained backend and tooling are a Rust Cargo workspace in `backend/`.
Dependencies point inward: domain/application must not depend on Acer protocols,
Electron, filesystem paths or concrete hardware. Keep requested hardware state,
observed state and saved preferences separate. Use typed errors and the versioned
user-private Unix socket; Acer formats belong in outer adapters.

`frontend/` hosts only the original Acer frontend and necessary Electron glue.
Do not translate or rebuild its components/factories. Our OS/hardware operations
belong in Rust. `drivers/` retains the verified C charge ABI. Retired Node code,
research utilities and historical documentation live in `legacy/`; do not add
production dependencies on that backend/runtime. The retained shared audit's
inert archive reader is documented as a temporary tooling dependency.

Use Cargo for build, tests, inspection, import, setup, diagnostics and audit; see
`docs/development.md` and `backend/README.md`. Node remains necessary for original
Electron hosting, its provisioning and JavaScript glue/regression tests. Root
npm aliases are optional wrappers, not the backend architecture. Current driver
operator scripts remain in `scripts/`. Launch with
`sh frontend/start.sh --experimental-runtime` (hardware writes disabled).

Review `docs/migration/features.json`, its generated checklist and handoff before
claiming status. All 20 screenshot IDs have goals, but full Windows parity,
complete file/dependency audit, native feature contracts, supported Electron,
sandbox/TLS hardening and release packaging remain incomplete. Historical
passes, source symbols and selected preferences do not certify Rust behavior.
