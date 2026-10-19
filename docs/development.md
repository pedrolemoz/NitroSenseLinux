# Development notes

## Structure and runtime boundary

- `lib/` implements archive parsing/import validation, Linux monitoring, desktop entry discovery and local read-only protocol services.
- `runtime/` hosts the Electron bootstrap, RPC/SDK adapters and narrow source/renderer transformations. Changes are applied in memory only after vendor integrity verification; the imported ASAR is not rewritten.
- `scripts/` contains installation, launch, diagnostics, reference capture and static inspection utilities. See its README before choosing a tool.
- `scripts/windows/` contains historical PowerShell research tools. The normal installation and monitoring workflow is Linux-only; no return to Windows was needed for this repository preparation.
- `tests/` and `runtime/*.test.cjs` contain regression tests. Synthetic input is appropriate for deterministic automated tests; normal application monitoring uses real sources.

The project uses CommonJS and Node built-in modules for its core utilities. The application runtime is pinned to Electron 26.6.10 because patch matching and original application behavior are version-specific. There is no compiled frontend in this repository: the UI comes from the user's private Acer import.

## Tests

Run `npm test` from the repository root. A source-only checkout can run the suite without downloading Electron or supplying Acer assets. Original-source integration tests skip if the local vendor archive is missing. Two historical reference-dependent tests also require local `analysis/` captures and skip when those captures are absent. Skips must not be reported as verified vendor compatibility.

`npm run check` verifies the local import's integrity, not host hardware readiness. `npm run verify:readings` assesses saved CPU/RAM backend evidence from the latest real-monitoring session. Neither opens the GUI. Operator-run scripts that open the UI or prepare kernel modules are separate from automated tests.

## Local data and publication

Keep all user-supplied Acer files in ignored `vendor/`, `.state/installer/` or `Installer/`. Runtime downloads belong in `.tools/`; raw analysis belongs in `analysis/`; session data and private history belong in `.state/`. The original local notes were archived under `.state/local-history/pre-publication/` without deleting their contents.

Do not commit generated Acer resources, screenshots containing proprietary assets, copied source bundles, binaries, captured credentials or personal hardware inventories. Git ignore rules help prevent accidental additions but do not remove files already tracked or protect against forced additions. Review the actual staged diff before publishing. No Acer download or redistribution step belongs in CI.

## Scope

Preserve unavailable states and data provenance. Do not infer sensor identity from an arbitrary channel number, silently activate the simulator, claim a visible Windows feature works on Linux, or enable hardware writes through an unverified adapter. Broader hardware support requires model-specific evidence and manual confirmation.

The first release's hardening, fresh installation and hardware acceptance work is tracked in the roadmap. Licensing remains undecided; there is no project LICENSE yet.
