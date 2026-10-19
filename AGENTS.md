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
   Use `npm run inspect:original -- --symbol <original-symbol>` for a static
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
   Run `npm run audit:changes` and, with a local import,
   `npm run audit:changes -- --verify-original`. The audit is a heuristic plus an
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
