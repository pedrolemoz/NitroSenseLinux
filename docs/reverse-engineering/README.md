# Reverse engineering evidence workflow

[AGENTS.md](../../AGENTS.md) is mandatory for every agent. The target is the
original app's Windows behavior on Linux. Research precedes implementation.

1. Select the original feature/control and screenshot reference ID. Extract and
   index the verified original JavaScript with
   `npm run inspect:original -- --symbol <symbol>`; outputs stay in ignored
   `analysis/original-5.2.84/`. Read the actual source around the indexed offsets.
   ASAR extraction is not native decompilation, nor the recovered Acer project.
   Existing `map-boundaries.cjs` and `map-protocol.cjs` can help trace bundled JS;
   see the script guide for their local parser prerequisite.
2. Trace original event handlers, model transitions, RPC, service/native calls,
   packet shapes, persistence, reply validation and UI refresh. Inspect original
   DLL/service code with a suitable disassembler/decompiler when that boundary is
   required. Keep tool versions, hashes and local outputs; label uncertain findings.
3. If the native contract cannot be established here, ask the user for a Windows
   session with an explicit investigation plan: which original control to operate,
   which process/service/WMI/IPC activity to inspect, which before/after state to
   collect, and which unanswered question the evidence resolves. Inspect directly
   when tools/access permit. Otherwise explain the access limitation and supply
   capture commands. Do not guess or implement a substitute workflow.
4. Add a concise JSON record beside this README. Use
   `scenario-initialization.json` as a schema example, not proof of other features.
   List `original` member hashes and literal `symbols`; the `trace` must explain
   control, model, transport, OS/firmware, reply/refresh and Linux adaptation.
   `files` bind research to exact SHA-256 hashes of the final implementation files
   (`deleted` for deletions). Reinspect changes before updating those hashes.
   `validation` lists behavior, status and evidence paths; explicitly distinguish
   pass/fail/blocked/not-tested. Record the Windows decision/reason and remaining
   gaps. No copied proprietary source, personal data or raw captures in records.
5. Run `npm run audit:changes -- --verify-original` locally, then `npm test` and
   applicable real behavior checks. The default diff is HEAD to current working
   tree plus untracked implementation files. Use `--base <revision>` for a branch
   or committed change range. PR CI uses its base commit and needs no Acer assets.
   Source-only checks cannot verify vendor source hashes; the local option does.
6. Compare Linux captures with the relevant Windows references as a separate visual
   check. Record functionality and visual failures independently. Do not report
   selected preference values as measured firmware state.

The audit flags common HTML injection, DOM construction, new frontend/component
paths and known replacement-panel patterns. It rejects implementation changes
without a matching research record. It cannot understand intent, arbitrary code
construction or the truth of written evidence. A dishonest/incomplete record can
pass; review and actual Windows/Linux behavior remain necessary. Do not work
around the audit or mechanically refresh hashes to silence it. A legitimate
boundary operation flagged by the heuristic requires inspection and a narrowly
justified checker correction, not replacement UI or a blanket bypass.
