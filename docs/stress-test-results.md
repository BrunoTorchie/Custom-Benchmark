# Extension stress test results

Tested on September 18, 2026, on macOS arm64 in VS Code 1.138.0. Automated extension-host tests use synthetic fixtures. Native UI checks used the actual extension development host and the signed-in VS Code model provider.

## Scored execution: verified end to end

The benchmark is now implemented: curate and save a case → select provider models → review outgoing prompts → execute → score checks → persist results → show history and eligible recommendation evidence.

| Execution | Observed result |
| --- | --- |
| Offline demo, 3 cases × 2 mock models | All 6 answers completed; careful model 100/100 and terse model 0/100 |
| Live Copilot Auto, 4 synthetic prompts | All 4 answers completed and scored 100/100; observed latencies 832–3,215 ms |
| Live GPT-5 mini (`copilot-utility`) | Provider returned HTTP 400 `model_not_supported`; all 3 errors persisted |
| Live GPT-5.6 Luna, internal and named endpoints | Provider rejected these endpoints as available only to VS Code core; errors persisted |
| Maximum supported plan, mocked executor | 100 cases × 5 models = 500 scored answers, with 502 isolated progress snapshots |

The live score validates the request, response, scoring and persistence path on simple smoke prompts. It is not evidence that one coding model is better than another. Auto routing, synthetic cases and failed runs are excluded from recommendation evidence. A successful fixed-model comparison still depends on a provider exposing callable fixed-model endpoints.

## Native UI verification

- Opened the actual activity-bar dashboard and benchmark workbench in a synthetic workspace.
- Ran the demo through its real button and observed completed scores and updated sidebar counts.
- Created and saved a curated case through the form; verified duplicate validation.
- Discovered signed-in models, reviewed the prompt/provider/request summary, and exercised VS Code's model-access consent.
- Verified the successful live run in the UI: COMPLETED, 4/4 answers, 100/100, and individual timings.
- Restarted the development host and verified retained cases and run history.
- Inspected the actual dark-theme layout at a narrow editor width alongside the dashboard and chat sidebar. This is a visual smoke check, not a pixel-by-pixel accessibility audit.

Native testing exposed and fixed a form-reset collision (`id="reset"` shadowed `form.reset`), misleading zero averages on failed runs (now “Incomplete”), and two providers both using model ID `auto`. Model selection now uses vendor, ID and version. Rechecked the review dialog: one selected Copilot Auto endpoint produced exactly four requests, not eight requests across two providers.

## Automated coverage and reproduction

Run `npm test` for compilation, type checking, linting and all 86 tests in a real extension host. Run `npm run package` for production bundles. The runner opens `src/test/fixtures/workspace`; capture tests use temporary directories and clean them up. The command handoff test restores the clipboard and mocks harness opening without submitting a prompt.

New coverage includes all four scoring rules, case validation and redaction, model identity collisions, registered results driving recommendations, stale/duplicate/synthetic evidence exclusion, timeouts even when an executor ignores cancellation, cancellation and pre-cancellation, output limits, redacted failures, 500-answer execution, private atomic storage, corruption detection, generated webview script parsing and the VS Code model API adapter.

Previously reproduced capture and handoff failures remain covered:

| Failure | Fix and regression coverage |
| --- | --- |
| Dashboard omitted Copy & open | Forward pending-draft state; inspect the actual provider-rendered handoff |
| Composer trimmed the original prompt | Validate trimmed text but submit the exact draft; execute generated webview script |
| Analysis persisted with capture off or paused | Keep recommendations in memory; inspect ledger and fresh store |
| Concurrent updates lost consent/counts | Serialize store mutations; concurrent repository enablement and 100 events |
| Quoted credentials reached inbox | Redact quoted credentials; 30 real hook subprocesses |
| Recovery stole a live consumer's event | Recover stale claims only after the owning process exits |

Hook integration also covers all three harness sources, redacted inbox consumption, concurrent consumers, pause/resume, deletion, rejected-write recovery, malformed input, repository boundaries, settings preservation and torn ledger lines.

## Remaining boundaries

Scores are deterministic answer-rubric scores, not execution of generated code or autonomous coding-agent trajectories. No source files or expected answers are sent to the provider. Captured traces are not automatically promoted into full prompts. Preflight recommendations can use eligible benchmark evidence; post-submit hooks remain heuristic.

Storage queues protect one extension host; use one window per repository for comparisons. Pattern-based redaction is not a general-purpose secret detector. Provider discovery does not guarantee endpoint availability; failures stay visible and cannot become recommendation evidence.
