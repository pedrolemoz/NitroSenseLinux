# Legacy Node implementation and research

This archive holds the retired `lib/`, `runtime/`, historical `scripts/`, their tests, and historical development/status/roadmap notes. It is preserved as regression and reverse-engineering evidence, not the current architecture. The active implementation is `backend/` (Rust) plus `frontend/` (original Acer Electron host).

Run archived commands from the repository root. Optional `npm run start:legacy`, `check:legacy`, `import:legacy`, `setup:legacy` and other `:legacy` aliases target this directory. Run archived tests with:

```sh
node --test legacy/tests/*.test.cjs legacy/runtime/*.test.cjs
```

Relative module imports remain inside this archive. Launch/setup tools still use project-root `vendor/`, `.tools/`, `analysis/` and `.state/`, so there are no copied private assets or new legacy downloads/state directories. Current driver scripts and the shared evidence audit remain under root `scripts/`. The latter still uses the archived inert ASAR parser pending full replacement acceptance.

Historical documents preserve past behavior and commands; they are not current instructions or Rust acceptance. No feature or hardware verification was upgraded by moving files. Minimal path changes keep the archived regression workflows usable. Simulator fixtures stay confined to explicit archived experiments/tests. Full legacy retirement remains open.

The retained sensor/module operator scripts still call archived read-only inventory utilities for diagnostic captures. This is a documented temporary operator-tool dependency, separate from the Rust service and normal frontend launcher.
