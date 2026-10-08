import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { CaptureMode, deriveCaptureMode } from './model';
import { LiveRecommendation, PromptSource, recommendModel } from './recommendation';
import { redactSecrets } from './redaction';
import { BenchmarkRepository, registeredBenchmarkPerformance } from './benchmark';

const REPOSITORY_STATE_KEY = 'personalBenchmark.repositoryStates.v1';

export interface RepositoryState {
	enabled: boolean;
	paused: boolean;
	enabledAt?: string;
	eventCount: number;
	recommendation?: LiveRecommendation;
}

type RepositoryStateMap = Record<string, RepositoryState>;

export interface StoredEvent {
	schemaVersion: number;
	eventId: string;
	occurredAt: string;
	kind: string;
	source?: { harness?: string };
	repository?: { uri?: string; name?: string };
	payload?: Record<string, unknown>;
	redaction?: { rulesVersion: number; replacementCount: number };
}

/** Newest first. A torn or malformed line must never hide the rest of the ledger. */
export function parseEventLog(contents: string): StoredEvent[] {
	const events: StoredEvent[] = [];

	for (const line of contents.split('\n')) {
		if (line.trim() === '') {
			continue;
		}

		try {
			const parsed = JSON.parse(line) as StoredEvent;
			if (typeof parsed?.kind === 'string' && typeof parsed?.occurredAt === 'string') {
				events.push(parsed);
			}
		} catch {
			continue;
		}
	}

	return events.reverse();
}

/** Unparseable lines are never treated as expired, so a purge cannot delete what it cannot read. */
function isExpiredEventLine(line: string, cutoff: number): boolean {
	try {
		const occurredAt = Date.parse((JSON.parse(line) as StoredEvent).occurredAt);
		return Number.isFinite(occurredAt) && occurredAt < cutoff;
	} catch {
		return false;
	}
}

export class LocalStore {
	private mutationQueue: Promise<void> = Promise.resolve();
	private readonly benchmarkRepositories = new Map<string, BenchmarkRepository>();
	private readonly transientRecommendations = new Map<string, LiveRecommendation>();

	constructor(private readonly context: vscode.ExtensionContext) {}

	getRepositoryState(folder: vscode.WorkspaceFolder): RepositoryState {
		const state = this.getStates()[folder.uri.toString()] ?? {
			enabled: false,
			paused: false,
			eventCount: 0,
		};
		return { ...state, recommendation: this.transientRecommendations.get(folder.uri.toString()) ?? state.recommendation };
	}

	getCaptureMode(folder: vscode.WorkspaceFolder): CaptureMode {
		const state = this.getRepositoryState(folder);
		return deriveCaptureMode(state.enabled, state.paused);
	}

	async enable(folder: vscode.WorkspaceFolder): Promise<void> {
		return this.mutate(() => this.enableNow(folder));
	}

	private async enableNow(folder: vscode.WorkspaceFolder): Promise<void> {
		const previous = this.getPersistedRepositoryState(folder);
		await this.updateState(folder, {
			...previous,
			enabled: true,
			paused: false,
			enabledAt: previous.enabledAt ?? new Date().toISOString(),
		});
		await this.appendEvent(folder, 'repository.enabled', {
			captureScope: 'local-preview',
		});
	}

	async setPaused(folder: vscode.WorkspaceFolder, paused: boolean): Promise<void> {
		return this.mutate(() => this.setPausedNow(folder, paused));
	}

	private async setPausedNow(folder: vscode.WorkspaceFolder, paused: boolean): Promise<void> {
		const previous = this.getPersistedRepositoryState(folder);
		if (!previous.enabled) {
			return;
		}

		await this.updateState(folder, { ...previous, paused });
		await this.appendEvent(folder, paused ? 'capture.paused' : 'capture.resumed');
	}

	async disable(folder: vscode.WorkspaceFolder): Promise<void> {
		return this.mutate(() => this.disableNow(folder));
	}

	private async disableNow(folder: vscode.WorkspaceFolder): Promise<void> {
		const previous = this.getPersistedRepositoryState(folder);
		await this.updateState(folder, { ...previous, enabled: false, paused: false });
		await this.appendEvent(folder, 'repository.disabled');
	}

	async recordPreviewEvent(folder: vscode.WorkspaceFolder): Promise<void> {
		return this.mutate(() => this.recordPreviewEventNow(folder));
	}

	private async recordPreviewEventNow(folder: vscode.WorkspaceFolder): Promise<void> {
		if (this.getCaptureMode(folder) !== 'capturing') {
			throw new Error('Capture must be enabled and running before recording an event.');
		}

		await this.appendEvent(folder, 'preview.event-recorded', {
			message: 'Local pipeline check',
		});
	}

	async analyzePrompt(
		folder: vscode.WorkspaceFolder,
		prompt: string,
		providers: readonly import('./model').ProviderStatus[],
		source: PromptSource,
	): Promise<LiveRecommendation> {
		let performance: import('./modelSelection').RegisteredModelPerformance[] = [];
		let benchmarkUnavailable = false;
		try { performance = registeredBenchmarkPerformance(await this.benchmarks(folder).read()); }
		catch { benchmarkUnavailable = true; }
		const recommendation = recommendModel(prompt, providers, source, new Date(), performance);
		if (benchmarkUnavailable) { recommendation.modelSelectionNote += ' Local benchmark data could not be read; no saved scores were used.'; }
		await this.recordRecommendation(folder, recommendation);
		return recommendation;
	}

	async recordRecommendation(
		folder: vscode.WorkspaceFolder,
		recommendation: LiveRecommendation,
	): Promise<void> {
		return this.mutate(async () => {
			if (this.getCaptureMode(folder) !== 'capturing') {
				if (recommendation.source === 'manual') {
					this.transientRecommendations.set(folder.uri.toString(), recommendation);
				}
				return;
			}
			await this.recordRecommendationNow(folder, recommendation);
		});
	}

	private async recordRecommendationNow(folder: vscode.WorkspaceFolder, recommendation: LiveRecommendation): Promise<void> {
		this.transientRecommendations.delete(folder.uri.toString());
		const previous = this.getPersistedRepositoryState(folder);
		await this.updateState(folder, { ...previous, recommendation });
		await this.appendEvent(folder, 'prompt.recommended', {
			providerId: recommendation.providerId,
			modelProfileId: recommendation.modelProfileId,
			modelLabel: recommendation.modelLabel,
			profileLabel: recommendation.profileLabel,
			modelSelectionBasis: recommendation.modelSelectionBasis,
			taskType: recommendation.taskType,
			confidence: recommendation.confidence,
			promptHash: recommendation.promptHash,
			source: recommendation.source,
		});
	}

	benchmarks(folder: vscode.WorkspaceFolder): BenchmarkRepository {
		const key = folder.uri.toString();
		let repository = this.benchmarkRepositories.get(key);
		if (!repository) {
			repository = new BenchmarkRepository(path.join(this.getRepositoryDirectory(folder), 'benchmark.json'));
			this.benchmarkRepositories.set(key, repository);
		}
		return repository;
	}

	async readEvents(folder: vscode.WorkspaceFolder): Promise<StoredEvent[]> {
		try {
			return parseEventLog(await fs.readFile(this.getEventLogPath(folder), 'utf8'));
		} catch {
			return [];
		}
	}

	async ensureDataDirectory(): Promise<vscode.Uri> {
		await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true, mode: 0o700 });
		await this.tryChmod(this.context.globalStorageUri.fsPath, 0o700);
		return this.context.globalStorageUri;
	}

	async getEnabledRepositoryPaths(): Promise<string[]> {
		const enabledUris = Object.entries(this.getStates())
			.filter(([, state]) => state.enabled && !state.paused)
			.map(([uri]) => vscode.Uri.parse(uri))
			.filter((uri) => uri.scheme === 'file');

		return Promise.all(enabledUris.map((uri) => this.getCanonicalRepositoryPath(uri.fsPath)));
	}

	async getCanonicalRepositoryPath(repositoryPath: string): Promise<string> {
		try {
			return await fs.realpath(repositoryPath);
		} catch {
			return path.resolve(repositoryPath);
		}
	}

	async deleteRepositoryData(folder: vscode.WorkspaceFolder): Promise<void> {
		return this.mutate(() => this.deleteRepositoryDataNow(folder));
	}

	private async deleteRepositoryDataNow(folder: vscode.WorkspaceFolder): Promise<void> {
		this.transientRecommendations.delete(folder.uri.toString());
		const states = this.getStates();
		delete states[folder.uri.toString()];
		await this.context.globalState.update(REPOSITORY_STATE_KEY, states);
		await fs.rm(this.getRepositoryDirectory(folder), { recursive: true, force: true });
	}

	/** Drops ledger events older than the retention window. Returns how many were removed. */
	async purgeExpiredEvents(retentionDays: number, now = new Date()): Promise<number> {
		if (!Number.isFinite(retentionDays) || retentionDays < 1) {
			return 0;
		}

		let removed = 0;
		await this.mutate(async () => {
			const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1_000;
			for (const uri of Object.keys(this.getStates())) {
				const eventPath = path.join(this.getRepositoryDirectoryForUri(uri), 'events.jsonl');
				let contents: string;
				try {
					contents = await fs.readFile(eventPath, 'utf8');
				} catch {
					continue;
				}

				const lines = contents.split('\n').filter((line) => line.trim() !== '');
				const kept = lines.filter((line) => !isExpiredEventLine(line, cutoff));
				if (kept.length === lines.length) {
					continue;
				}

				const temporaryPath = `${eventPath}.${randomUUID()}.tmp`;
				try {
					await fs.writeFile(temporaryPath, kept.map((line) => `${line}\n`).join(''), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
					await fs.rename(temporaryPath, eventPath);
				} finally {
					await fs.rm(temporaryPath, { force: true });
				}
				removed += lines.length - kept.length;

				const states = this.getStates();
				if (states[uri]) {
					states[uri] = { ...states[uri], eventCount: parseEventLog(kept.join('\n')).length };
					await this.context.globalState.update(REPOSITORY_STATE_KEY, states);
				}
			}
		});
		return removed;
	}

	private mutate(action: () => Promise<void>): Promise<void> {
		const result = this.mutationQueue.then(action);
		this.mutationQueue = result.catch(() => {});
		return result;
	}

	private getPersistedRepositoryState(folder: vscode.WorkspaceFolder): RepositoryState {
		return this.getStates()[folder.uri.toString()] ?? { enabled: false, paused: false, eventCount: 0 };
	}

	private getStates(): RepositoryStateMap {
		return this.context.globalState.get<RepositoryStateMap>(REPOSITORY_STATE_KEY, {});
	}

	private async updateState(folder: vscode.WorkspaceFolder, state: RepositoryState): Promise<void> {
		const states = this.getStates();
		states[folder.uri.toString()] = state;
		await this.context.globalState.update(REPOSITORY_STATE_KEY, states);
	}

	private async appendEvent(
		folder: vscode.WorkspaceFolder,
		kind: string,
		payload: Record<string, unknown> = {},
	): Promise<void> {
		const repositoryDirectory = this.getRepositoryDirectory(folder);
		await fs.mkdir(repositoryDirectory, { recursive: true, mode: 0o700 });
		await this.tryChmod(repositoryDirectory, 0o700);

		const event = {
			schemaVersion: 1,
			eventId: randomUUID(),
			occurredAt: new Date().toISOString(),
			kind,
			source: { harness: 'extension-preview' },
			repository: {
				uri: folder.uri.toString(),
				name: folder.name,
			},
			payload,
			redaction: {
				rulesVersion: 1,
				replacementCount: 0,
			},
		};
		const redacted = redactSecrets(JSON.stringify(event));
		const safeEvent = JSON.parse(redacted.value) as typeof event;
		safeEvent.redaction.replacementCount = redacted.replacementCount;

		const eventPath = this.getEventLogPath(folder);
		await fs.appendFile(eventPath, `${JSON.stringify(safeEvent)}\n`, { encoding: 'utf8', mode: 0o600 });
		await this.tryChmod(eventPath, 0o600);

		const state = this.getPersistedRepositoryState(folder);
		await this.updateState(folder, { ...state, eventCount: state.eventCount + 1 });
	}

	private getRepositoryDirectory(folder: vscode.WorkspaceFolder): string {
		return this.getRepositoryDirectoryForUri(folder.uri.toString());
	}

	private getRepositoryDirectoryForUri(uri: string): string {
		const repositoryId = createHash('sha256').update(uri).digest('hex').slice(0, 16);
		return path.join(this.context.globalStorageUri.fsPath, 'repositories', repositoryId);
	}

	private getEventLogPath(folder: vscode.WorkspaceFolder): string {
		return path.join(this.getRepositoryDirectory(folder), 'events.jsonl');
	}

	private async tryChmod(targetPath: string, mode: number): Promise<void> {
		try {
			await fs.chmod(targetPath, mode);
		} catch {
			// Filesystems without POSIX modes still receive pre-persistence redaction.
		}
	}
}