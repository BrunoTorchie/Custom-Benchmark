# Model Recommendation

Official availability checked: 2026-09-18. Benchmark measurements: 2026-09-06.

The extension recommends a harness and a model separately. Harness routing answers where the task should run (Copilot, Claude Code, or Codex). Model routing answers which model profile should handle it. An installed extension proves only that a harness is present; it does not prove that every recommended model is enabled in that harness or account.

## Selection Order

Model selection uses the following precedence:

1. **Explicit request.** A supported model family and optional catalog reasoning profile named in the prompt wins. Routing prefers an installed harness that officially offers that model.
2. **Registered Personal Benchmark results.** A profile becomes eligible after at least three comparable local cases for the detected task type. Candidates are ranked by `score - 10 / sqrt(sample size)` so one lucky small sample does not immediately dominate.
3. **Artificial Analysis heuristic.** Until enough local results exist, the extension combines prompt signals, task-fit priors, and a frozen Artificial Analysis snapshot.

The workbench now supplies registered results to preflight recommendations. The latest completed, non-demo comparison containing at least three distinct unchanged cases of a task type is eligible. Every compared model must have scored all those cases. Re-running the same case does not increase sample size; demo/synthetic cases, failed/cancelled/interrupted runs and changed/deleted cases do not count. Model identity comes from the actual VS Code provider (vendor, model ID and version); provider-default settings are labelled explicitly rather than pretending they match a frozen catalog reasoning profile.

Until eligible evidence exists, the dashboard labels the fallback `MODEL - AA HEURISTIC`. Recommendation itself remains local and deterministic. Post-submit hook recommendations still use the frozen fallback because the hook bridge has no benchmark corpus access. See [benchmark-execution.md](benchmark-execution.md) for scoring and execution boundaries.

## Preflight Workflow

The primary workflow runs before submission:

1. The user types or pastes the task into the extension's **Before You Send** composer.
2. The extension analyzes that local draft and displays the recommended model, reasoning profile, harness, confidence, and selection basis.
3. **Copy & open** copies the untouched draft and opens the recommended harness. It never sends the prompt.
4. Copilot receives the draft through VS Code's `workbench.action.chat.open` command with `isPartialQuery: true`, which fills the composer without accepting it.
5. Claude Code and Codex expose supported open/focus commands but no supported cross-extension prompt-insertion command. Their handoff opens the harness with the prompt on the clipboard for manual paste, model selection, review, and submission.

The optional `UserPromptSubmit` hooks necessarily run after submission. They remain useful for local capture, audit, and future benchmark evidence, but post-submit analysis is labeled as such and is not the primary recommendation path.

## Fallback Inputs

The frozen fallback uses:

- Artificial Analysis Intelligence Index v4.2;
- output speed in tokens per second;
- time to first answer token, including reasoning time;
- end-to-end time for a 500-token answer;
- weighted cost per Intelligence Index task;
- context window;
- the Coding Agent Index when the exact model/profile has a published run;
- prompt signals for urgency, cost sensitivity, multimodal input, and quality sensitivity;
- a small task-fit prior and a preferred reasoning-effort band.

The Intelligence Index is not a coding-only score. Version 4.2 weights Agents at 30%, Coding at 20%, Scientific Reasoning at 20%, and General at 30%. Its coding slice is split equally between Terminal-Bench v2.1 and SciCode. This is why the selector also considers the separate Coding Agent Index and keeps harness selection visible.

### Task Weights

| Task | Intelligence | Speed | Latency | Cost | Coding agent evidence |
| --- | ---: | ---: | ---: | ---: | ---: |
| Architecture | 65% | 5% | 5% | 5% | 20% |
| Debugging | 35% | 5% | 5% | 10% | 45% |
| Implementation | 30% | 25% | 15% | 15% | 15% |
| Review | 50% | 5% | 15% | 15% | 15% |
| Research | 65% | 8% | 8% | 8% | 11% |
| Quick task | 10% | 35% | 30% | 25% | 0% |

Reasoning effort targets are low for quick tasks, medium for routine implementation, high for debugging, and XHigh/adaptive for architecture, review, and research. Explicit model/effort requests bypass this preference. Estimated results receive a small penalty, and deprecated models are excluded from automatic fallback selection while remaining explicitly selectable and eligible for a local-data override.

## Frozen Model Data

The following values were transcribed from the Artificial Analysis model leaderboard and model pages on 2026-09-06. All listed profiles have a 1M-token context window. `Cost/task` is the weighted cost of one Intelligence Index task, not API price per request. `TTFA` is time to first answer token. `E2E` is time to a 500-token answer.

| Model | Profile | Intelligence | Cost/task | Output tok/s | TTFA (s) | E2E (s) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| GPT 5.6 Luna | Low | 26* | -- | 104 | 1.77 | 6.57 |
| GPT 5.6 Luna | Medium | 30* | -- | 107 | 3.79 | 8.46 |
| GPT 5.6 Luna | High | 37* | -- | 124 | 22.24 | 26.27 |
| GPT 5.6 Luna | XHigh | 42 | $0.06 | 128 | 66.40 | 70.31 |
| GPT 5.6 Terra | Low | 32* | -- | 89 | 1.84 | 7.47 |
| GPT 5.6 Terra | Medium | 37* | -- | 87 | 1.67 | 7.43 |
| GPT 5.6 Terra | High | 41 | $0.30 | 97 | 3.67 | 8.83 |
| GPT 5.6 Terra | XHigh | 44 | $0.50 | 102 | 55.63 | 60.53 |
| GPT 5.6 Sol | Low | 41 | $0.23 | 74 | 3.28 | 10.05 |
| GPT 5.6 Sol | Medium | 46 | $0.37 | 72 | 6.41 | 13.34 |
| GPT 5.6 Sol | High | 48 | $0.61 | 73 | 17.87 | 24.68 |
| GPT 5.6 Sol | XHigh | 50 | $0.89 | 82 | 64.00 | 70.10 |
| Gemini 3.8 Flash High | High | 47 | $0.74 | 334 | 10.84 | 12.34 |
| Gemini 3.5 Flash Lite | Default reasoning | 28 | $0.08 | 354 | 6.57 | 7.98 |
| GPT 6 Astra | Max | 55 | $2.57 | 71 | 384.30 | 391.31 |
| Claude Opus 5 | XHigh adaptive | 53 | $3.36 | 54 | 34.42 | 43.73 |
| Claude Opus 4.8 | Max adaptive | 46* | -- | 63.1 | 33.87 | -- |
| Claude Fable 5 | Max adaptive, Opus 4.8 fallback | 53 | $5.62 | 68 | 103.55 | 110.90 |
| Claude Fable 5.1 | Max adaptive, default fallback | 57 | $6.12 | 70 | 264.91 | 272.01 |
| Claude Sonnet 5 | Max adaptive | 45 | $3.31 | 90 | 184.73 | 190.27 |

`*` marks an Artificial Analysis estimated Intelligence value. `--` means the source did not publish that value. Missing values receive a neutral rank contribution rather than being treated as free, instant, or zero quality. Claude Opus 4.8 is marked deprecated by Artificial Analysis and its Intelligence value is estimated; it is retained because it is an explicitly requested option.

### Coding Agent Evidence

These values are model-and-harness results, not intrinsic model scores. The Coding Agent Index v1.4 equally averages DeepSWE, Terminal-Bench v2.1, and SWE-Atlas-QnA, with each benchmark reporting task-normalized pass@1 across three attempts.

| Evaluated system | Index | Cost/task | Active agent time/task |
| --- | ---: | ---: | ---: |
| Claude Code + Claude Fable 5.1 max with fallback | 70 | $9.18 | 24.0 min |
| Claude Code + Claude Opus 5 XHigh | 68 | $8.17 | 23.7 min |
| Codex + GPT 6 Astra max | 67 | $4.72 | -- |
| OpenCode + Gemini 3.8 Flash high | 61 | $2.04 | 11.9 min |

The fallback gives a small bonus when published coding-agent evidence matches the recommended installed harness. It does not assume that a model-only score transfers unchanged between harnesses.

## Expected Defaults

| Prompt shape | Current fallback |
| --- | --- |
| Short explanation or naming task | Gemini 3.8 Flash high on Copilot |
| Routine implementation | Provider-filtered measured profile (OpenAI on Codex) |
| Repository debugging and test loop | GPT 6 Astra max |
| Cross-cutting architecture | Claude Fable 5.1 max with fallback |
| Security or critical review | Claude Opus 5 XHigh |
| Open-ended research | Claude Fable 5.1 max with fallback |

These are fallback defaults, not permanent winners. A named model request wins immediately, and sufficiently sampled local results win for future prompts of the same task type.

## Limitations

- Artificial Analysis is a broad, primarily English-language benchmark. It cannot measure the developer's repositories, preferences, correction burden, or acceptance criteria.
- Coding Agent Index observations conflate model and harness. The extension therefore reports the harness and model separately.
- Provider extension detection does not currently enumerate account-level model entitlements. Recommendations are filtered by documented provider offerings, but account entitlements are not verified. VS Code benchmark results apply only to the Copilot/VS Code route.
- The source snapshot will age. Refreshing it should be an explicit, reviewed data update rather than a live network dependency in the private prompt path.
- Latency and cost are benchmark workload aggregates. They are useful for relative fallback ranking, not estimates of a user's exact bill or completion time.
- The heuristic score is an ordering mechanism, not a probability that the model will solve the task.

## Sources

- [Artificial Analysis LLM Leaderboard](https://artificialanalysis.ai/leaderboards/models)
- [Artificial Analysis model comparison](https://artificialanalysis.ai/models)
- [Intelligence benchmarking methodology](https://artificialanalysis.ai/methodology/intelligence-benchmarking)
- [Coding Agent Index](https://artificialanalysis.ai/agents/coding-agents)
- Individual model pages linked from the catalog in `src/modelCatalog.ts`

## Official provider catalog

`src/providerModels.ts` maintains the dated product-availability snapshot separately from Artificial Analysis measurements. The workbench displays all documented offerings by provider under **Official provider models**. **Runnable models** are discovered through VS Code and may be a smaller or customized set; listing Claude Code or Codex does not create an execution adapter for either extension.

Official models without measurements are labelled “Provider defaults · not benchmarked” and can be explicitly requested; they receive no fabricated benchmark values and are excluded from measured heuristic defaults. Reasoning labels on measured profiles describe the evaluated configuration, not every effort supported by the provider. Opus 4.8's Artificial Analysis deprecation flag is not a claim that the providers retired it. Historical Gemini 3.5 Flash Lite measurements remain in the frozen data but are excluded from these providers' recommendations.

Codex's default catalog follows ChatGPT sign-in availability: GPT-5.4 and GPT-5.4 mini retired there on August 31; API-key availability is separate. GPT-5.5 remains listed until its announced October 14 retirement. This snapshot requires maintenance when offerings change; it is not an automatic entitlement feed.

Official sources:

- [GitHub Copilot supported models](https://docs.github.com/en/copilot/reference/ai-models/supported-models)
- [Claude Code model configuration](https://code.claude.com/docs/en/model-config)
- [Codex models](https://learn.chatgpt.com/docs/models)
