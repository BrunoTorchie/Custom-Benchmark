# Changelog

## 0.1.0 - 2026-09-18

- Added a benchmark workbench with curated cases, editable checks, model discovery, reviewed execution, cancellation, persistent run history and per-answer scoring.
- Connected eligible real benchmark results to preflight recommendations; excluded demos, duplicate cases, stale cases and incomplete runs.
- Added offline demo comparisons, bounded response previews/history, request timeouts and provider error reporting.
- Fixed handoff visibility, prompt whitespace preservation, capture consent, concurrent state updates, quoted secret redaction and duplicate inbox processing.
- Added scored-run and workflow stress coverage, plus real VS Code UI verification.

## Unreleased

- Rebranded the extension to TechTorch and removed the previous publisher identity from the manifest, dashboard, and docs.
- Renamed the dashboard theme tokens to semantic names, so a palette change is now a values-only edit.
- Added the missing `.vscode-test.mjs` configuration, which had left the entire test suite unable to run.
- Added `.gitignore`, `.vscodeignore`, and VS Code launch and recommendation configs.
- Removed committed `.vsix` build artifacts from the repository root.
- Documented the build, test, and packaging workflow, plus a source-file map, in the README.
- Vendored 25 MIT-licensed agent skills from `mattpocock/skills` under `.claude/skills/`, with attribution.

## 0.0.12 - 2026-09-06

- Added the first read path for the local ledger, so captured events can be listed and inspected.
- Replaced the placeholder Review command, which reported no candidates even when events had been captured.
- Opened any selected event as its stored redacted JSON record.
- Reported the captured event count in the dashboard review queue instead of always showing none.

## 0.0.11 - 2026-09-06

- Made recommendation a preflight workflow: draft in the dashboard, inspect the model and reasoning recommendation, then choose when to send.
- Added a non-submitting handoff that copies every draft and opens the recommended harness.
- Prefills Copilot through VS Code's partial-query command; Claude Code and Codex open with the prompt on the clipboard because they expose no supported prefill API.
- Kept submitted-prompt hooks as post-submit capture and audit signals rather than presenting them as the primary routing workflow.

## 0.0.10 - 2026-09-06

- Replaced the fixed GPT 5.6 Luna XHigh preview with a 20-profile model catalog covering the requested GPT, Gemini, and Claude options.
- Added explicit-request, registered-result, and Artificial Analysis heuristic selection paths with visible provenance.
- Added a frozen Artificial Analysis v4.2 metric snapshot, task-aware ranking, estimate/deprecation handling, and coding-agent evidence.
- Documented that registered local results are still being generated and that installed harness detection does not prove model entitlement.

## 0.0.9 - 2026-09-04

- Established Personal Benchmark as a TechTorch project, authored by Bruno Manzano.
- Separated harness and model recommendations in the dashboard; this preview mocks GPT 5.6 Luna with XHigh reasoning for every harness route.
- Added a prominent live recommendation for the current task with model, reasoning profile, task type, confidence, rationale, and source.
- Added deterministic, explainable, local prompt routing with installed-provider fallback and manual analysis.
- Added explicitly consented `UserPromptSubmit` adapters for VS Code Chat, Claude Code, and Codex.
- Added a fail-open bridge with canonical repository allowlisting, pre-write secret redaction, and no full prompt persistence.
- Added transactional hook configuration that preserves unrelated settings and removes only Personal Benchmark handlers.
- Added compact-height dashboard behavior validated at 220×610 and 300×610.

## 0.0.8 - 2026-09-04

- Replaced GH, C, and O initials with the installed providers' official logos.
- Rendered provider marks in monochrome white inside the existing accent-ring source tiles.
- Referenced provider assets in place so they are not copied into or redistributed with this extension.

## 0.0.7 - 2026-09-04

- Compressed the overview to fit a 220-by-610-pixel VS Code sidebar without scrolling or clipped labels.
- Replaced repetitive provider rows with compact source tiles and honest adapter status.
- Made Capture, Review, and Benchmark workflow steps directly actionable.
- Clarified preview-state language and added an icon-first pause control.

## 0.0.6 - 2026-09-04

- Replaced three truncated tree views with one responsive themed dashboard.
- Added state-aware primary actions for enabling, testing, pausing, and resuming capture.
- Added a compact workflow, corpus totals, honest provider status, and clearer local-data controls.

## 0.0.5 - 2026-09-04

- Adopted the product visual identity in deep blue, light neutral, and a muted accent.
- Added a dedicated monochrome mark for the VS Code Activity Bar.

## 0.0.4 - 2026-09-04

- Replaced the gauge artwork with the Signal Print identity: fingerprint contours fused with rising benchmark bars.
- Simplified the Activity Bar mark for clear monochrome rendering at 24 pixels.

## 0.0.3 - 2026-09-04

- Credited Bruno Manzano as the extension author and publisher.

## 0.0.2 - 2026-09-04

- Added a vivid full-color extension icon and a bolder monochrome Activity Bar mark.

## 0.0.1 - 2026-09-04

- Added the native Capture, AI Sources, and Benchmark Corpus views.
- Added per-folder enable, pause, resume, disable, and deletion controls.
- Added local provider detection for Copilot, Claude Code, and Codex.
- Added a redacted, permission-restricted preview event ledger.
- Added extension-host activation and core behavior tests.