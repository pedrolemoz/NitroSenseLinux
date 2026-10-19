# Development status

## Rust migration, 2026-10-19

Final handoff: [implementation, validation and remaining work](migration/handoff.md). Work has stopped at the requested handoff; full parity is incomplete.

The new `backend/` workspace separates domain, application ports/use cases,
Linux adapters, service delivery and research tools. `frontend/` retains Acer's
original UI and compatibility glue, delegates our OS operations/preferences to
Rust and uses no Node monitoring service. The normal launcher now selects this
path. The earlier Node implementation remains an explicit regression target,
not a dependency or a completed retirement.

The Rust workspace compiles, its source/contract tests pass and Clippy passes
with warnings denied. A fresh Rust import of the pinned official ZIP produced
762 members with exactly the baseline paths, sizes and hashes. Live socket
delivery has reported real CPU/RAM/battery/NVIDIA data; direct read-only adapter
diagnostics separately queried the existing 80% battery threshold. No firmware
write was exercised in this rewrite. Raw local evidence is under
`.state/rust-validation/` and `.state/rust-frontend-*/`.

The first capture exposed a moved frontend module path, which was corrected.
Subsequent inspection reached all six inspected original pages with real data.
Original first-run/tour navigation is now handled by the diagnostic harness with optional consent unchecked, and the original profile store survives restart. The source-traced push-error parsing exception is fixed; the underlying remote 404 persists. Sidebar/viewport framing remains an acceptance concern; reaching pages is not screenshot or feature parity.
The 50-feature ledger/checklist in `docs/migration/` covers all 20 screenshot IDs
without inheriting historical Node passes. Located symbols are entrypoints, not
completed traces. Native inspection and targeted Windows capture work remain.

Remaining migration work includes original Care Center charge-radio integration,
unresolved native controls, complete visual/hardware/recovery acceptance, Node
tooling retirement, preference migration, supported Electron hosting, sandbox/TLS
hardening, dependency/security audit and release packaging. Read the current root
README and migration checklist before using the historical observations below.


Earlier Node observations are archived in [legacy status](../legacy/docs/node-status.md). They are not current Rust acceptance.
