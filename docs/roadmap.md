# Roadmap to an initial release

## Active Rust rewrite

- [x] Separate independent Rust backend and original Acer frontend directories.
- [x] Establish domain/application ports, Linux adapters and private socket delivery.
- [x] Reimplement original-resource verification, static inspection, fresh import, evidence audit and checklist generation in Rust.
- [x] Inventory baseline files and generate 50 feature goals covering all 20 screenshots.
- [ ] Complete original end-to-end traces; located symbols/native dumps alone are insufficient.
- [ ] Complete original controls, hardware readback/behavior, recovery and matched visuals per ledger item.
- [ ] Retire remaining Node implementation/tooling after equivalent acceptance; preserve research history.
- [ ] Complete preference migration, supported frontend runtime, TLS/sandbox hardening and release packaging/security review.


The objective is Windows-equivalent behavior for all referenced controls on ANV15-52. Read-only telemetry is an intermediate result, not the release definition. No release date is set. Additional models and a custom frontend are outside this rewrite.

Track individual controls and workflows in [the generated checklist](migration/checklist.md). Original assets remain private, the project license is undecided, and no release is accepted until its security, packaging and behavioral requirements pass.
