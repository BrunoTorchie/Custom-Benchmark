import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as vscode from 'vscode';

import {
	PROMPT_HOOK_MARKER,
	PromptBridgeConfiguration,
	PromptInboxItem,
	PromptHookAdapter,
} from './promptFeedProtocol';
import { PromptHookFile, arePromptHookFilesConnected, updatePromptHookFiles } from './promptHookFiles';
import { drainPromptInbox } from './promptInbox';
import { detectProviders } from './providers';
import { LocalStore } from './store';

const POLL_INTERVAL_MS = 750;

export class PromptFeedService implements vscode.Disposable {
	private readonly bridgeDirectory: string;
	private readonly bridgePath: string;
	private readonly configPath: string;
	private readonly inboxDirectory: string;
	private readonly copilotHooksPath = path.join(os.homedir(), '.copilot', 'hooks', 'personal-benchmark.json');
	private readonly claudeHooksPath = path.join(os.homedir(), '.claude', 'settings.json');
	private readonly codexHooksPath = path.join(os.homedir(), '.codex', 'hooks.json');
	private timer?: NodeJS.Timeout;
	private draining = false;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly store: LocalStore,
	) {
		this.bridgeDirectory = path.join(context.globalStorageUri.fsPath, 'prompt-feed');
		this.bridgePath = path.join(this.bridgeDirectory, 'prompt-hook.cjs');
		this.configPath = path.join(this.bridgeDirectory, 'config.json');
		this.inboxDirectory = path.join(this.bridgeDirectory, 'inbox');
	}

	async initialize(): Promise<boolean> {
		await this.installBridgeFiles();
		await this.syncConfiguration();
		return this.isConnected();
	}

	async connect(): Promise<void> {
		await this.installBridgeFiles();
		await this.syncConfiguration();
		await updatePromptHookFiles(this.getHookFiles(), true);
	}

	async disconnect(): Promise<void> {
		await updatePromptHookFiles(this.getHookFiles(), false);
	}

	async isConnected(): Promise<boolean> {
		return arePromptHookFilesConnected(this.getHookFiles());
	}

	async syncConfiguration(): Promise<void> {
		const configuration: PromptBridgeConfiguration = {
			schemaVersion: 1,
			inboxDirectory: this.inboxDirectory,
			enabledRoots: await this.store.getEnabledRepositoryPaths(),
			providers: detectProviders(),
		};
		await this.writeJsonAtomically(this.configPath, configuration);
	}

	start(onPrompt: (item: PromptInboxItem) => Promise<boolean>): void {
		if (this.timer) {
			return;
		}

		this.timer = setInterval(() => {
			void this.drain(onPrompt);
		}, POLL_INTERVAL_MS);
		this.timer.unref();
		void this.drain(onPrompt);
	}

	dispose(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	private async installBridgeFiles(): Promise<void> {
		await fs.mkdir(this.inboxDirectory, { recursive: true, mode: 0o700 });
		const bundledBridge = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'prompt-hook.cjs').fsPath;
		const temporaryPath = `${this.bridgePath}.${process.pid}-${randomUUID()}.tmp`;
		try {
			await fs.copyFile(bundledBridge, temporaryPath);
			await this.tryChmod(temporaryPath, 0o700);
			await fs.rename(temporaryPath, this.bridgePath);
			await this.tryChmod(this.bridgeDirectory, 0o700);
			await this.tryChmod(this.inboxDirectory, 0o700);
			await this.tryChmod(this.bridgePath, 0o700);
		} finally {
			await fs.rm(temporaryPath, { force: true });
		}
	}

	private createHookCommand(adapter: PromptHookAdapter): string {
		return [
			'env',
			PROMPT_HOOK_MARKER,
			'ELECTRON_RUN_AS_NODE=1',
			shellQuote(process.execPath),
			shellQuote(this.bridgePath),
			shellQuote(this.configPath),
			adapter,
		].join(' ');
	}

	private getHookFiles(): PromptHookFile[] {
		return [
			{ filePath: this.copilotHooksPath, format: 'direct', command: this.createHookCommand('vscode') },
			{ filePath: this.claudeHooksPath, format: 'grouped', command: this.createHookCommand('claude') },
			{ filePath: this.codexHooksPath, format: 'grouped', command: this.createHookCommand('codex') },
		];
	}

	private async writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
		await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
		const temporaryPath = `${filePath}.${process.pid}-${randomUUID()}.tmp`;
		try {
			await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
				encoding: 'utf8',
				mode: 0o600,
				flag: 'wx',
			});
			await this.tryChmod(temporaryPath, 0o600);
			await fs.rename(temporaryPath, filePath);
			await this.tryChmod(filePath, 0o600);
		} finally {
			await fs.rm(temporaryPath, { force: true });
		}
	}

	private async drain(onPrompt: (item: PromptInboxItem) => Promise<boolean>): Promise<void> {
		if (this.draining) {
			return;
		}
		this.draining = true;
		try {
			await drainPromptInbox(this.inboxDirectory, onPrompt);
		} catch (error) {
			if (!isFileMissing(error)) {
				console.error('Personal Benchmark prompt feed:', error);
			}
		} finally {
			this.draining = false;
		}
	}

	private async tryChmod(targetPath: string, mode: number): Promise<void> {
		try {
			await fs.chmod(targetPath, mode);
		} catch {
			// Filesystems without POSIX modes still use allowlisting and redaction.
		}
	}
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function isFileMissing(error: unknown): boolean {
	return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';
}