# Personal Benchmark

A local-first VS Code extension for capturing opted-in AI coding work and curating it into a private, personal LLM benchmark.

Built by **Bruno Manzano** at **TechTorch**.

Source and releases: [github.com/BrunoTorchie/Custom-Benchmark](https://github.com/BrunoTorchie/Custom-Benchmark)

## Why

Model leaderboards measure someone else's work. This extension measures yours: it observes the prompts you actually send, in the repositories you actually work in, and turns them into a benchmark that reflects your codebase rather than a public evaluation set. Everything stays on your machine.

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
- A configurable raw-trace retention target, defaulting to 90 days.

## Preview boundary

This `0.0.12` build recommends before submission. Type or paste the draft into **Before You Send**, select **Recommend before sending**, inspect the result, then select **Copy & open**. Copilot receives an unsent prefilled draft through VS Code's supported partial-query command. Claude Code and Codex do not expose a supported prompt-insertion API, so the extension copies the exact draft and opens the selected harness for you to paste, review, and send. It never auto-submits.

The optional live feed observes `UserPromptSubmit` after submission for capture and audit. It is not the primary routing mechanism. The build does not yet capture complete conversations, tool trajectories, patches, or benchmark cases.

Because scored local model results are not available yet, model recommendations currently combine task signals with a frozen 2026-09-06 Artificial Analysis snapshot. The dashboard labels that fallback `MODEL - AA HEURISTIC` and explains when registered results will replace it. Provider detection confirms installed harness extensions only; it does not confirm account-level access to the recommended model.

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

Capture is disabled by default for every folder. The bridge rejects prompts outside the canonical allowlist before writing any bytes. Original prompt text is analyzed only in memory; persisted recommendation data contains a redacted preview of at most 180 characters, a SHA-256 hash, derived routing fields, and source metadata. The data directory receives owner-only permissions on supported filesystems, and this extension contains no upload path.

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `personalBenchmark.rawTraceRetentionDays` | `90` | Retention target, in days, for raw traces that have not become benchmark cases. |

## Development

Requires Node.js and VS Code `^1.136.0`.

```bash
npm install        # install dependencies
npm run compile    # generate icons, type-check, lint, bundle
npm run watch      # rebuild on change
npm test           # run the extension test suite (47 tests)
npm run package    # production bundle for packaging
```

Press <kbd>F5</kbd> to launch the extension in a development host.

Brand source files live in [brand/](brand/); the shipped icons in [resources/](resources/) are traced from them. Neither `brand/` nor `docs/` is included in the packaged extension.

| Path | Purpose |
| --- | --- |
| [src/extension.ts](src/extension.ts) | Activation, command registration, state wiring |
| [src/dashboard.ts](src/dashboard.ts) | Activity Bar webview and its rendering |
| [src/modelCatalog.ts](src/modelCatalog.ts) | The 20 model/reasoning profiles and their metrics |
| [src/modelSelection.ts](src/modelSelection.ts) | Task-aware ranking and selection precedence |
| [src/recommendation.ts](src/recommendation.ts) | Prompt analysis and live recommendation |
| [src/promptFeed.ts](src/promptFeed.ts) | Live `UserPromptSubmit` feed |
| [src/promptHookFiles.ts](src/promptHookFiles.ts) | Transactional hook configuration |
| [src/hookBridge.ts](src/hookBridge.ts) | Standalone hook bridge bundled as `prompt-hook.cjs` |
| [src/redaction.ts](src/redaction.ts) | Secret redaction applied before any write |
| [src/store.ts](src/store.ts) | Consent state and the local event ledger |

## Agent skills

This repository vendors 25 agent skills from [mattpocock/skills](https://github.com/mattpocock/skills) under [.claude/skills/](.claude/skills/), so anyone who clones it gets them with no install step. They cover TDD, code review, debugging, domain modeling, spec and ticket flows, and planning.

Invoke one by name, for example `/tdd` or `/diagnosing-bugs`. Run `/ask-matt` to find the right skill for a situation, and `/setup-matt-pocock-skills` once before first use of the engineering set.

These files are third-party and MIT licensed. See [.claude/skills/NOTICE.md](.claude/skills/NOTICE.md) for attribution, the upstream commit, and the full license.
