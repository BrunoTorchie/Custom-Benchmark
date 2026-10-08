# Scored benchmark execution

The workbench compares model answers against checks the user defines. It uses real models discovered with `vscode.lm.selectChatModels`; the extension does not assume a harness extension exposes all of its models through that API.

## Case lifecycle

Open the workbench from the sidebar or the Run Benchmark command. Create a self-contained prompt and 1–20 checks. The save checkbox explicitly authorizes storing the full curated prompt and checks locally, after secret redaction. Capture consent is separate. Edit updates the case fingerprint; remove excludes it from future execution and recommendations. Historical runs retain the exact case snapshot used for scoring.

The supported checks are:

| Check | Pass condition |
| --- | --- |
| Contains | Answer includes expected text, ignoring case |
| Excludes | Answer omits expected text, ignoring case |
| Exact | Answer matches expected text after trimming surrounding whitespace, case-sensitive |
| JSON | Entire trimmed answer parses as JSON; Markdown fences do not pass |

Each check has equal weight. The score is the rounded percentage of passed checks. These are transparent answer checks, not proof that generated code passes a project's test suite. Avoid trivial rubrics that reward keywords without testing the task.

## Execution and privacy

Choose 1–100 cases and 1–5 models. Review & run names the prompts, providers and total requests before execution. Only the saved prompt is sent as a user message; expected answers, checks, source files and raw captured traces are not sent. Provider-default generation settings are used and labelled. Model name, opaque ID, vendor and version are saved with the run. VS Code manages provider authentication and model-access consent; no API key is stored by this extension.

Requests run sequentially with a 60-second deadline each, cancellation propagation and a 64,000-character response limit. Errors and timeouts are recorded; subsequent cells still run. Cancel aborts the active request and skips the remainder. Completed answers are saved after each cell using an atomic file replacement. Closing the workbench cancels its run; a run found unfinished on reopening is marked interrupted.

Scoring uses the full in-memory answer; stored answer previews are redacted and limited to 8,000 characters. History retains up to 50 runs and prunes older runs when storage exceeds 16 MiB (the newest run is retained). Files are created owner-readable/writable on POSIX filesystems. Delete Repository Data removes cases and runs as well as the capture ledger; an active run must first be cancelled.

## Recommendation evidence

For each task type, the latest completed real comparison is eligible when it includes three distinct unchanged non-demo cases and all compared models have scored each case. The aggregate is the mean case score. Existing selection policy applies its sample-size penalty. An explicit catalog-model request still wins. Changing or deleting a case invalidates its old evidence. Repeated runs or renamed copies cannot multiply sample size. Demo runs, synthetic cases, Auto routing, and failed/cancelled/interrupted runs are excluded. Models are identified by provider, ID and version to distinguish endpoints with the same name or ID.

This feeds preflight recommendations. Hook-bridge post-submit analysis continues to use the frozen heuristic. Harness recommendations remain separate from model identity: a model measured through a VS Code provider may not be available inside the separately recommended harness.

## Test and operational boundaries

The offline demo uses synthetic executors through the real runner and storage path; it is labelled DEMO. Unit/integration tests exercise scoring, errors, cancellation, the API adapter, persistence, eligibility and a 500-answer plan. Native UI checks and real-provider results are recorded in [stress-test-results.md](stress-test-results.md).

No shell commands or generated code are executed. This release does not replay patches in isolated worktrees or measure autonomous tool-use trajectories. Runs currently serialize within one workbench; use one VS Code window per repository when running comparisons. Raw-trace retention applies to the capture ledger only; curated cases and run history are kept until removed or deleted.
