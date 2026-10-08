import * as vscode from 'vscode';

import {
	DashboardSnapshot,
	DashboardViewProvider,
} from './dashboard';
import { CaptureMode } from './model';
import { PromptFeedService } from './promptFeed';
import { PromptInboxItem, isPathInsideRoot } from './promptFeedProtocol';
import { getPromptHandoff } from './promptHandoff';
import { detectProviders } from './providers';
import { LiveRecommendation, isCurrentRecommendation } from './recommendation';
import { LocalStore, StoredEvent } from './store';
import { BenchmarkWorkbench } from './benchmarkPanel';

const LIVE_PROMPT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1_000;

interface PendingPromptDraft {
	prompt: string;
	promptHash: string;
	analyzedAt: string;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const store = new LocalStore(context);
	const promptFeed = new PromptFeedService(context, store);
	const benchmarkWorkbenches = new Map<string, BenchmarkWorkbench>();
	const pendingPromptDrafts = new Map<string, PendingPromptDraft>();
	let promptFeedConnected = await promptFeed.initialize();
	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
	statusBar.name = 'Personal Benchmark';

	let snapshot = createSnapshot(store, promptFeedConnected, pendingPromptDrafts);
	const dashboardProvider = new DashboardViewProvider(context.extensionUri, () => snapshot);

	const refresh = async (): Promise<void> => {
		snapshot = createSnapshot(store, promptFeedConnected, pendingPromptDrafts);
		if (snapshot.folder) {
			try {
				const benchmark = await store.benchmarks(snapshot.folder).read();
				snapshot.benchmarkCaseCount = benchmark.cases.length;
				snapshot.benchmarkRunCount = benchmark.runs.length;
			} catch {
				snapshot.benchmarkError = 'Benchmark data could not be read. Open the workbench for details; capture is still available.';
			}
		}
		await updateContext(snapshot.mode);
		updateStatusBar(statusBar, snapshot);
		dashboardProvider.refresh();
	};
	const refreshEnvironment = async (): Promise<void> => {
		await promptFeed.syncConfiguration();
		promptFeedConnected = await promptFeed.isConnected();
		await refresh();
	};

	context.subscriptions.push(
		statusBar,
		dashboardProvider,
		promptFeed,
		vscode.window.registerWebviewViewProvider('personalBenchmark.dashboard', dashboardProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		vscode.commands.registerCommand('personalBenchmark.enableRepository', async () => {
			const folder = getActiveFolder();
			if (!folder) {
				void vscode.window.showInformationMessage('Open a folder before enabling Personal Benchmark.');
				return;
			}

			const choice = await vscode.window.showInformationMessage(
				`Enable local capture for “${folder.name}”?`,
				{
					modal: true,
					detail: [
						'This preview stores consent, recommendations, and pipeline-check events in local extension storage.',
						'Capture and recommendations stay local. Curated benchmark prompts are sent to selected models only after a separate run review.',
						'Live prompt hooks remain disconnected until you explicitly connect them from the dashboard.',
					].join('\n\n'),
				},
				'Enable local capture',
			);
			if (choice !== 'Enable local capture') {
				return;
			}

			await runCommand(async () => {
				await store.enable(folder);
				await promptFeed.syncConfiguration();
				await refresh();
				void vscode.window.showInformationMessage('Personal Benchmark is enabled locally for this folder.');
			});
		}),
		vscode.commands.registerCommand('personalBenchmark.pauseCapture', async () => {
			await withActiveFolder(async (folder) => {
				await store.setPaused(folder, true);
				await promptFeed.syncConfiguration();
				await refresh();
			});
		}),
		vscode.commands.registerCommand('personalBenchmark.resumeCapture', async () => {
			await withActiveFolder(async (folder) => {
				await store.setPaused(folder, false);
				await promptFeed.syncConfiguration();
				await refresh();
			});
		}),
		vscode.commands.registerCommand('personalBenchmark.disableRepository', async () => {
			const folder = getActiveFolder();
			if (!folder) {
				return;
			}

			const choice = await vscode.window.showWarningMessage(
				`Disable future capture for “${folder.name}”? Existing local data will remain until you delete it.`,
				{ modal: true },
				'Disable capture',
			);
			if (choice === 'Disable capture') {
				await runCommand(async () => {
					await store.disable(folder);
					await promptFeed.syncConfiguration();
					await refresh();
				});
			}
		}),
		vscode.commands.registerCommand('personalBenchmark.recordPreviewEvent', async () => {
			await withActiveFolder(async (folder) => {
				await store.recordPreviewEvent(folder);
				await refresh();
				void vscode.window.showInformationMessage('A redacted preview event was added to the local ledger.');
			});
		}),
		vscode.commands.registerCommand('personalBenchmark.analyzePrompt', async (providedPrompt?: unknown) => {
			const folder = getActiveFolder();
			if (!folder) {
				void vscode.window.showInformationMessage('Open a folder before analyzing a task prompt.');
				return;
			}

			const prompt = typeof providedPrompt === 'string' && providedPrompt.trim() !== ''
				? providedPrompt
				: await vscode.window.showInputBox({
					title: 'Analyze task prompt',
					prompt: 'Describe the task you want an LLM to handle.',
					placeHolder: 'Example: Debug the failing auth tests and implement a verified fix',
					value: dashboardProvider.getDraft(folder),
					ignoreFocusOut: true,
					validateInput: (value) => value.trim() === '' ? 'Enter a task prompt.' : undefined,
				});
			if (!prompt) {
				return;
			}

			await runCommand(async () => {
				const recommendation = await store.analyzePrompt(folder, prompt, detectProviders(), 'manual');
				pendingPromptDrafts.set(folder.uri.toString(), {
					prompt,
					promptHash: recommendation.promptHash,
					analyzedAt: recommendation.analyzedAt,
				});
				dashboardProvider.forgetDraft(folder);
				await refresh();
			});
		}),
		vscode.commands.registerCommand('personalBenchmark.openRecommendedHarness', async () => {
			const folder = getActiveFolder();
			if (!folder) {
				void vscode.window.showInformationMessage('Open a folder before routing a prompt.');
				return;
			}

			const recommendation = store.getRepositoryState(folder).recommendation;
			const draft = pendingPromptDrafts.get(folder.uri.toString());
			if (!draft || !isMatchingDraft(draft, recommendation)) {
				void vscode.window.showInformationMessage('Draft a prompt and get a recommendation before opening a harness.');
				return;
			}

			await runCommand(async () => {
				await openRecommendedHarness(draft.prompt, recommendation);
			});
		}),
		vscode.commands.registerCommand('personalBenchmark.connectLivePrompts', async () => {
			const folder = getActiveFolder();
			if (!folder || store.getCaptureMode(folder) === 'off') {
				void vscode.window.showInformationMessage('Enable capture for this folder before connecting the live prompt feed.');
				return;
			}

			const choice = await vscode.window.showInformationMessage(
				'Connect the local live prompt feed?',
				{
					modal: true,
					detail: [
						'Adds additive UserPromptSubmit hooks for VS Code/Claude and Codex.',
						'Only prompts whose working directory belongs to an enabled, unpaused folder are accepted.',
						'Captured prompt text stays local. Disconnect removes only Personal Benchmark hooks.',
					].join('\n\n'),
				},
				'Connect locally',
			);
			if (choice !== 'Connect locally') {
				return;
			}

			await runCommand(async () => {
				await promptFeed.connect();
				promptFeedConnected = await promptFeed.isConnected();
				await refresh();
				void vscode.window.showInformationMessage(
					'Live prompt feed connected. Codex may ask you to trust the new hook from its /hooks screen.',
				);
			});
		}),
		vscode.commands.registerCommand('personalBenchmark.disconnectLivePrompts', async () => {
			const choice = await vscode.window.showWarningMessage(
				'Disconnect the Personal Benchmark live prompt feed?',
				{ modal: true, detail: 'This removes only Personal Benchmark hook entries. Manual prompt analysis remains available.' },
				'Disconnect feed',
			);
			if (choice !== 'Disconnect feed') {
				return;
			}

			await runCommand(async () => {
				await promptFeed.disconnect();
				promptFeedConnected = await promptFeed.isConnected();
				await refresh();
			});
		}),
		vscode.commands.registerCommand('personalBenchmark.openDataFolder', async () => {
			await runCommand(async () => {
				const dataDirectory = await store.ensureDataDirectory();
				await vscode.commands.executeCommand('revealFileInOS', dataDirectory);
			});
		}),
		vscode.commands.registerCommand('personalBenchmark.deleteRepositoryData', async () => {
			const folder = getActiveFolder();
			if (!folder) {
				return;
			}

			const choice = await vscode.window.showWarningMessage(
				`Permanently delete all Personal Benchmark data for “${folder.name}”?`,
				{ modal: true, detail: 'This removes captured events, consent state, curated benchmark cases, and benchmark run history. It cannot be undone.' },
				'Delete local data',
			);
			if (choice === 'Delete local data') {
				await runCommand(async () => {
					const workbench = benchmarkWorkbenches.get(folder.uri.toString());
					if (workbench?.running) { throw new Error('Cancel the benchmark run before deleting repository data.'); }
					workbench?.dispose();
					benchmarkWorkbenches.delete(folder.uri.toString());
					pendingPromptDrafts.delete(folder.uri.toString());
					dashboardProvider.forgetDraft(folder);
					await store.deleteRepositoryData(folder);
					await promptFeed.syncConfiguration();
					await refresh();
				});
			}
		}),
		vscode.commands.registerCommand('personalBenchmark.reviewCandidates', async () => {
			const folder = getActiveFolder();
			if (!folder) {
				void vscode.window.showInformationMessage('Open a folder before reviewing captured activity.');
				return;
			}

			await runCommand(async () => {
				const events = await store.readEvents(folder);
				if (events.length === 0) {
					void vscode.window.showInformationMessage(
						`Nothing captured for “${folder.name}” yet. Enable capture, then run a capture check or analyze a prompt.`,
					);
					return;
				}

				const picked = await vscode.window.showQuickPick(
					events.map((event) => ({
						label: describeEventKind(event.kind),
						description: formatEventTime(event.occurredAt),
						detail: describeEventPayload(event),
						event,
					})),
					{
						title: `Captured activity · ${folder.name}`,
						placeHolder: `${events.length} captured events. Use Run Benchmark to curate a self-contained prompt and success checks.`,
						matchOnDescription: true,
						matchOnDetail: true,
					},
				);
				if (!picked) {
					return;
				}

				const document = await vscode.workspace.openTextDocument({
					language: 'json',
					content: JSON.stringify(picked.event, null, 2),
				});
				await vscode.window.showTextDocument(document, { preview: true });
			});
		}),
		vscode.commands.registerCommand('personalBenchmark.runBenchmark', async () => {
			await withActiveFolder(async (folder) => {
				const key = folder.uri.toString();
				let workbench = benchmarkWorkbenches.get(key);
				if (!workbench) {
					workbench = new BenchmarkWorkbench(folder, store.benchmarks(folder), refresh);
					benchmarkWorkbenches.set(key, workbench);
					context.subscriptions.push(workbench);
				}
				await workbench.open(pendingPromptDrafts.get(key)?.prompt);
			});
		}),
		vscode.commands.registerCommand('personalBenchmark.refresh', async () => runCommand(refreshEnvironment)),
		vscode.window.onDidChangeActiveTextEditor(refresh),
		vscode.workspace.onDidChangeWorkspaceFolders(refresh),
		vscode.extensions.onDidChange(() => {
			void runCommand(refreshEnvironment);
		}),
	);

	const purgeExpiredTraces = async (): Promise<void> => {
		const retentionDays = vscode.workspace.getConfiguration('personalBenchmark').get<number>('rawTraceRetentionDays', 90);
		try {
			if (await store.purgeExpiredEvents(retentionDays) > 0) {
				await refresh();
			}
		} catch (error) {
			console.error('Personal Benchmark could not apply raw-trace retention.', error);
		}
	};
	const retentionTimer = setInterval(() => void purgeExpiredTraces(), RETENTION_SWEEP_INTERVAL_MS);
	context.subscriptions.push(
		{ dispose: () => clearInterval(retentionTimer) },
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('personalBenchmark.rawTraceRetentionDays')) {
				void purgeExpiredTraces();
			}
		}),
	);

	promptFeed.start(async (item) => processLivePrompt(item, store, refresh, pendingPromptDrafts));
	await refresh();
	void purgeExpiredTraces();
}

export function deactivate(): void {}

function createSnapshot(
	store: LocalStore,
	promptFeedConnected: boolean,
	pendingPromptDrafts: ReadonlyMap<string, PendingPromptDraft>,
): DashboardSnapshot {
	const folder = getActiveFolder();
	const repositoryState = folder ? store.getRepositoryState(folder) : undefined;
	const recommendation = isCurrentRecommendation(repositoryState?.recommendation)
		? repositoryState.recommendation
		: undefined;
	const pendingDraft = folder ? pendingPromptDrafts.get(folder.uri.toString()) : undefined;
	return {
		folder,
		mode: folder ? store.getCaptureMode(folder) : 'off',
		repositoryState,
		providers: detectProviders(),
		recommendation,
		hasPendingDraft: pendingDraft !== undefined && isMatchingDraft(pendingDraft, recommendation),
		promptFeedConnected,
	};
}

async function processLivePrompt(
	item: PromptInboxItem,
	store: LocalStore,
	refresh: () => Promise<void>,
	pendingPromptDrafts: Map<string, PendingPromptDraft>,
): Promise<boolean> {
	// Nested workspace folders both contain the prompt's cwd; the deepest one owns it.
	let folder: vscode.WorkspaceFolder | undefined;
	let folderRootLength = -1;
	for (const candidate of vscode.workspace.workspaceFolders ?? []) {
		if (candidate.uri.scheme !== 'file') {
			continue;
		}
		const canonicalRoot = await store.getCanonicalRepositoryPath(candidate.uri.fsPath);
		if (isPathInsideRoot(item.cwd, canonicalRoot) && canonicalRoot.length > folderRootLength) {
			folder = candidate;
			folderRootLength = canonicalRoot.length;
		}
	}
	const expired = !(Date.now() - Date.parse(item.receivedAt) <= LIVE_PROMPT_MAX_AGE_MS);
	if (!folder) {
		const enabledRoots = await store.getEnabledRepositoryPaths();
		const stillEnabled = enabledRoots.some((root) => isPathInsideRoot(item.cwd, root));
		return !stillEnabled || expired;
	}

	if (store.getCaptureMode(folder) !== 'capturing') {
		return true;
	}

	pendingPromptDrafts.delete(folder.uri.toString());
	try {
		await store.recordRecommendation(folder, item.recommendation);
	} catch (error) {
		// Retry a failed write, but never keep an item past the live-prompt window.
		if (expired) {
			return true;
		}
		throw error;
	}
	await refresh();
	return true;
}

function isMatchingDraft(
	draft: PendingPromptDraft,
	recommendation: LiveRecommendation | undefined,
): recommendation is LiveRecommendation {
	return isCurrentRecommendation(recommendation)
		&& draft.promptHash === recommendation.promptHash
		&& draft.analyzedAt === recommendation.analyzedAt;
}

const EVENT_KIND_LABELS: Readonly<Record<string, string>> = {
	'repository.enabled': 'Capture enabled',
	'repository.disabled': 'Capture disabled',
	'capture.paused': 'Capture paused',
	'capture.resumed': 'Capture resumed',
	'preview.event-recorded': 'Capture check',
	'prompt.recommended': 'Prompt recommendation',
};

export function describeEventKind(kind: string): string {
	return EVENT_KIND_LABELS[kind] ?? kind;
}

export function describeEventPayload(event: StoredEvent): string {
	const payload = event.payload ?? {};
	if (event.kind === 'prompt.recommended') {
		return [payload.modelLabel, payload.profileLabel, payload.taskType, payload.source]
			.filter((value): value is string => typeof value === 'string' && value !== '')
			.join(' · ');
	}

	return typeof payload.message === 'string' ? payload.message : '';
}

export function formatEventTime(occurredAt: string): string {
	const occurred = new Date(occurredAt);
	return Number.isNaN(occurred.getTime()) ? occurredAt : occurred.toLocaleString();
}

async function openRecommendedHarness(
	prompt: string,
	recommendation: LiveRecommendation,
): Promise<void> {
	const handoff = getPromptHandoff(recommendation.providerId, prompt);
	await vscode.env.clipboard.writeText(prompt);
	const commands = new Set(await vscode.commands.getCommands(true));
	if (!commands.has(handoff.commandId)) {
		void vscode.window.showInformationMessage(
			`Prompt copied. Open ${handoff.harnessLabel}, select ${recommendation.modelLabel} (${recommendation.profileLabel}), review, then send.`,
		);
		return;
	}

	await vscode.commands.executeCommand(handoff.commandId, ...handoff.commandArguments);
	const draftStatus = handoff.draftPrefilled ? 'prefilled and copied' : 'copied';
	void vscode.window.showInformationMessage(
		`Prompt ${draftStatus}. Select ${recommendation.modelLabel} (${recommendation.profileLabel}) in ${handoff.harnessLabel}, review, then send.`,
	);
}

function getActiveFolder(): vscode.WorkspaceFolder | undefined {
	const activeUri = vscode.window.activeTextEditor?.document.uri;
	return (activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined)
		?? vscode.workspace.workspaceFolders?.[0];
}

async function updateContext(mode: CaptureMode): Promise<void> {
	await vscode.commands.executeCommand('setContext', 'personalBenchmark.captureMode', mode);
}

function updateStatusBar(statusBar: vscode.StatusBarItem, snapshot: DashboardSnapshot): void {
	if (!snapshot.folder) {
		statusBar.hide();
		return;
	}

	statusBar.show();
	switch (snapshot.mode) {
		case 'capturing':
			statusBar.text = '$(record) Benchmark: On';
			statusBar.tooltip = 'Local preview capture is enabled. Click to pause.';
			statusBar.command = 'personalBenchmark.pauseCapture';
			break;
		case 'paused':
			statusBar.text = '$(debug-pause) Benchmark: Paused';
			statusBar.tooltip = 'Local preview capture is paused. Click to resume.';
			statusBar.command = 'personalBenchmark.resumeCapture';
			break;
		case 'off':
			statusBar.text = '$(circle-slash) Benchmark: Off';
			statusBar.tooltip = 'Private by default. Click to review consent and enable this folder.';
			statusBar.command = 'personalBenchmark.enableRepository';
			break;
	}
}

async function withActiveFolder(action: (folder: vscode.WorkspaceFolder) => Promise<void>): Promise<void> {
	const folder = getActiveFolder();
	if (!folder) {
		void vscode.window.showInformationMessage('Open a folder first.');
		return;
	}

	await runCommand(() => action(folder));
}

async function runCommand(action: () => Promise<void>): Promise<void> {
	try {
		await action();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(`Personal Benchmark: ${message}`);
	}
}
