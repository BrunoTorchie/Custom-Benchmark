# Personal Benchmark

A local-first VS Code extension for capturing opted-in AI coding work and curating it into a private, personal LLM benchmark.

Built by **Bruno Manzano** at **TechTorch**.

Source and releases: [github.com/BrunoTorchie/Custom-Benchmark](https://github.com/BrunoTorchie/Custom-Benchmark)

## Why

Model leaderboards measure someone else's work. This extension measures yours: it observes the prompts you actually send, in the repositories you actually work in, and turns them into a benchmark that reflects your codebase rather than a public evaluation set. Capture and recommendations stay on your machine. Explicitly reviewed benchmark runs send only selected curated prompts to your chosen VS Code models.

## What it does

- A native Activity Bar dashboard with a Live Recommendation section for the current task.
- A preflight prompt composer that recommends a model and harness *before* the prompt is sent anywhere.
- A deliberate handoff step that copies the untouched draft and opens the recommended harness without submitting it.
- Deterministic local harness routing across Copilot, Claude Code, and Codex, plus task-aware selection from 20 model/reasoning profiles.
- A registry-first model policy: sufficiently sampled Personal Benchmark results win; until those exist, a frozen Artificial Analysis snapshot supplies an explicit heuristic fallback.
- Manual prompt analysis plus an explicitly connected live feed for VS Code Chat, Claude Code, and Codex.
- Per-folder capture consent with visible off, capturing, and paused states.
- Detection of GitHub Copilot, Claude Code, and OpenAI Codex extensions.
- A permission-restricted local event ledger with secret redaction before persistence.
- A review list that reads the local ledger and opens any captured event as its redacted record.
- Raw-trace retention, defaulting to 90 days: older ledger events are purged at startup, every six hours, and when the setting changes.

## Scored benchmarks

1. Select **Open benchmark workbench** in the sidebar (or **Personal Benchmark: Run Benchmark**).
2. Create a self-contained case: title, task type, prompt and success checks. Confirm local storage, then save. The latest analyzed draft is prefilled when opening the workbench.
3. Use **Refresh models**, select cases and up to five models, and choose **Review & run**. The confirmation names the cases, providers and request count. VS Code may ask for model access on first use.
4. Inspect scores, per-check pass/fail results, response previews, latency and errors. Cancel stops the active request and skips remaining cases. Completed answers are saved as they arrive; history survives reload.
5. After a complete real run with at least three distinct, unchanged, non-demo cases of one task type, its model scores inform future preflight recommendations for that repository.

**Run demo benchmark** exercises the same pipeline offline with three synthetic cases and two mock models. Demo runs and synthetic cases never influence recommendations. Capture consent is independent of curated-case storage and benchmark execution.

Scoring supports case-insensitive contains/excludes, whitespace-trimmed exact match and valid JSON checks, equally weighted on a 0–100 scale. These evaluate model answers; this version does not execute generated code, run repository test commands or replay autonomous coding agents. A model being listed does not guarantee provider entitlement: request errors are shown in history and excluded from recommendation evidence. See [docs/benchmark-execution.md](docs/benchmark-execution.md).

## Recommendation and capture boundary

This `0.1.0` build recommends before submission. Type or paste the draft into **Before You Send**, select **Recommend before sending**, inspect the result, then select **Copy & open**. Copilot receives an unsent prefilled draft through VS Code's supported partial-query command. Claude Code and Codex do not expose a supported prompt-insertion API, so the extension copies the exact draft and opens the selected harness for you to paste, review, and send. It never auto-submits.

The optional live feed observes `UserPromptSubmit` after submission for capture and audit. It is not the primary routing mechanism. Capture does not collect complete conversations, tool trajectories or patches. Benchmark cases are explicitly curated in the workbench.

Until eligible local model scores exist, recommendations combine task signals with a frozen 2026-09-06 Artificial Analysis snapshot. The dashboard labels that fallback `MODEL - AA HEURISTIC` and explains when registered results will replace it. Provider detection confirms installed harness extensions only; it does not confirm account-level access to the recommended model.

See [docs/model-recommendation.md](docs/model-recommendation.md) for the complete catalog, metrics, weights, precedence, and limitations.

## Getting started

1. Open the Personal Benchmark icon in the Activity Bar.
2. Select **Enable for this folder**, or run **Personal Benchmark: Enable Repository**.
3. Review and accept the local-only consent dialog.
4. Enter the unsent task in **Before You Send**, then select **Recommend before sending**.
5. Review the recommended model, reasoning profile, harness, confidence, and selection basis.
6. Select **Copy & open**. Choose the named model in the opened harness, review the draft, and send it when ready.
7. Optionally select **Connect live feed** to capture post-submit prompt events for audit and future benchmark construction.
8. Use **Open local data** to inspect extension storage, or **Disconnect feed** to remove the hooks.

## The live prompt feed

The live feed is off until you explicitly connect it. Connection adds one marked `UserPromptSubmit` hook at each supported user-level location:

- `~/.copilot/hooks/personal-benchmark.json`
- `~/.claude/settings.json`
- `~/.codex/hooks.json`

Existing settings and unrelated hooks are preserved. Disconnect removes only the marked Personal Benchmark handlers. Codex requires reviewing a new or changed hook through `/hooks` before it runs.

## Privacy

Capture is disabled by default for every folder. Manual recommendations still work while capture is off or paused, but remain in memory and are not added to the ledger. The bridge rejects prompts outside the canonical allowlist before writing any bytes. Original prompt text is analyzed only in memory; persisted recommendation data contains a redacted preview of at most 180 characters, a SHA-256 hash, derived routing fields, and source metadata. The data directory receives owner-only permissions on supported filesystems, and capture itself makes no model requests. Curated cases are stored in full after redaction and explicit local-save consent. A reviewed benchmark run sends those prompts through the selected VS Code model provider; provider usage limits and charges may apply. No workspace files or grading answers are sent.

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `personalBenchmark.rawTraceRetentionDays` | `90` | Days to keep captured ledger events. Older events are deleted; curated benchmark cases and run history are not affected. |

## Development

Requires Node.js and VS Code `^1.136.0`.

```bash
npm install        # install dependencies
npm run compile    # generate icons, type-check, lint, bundle
npm run watch      # rebuild on change
npm test           # run the extension test suite (72 tests)
npm run package    # production bundle for packaging
```

The test runner opens a synthetic workspace. Workflow tests exercise registered commands and clipboard handoff with a mock harness, 100 concurrent ledger writes across two folders, 30 real hook-bridge processes across the three adapters, and scored execution up to 500 case/model pairs. Temporary capture data is cleaned up and clipboard contents are restored. See [docs/stress-test-results.md](docs/stress-test-results.md) for coverage and boundaries.

Press <kbd>F5</kbd> to launch the extension in a development host.

Brand source files live in [brand/](brand/); the shipped icons in [resources/](resources/) are traced from them. Neither `brand/` nor `docs/` is included in the packaged extension.

| Path | Purpose |
| --- | --- |
| [src/extension.ts](src/extension.ts) | Activation, command registration, state wiring |
| [src/dashboard.ts](src/dashboard.ts) | Activity Bar webview and its rendering |
| [src/benchmark.ts](src/benchmark.ts) | Case validation, scoring, execution, run history, recommendation evidence |
| [src/benchmarkPanel.ts](src/benchmarkPanel.ts) | Benchmark workbench webview and the Language Model API adapter |
| [src/modelCatalog.ts](src/modelCatalog.ts) | The 20 measured model/reasoning profiles and their metrics |
| [src/providerModels.ts](src/providerModels.ts) | Dated snapshot of each harness's officially offered models |
| [src/modelSelection.ts](src/modelSelection.ts) | Task-aware ranking and selection precedence |
| [src/recommendation.ts](src/recommendation.ts) | Prompt analysis and live recommendation |
| [src/promptFeed.ts](src/promptFeed.ts) | Live `UserPromptSubmit` feed |
| [src/promptHookFiles.ts](src/promptHookFiles.ts) | Transactional hook configuration |
| [src/promptInbox.ts](src/promptInbox.ts) | Claims and drains hook-bridge inbox files exactly once |
| [src/hookBridge.ts](src/hookBridge.ts) | Standalone hook bridge bundled as `prompt-hook.cjs` |
| [src/redaction.ts](src/redaction.ts) | Secret redaction applied before any write |
| [src/store.ts](src/store.ts) | Consent state and the local event ledger |

## Agent skills

This repository vendors 25 agent skills from [mattpocock/skills](https://github.com/mattpocock/skills) under [.claude/skills/](.claude/skills/), so anyone who clones it gets them with no install step. They cover TDD, code review, debugging, domain modeling, spec and ticket flows, and planning.

Invoke one by name, for example `/tdd` or `/diagnosing-bugs`. Run `/ask-matt` to find the right skill for a situation, and `/setup-matt-pocock-skills` once before first use of the engineering set.

These files are third-party and MIT licensed. See [.claude/skills/NOTICE.md](.claude/skills/NOTICE.md) for attribution, the upstream commit, and the full license.
