import * as assert from 'node:assert';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import { DashboardSnapshot, DashboardViewProvider } from '../dashboard';
import { drainPromptInbox } from '../promptInbox';
import { recommendModel } from '../recommendation';
import { LocalStore } from '../store';

suite('Workflow stress tests', () => {
	let directory: string;
	let context: vscode.ExtensionContext;
	let folder: vscode.WorkspaceFolder;
	let store: LocalStore;
	setup(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-workflow-'));
		const values = new Map<string, unknown>();
		context = {
			globalStorageUri: vscode.Uri.file(path.join(directory, 'storage')),
			globalState: {
				get: (key: string, fallback: unknown) => structuredClone(values.get(key) ?? fallback),
				update: async (key: string, value: unknown) => {
					await new Promise((resolve) => setTimeout(resolve, 1));
					values.set(key, structuredClone(value));
				},
			},
		} as unknown as vscode.ExtensionContext;
		folder = { uri: vscode.Uri.file(directory), name: 'Mock repository', index: 0 };
		store = new LocalStore(context);
	});
	teardown(async () => { await fs.rm(directory, { recursive: true, force: true }); });

	test('executes recommendation and exact clipboard handoff through registered commands', async () => {
		const extension = vscode.extensions.getExtension('techtorch.personal-benchmark');
		assert.ok(extension);
		await extension.activate();
		assert.ok(vscode.workspace.workspaceFolders?.length, 'The test host must open the synthetic workspace');
		const previousClipboard = await vscode.env.clipboard.readText();
		const prompt = '\n  Fix the failing tests and verify the patch.  \n';
		let calls = 0;
		const harness = vscode.commands.registerCommand('chatgpt.openSidebar', (...args: unknown[]) => {
			calls += 1;
			assert.deepStrictEqual(args, [], 'Opening the harness must not submit a prompt');
		});
		try {
			await vscode.commands.executeCommand('personalBenchmark.analyzePrompt', prompt);
			await vscode.commands.executeCommand('personalBenchmark.openRecommendedHarness');
			assert.strictEqual(await vscode.env.clipboard.readText(), prompt);
			assert.strictEqual(calls, 1);
		} finally {
			harness.dispose();
			await vscode.env.clipboard.writeText(previousClipboard);
		}
	});

	test('continues processing after a rejected write and rejects queued writes after pause', async () => {
		await assert.rejects(store.recordPreviewEvent(folder), /Capture must be enabled/);
		await store.enable(folder);
		const pause = store.setPaused(folder, true);
		const write = store.recordPreviewEvent(folder);
		await pause;
		await assert.rejects(write, /Capture must be enabled/);
		await store.setPaused(folder, false);
		await store.recordPreviewEvent(folder);
		assert.strictEqual(store.getRepositoryState(folder).eventCount, 4);
	});

	test('keeps recommendations usable without persisting before consent or while paused', async () => {
		await store.analyzePrompt(folder, 'Fix the failing tests', [], 'manual');
		assert.ok(store.getRepositoryState(folder).recommendation);
		assert.deepStrictEqual(await store.readEvents(folder), []);
		assert.strictEqual(new LocalStore(context).getRepositoryState(folder).recommendation, undefined);
		await store.enable(folder);
		await store.setPaused(folder, true);
		const before = await store.readEvents(folder);
		await store.analyzePrompt(folder, 'Review the patch', [], 'manual');
		assert.deepStrictEqual(await store.readEvents(folder), before);
	});

	test('preserves every event and counter during 100 concurrent writes across two folders', async () => {
		const second = { ...folder, uri: vscode.Uri.file(path.join(directory, 'second')) };
		await Promise.all([store.enable(folder), store.enable(second)]);
		assert.strictEqual(store.getCaptureMode(folder), 'capturing');
		assert.strictEqual(store.getCaptureMode(second), 'capturing');
		await Promise.all(Array.from({ length: 100 }, (_, i) => store.recordPreviewEvent(i % 2 ? folder : second)));
		for (const target of [folder, second]) {
			const events = await store.readEvents(target);
			assert.strictEqual(events.length, 51);
			assert.strictEqual(store.getRepositoryState(target).eventCount, events.length);
			assert.strictEqual(new Set(events.map((event) => event.eventId)).size, 51);
		}
	});

	test('purges ledger events older than the retention window and keeps the counter accurate', async () => {
		await store.enable(folder);
		await store.recordPreviewEvent(folder);
		await store.recordPreviewEvent(folder);
		assert.strictEqual(await store.purgeExpiredEvents(90), 0, 'Fresh events must survive');
		const later = new Date(Date.now() + 10 * 24 * 60 * 60 * 1_000);
		assert.strictEqual(await store.purgeExpiredEvents(90, later), 0);
		await store.recordPreviewEvent(folder);
		const ledger = (await store.readEvents(folder)).reverse();
		const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1_000).toISOString();
		const eventPath = path.join(directory, 'storage', 'repositories', (await fs.readdir(path.join(directory, 'storage', 'repositories')))[0], 'events.jsonl');
		const lines = ledger.map((event, index) => JSON.stringify(index < 2 ? { ...event, occurredAt: old } : event));
		await fs.writeFile(eventPath, `${lines.join('\n')}\n{"torn":\n`);
		assert.strictEqual(await store.purgeExpiredEvents(90), 2);
		const remaining = await store.readEvents(folder);
		assert.deepStrictEqual(remaining.map((event) => event.eventId), ledger.slice(2).reverse().map((event) => event.eventId));
		assert.strictEqual(store.getRepositoryState(folder).eventCount, remaining.length);
		assert.ok((await fs.readFile(eventPath, 'utf8')).includes('{"torn":'), 'Unparseable lines are left for manual inspection');
		if (process.platform !== 'win32') { assert.strictEqual((await fs.stat(eventPath)).mode & 0o777, 0o600); }
		assert.strictEqual(await store.purgeExpiredEvents(Number.NaN), 0, 'An invalid window must never delete');

		await store.analyzePrompt(folder, 'Fix the failing tests', [], 'manual');
		assert.ok(store.getRepositoryState(folder).recommendation);
		await store.purgeExpiredEvents(90, new Date(Date.now() + 91 * 24 * 60 * 60 * 1_000));
		assert.strictEqual(store.getRepositoryState(folder).recommendation, undefined, 'The stored preview expires with the ledger');
	});

	test('redacts ledger payload values without corrupting the JSON line', async () => {
		await store.enable(folder);
		const recommendation = { ...recommendModel('Fix tests', [], 'manual'), modelLabel: 'TOKEN=x"y' };
		await store.recordRecommendation(folder, recommendation);
		const [event] = await store.readEvents(folder);
		assert.strictEqual(event.kind, 'prompt.recommended');
		assert.strictEqual(event.payload?.modelLabel, 'TOKEN=[REDACTED]"y');
		assert.strictEqual(event.repository?.name, folder.name);
		assert.strictEqual(event.redaction?.replacementCount, 1);
	});

	test('routes the real dashboard provider to the handoff after recommendation', () => {
		const html = dashboardHtml();
		assert.ok(html.includes('data-command="openRecommendedHarness"'), 'The live provider must pass the pending draft to its renderer');
	});

	test('submits the exact draft, including whitespace, from the dashboard script', () => {
		const html = dashboardHtml();
		const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
		assert.ok(script);
		const listeners = new Map<string, (event: unknown) => void>();
		const prompt = '\n  Fix this indented code.  \n';
		const input = { value: prompt, addEventListener: () => {} };
		const submit = { disabled: true, textContent: '' };
		const messages: unknown[] = [];
		runInNewContext(script, {
			acquireVsCodeApi: () => ({ postMessage: (message: unknown) => messages.push(message) }),
			document: {
				querySelector: (selector: string) => selector === '[data-draft-input]' ? input : selector === '[data-draft-submit]' ? submit : { addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback) },
				addEventListener: () => {},
				body: { dataset: { folder: html.match(/<body data-folder="([^"]*)"/)?.[1] } },
			},
		});
		listeners.get('submit')?.({ preventDefault: () => {} });
		assert.deepStrictEqual(JSON.parse(JSON.stringify(messages[0])), { type: 'command', command: 'analyzePrompt', prompt, folder: folder.uri.toString() });
	});

	test('keys dashboard drafts to the folder that rendered them and drops stale commands', async () => {
		let snapshot: DashboardSnapshot = { folder, mode: 'capturing', providers: [], hasPendingDraft: false, promptFeedConnected: false };
		let receive!: (message: unknown) => void;
		const webview = { html: '', cspSource: 'https://test.local', asWebviewUri: (uri: vscode.Uri) => uri, onDidReceiveMessage: (callback: (message: unknown) => void) => { receive = callback; return { dispose() {} }; } };
		const provider = new DashboardViewProvider(vscode.Uri.file(directory), () => snapshot);
		provider.resolveWebviewView({ webview, onDidDispose: () => ({ dispose() {} }) } as unknown as vscode.WebviewView);
		const second = { ...folder, uri: vscode.Uri.file(path.join(directory, 'second')), name: 'Second' };
		snapshot = { ...snapshot, folder: second };
		receive({ type: 'command', command: 'draftChanged', prompt: 'Draft typed in the first folder', folder: folder.uri.toString() });
		assert.strictEqual(provider.getDraft(folder), 'Draft typed in the first folder');
		assert.strictEqual(provider.getDraft(second), undefined, 'A stale view must not leak its draft into the new folder');
		const executed: unknown[][] = [];
		const commands = vscode.commands as { executeCommand: typeof vscode.commands.executeCommand };
		const original = commands.executeCommand;
		commands.executeCommand = (async (...args: unknown[]) => { executed.push(args); }) as typeof vscode.commands.executeCommand;
		try {
			receive({ type: 'command', command: 'analyzePrompt', prompt: 'Stale', folder: folder.uri.toString() });
			receive({ type: 'command', command: 'analyzePrompt', prompt: 'Current', folder: second.uri.toString() });
		} finally {
			commands.executeCommand = original;
			provider.dispose();
		}
		assert.deepStrictEqual(executed, [['personalBenchmark.analyzePrompt', 'Current']], 'Only the command from the current folder runs');
	});

	test('runs 30 real bridge processes through inbox, store, review and deletion', async () => {
		await store.enable(folder);
		const inbox = path.join(directory, 'inbox');
		const config = path.join(directory, 'config.json');
		await fs.writeFile(config, JSON.stringify({ schemaVersion: 1, inboxDirectory: inbox, enabledRoots: [directory], providers: [] }));
		const bridge = path.resolve(__dirname, '../../dist/prompt-hook.cjs');
		await Promise.all(Array.from({ length: 30 }, async (_, i) => {
			const adapter = ['vscode', 'claude', 'codex'][i % 3];
			await new Promise<void>((resolve, reject) => {
				const child = execFile(process.execPath, [bridge, config, adapter], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }, (error) => error ? reject(error) : resolve());
				child.stdin?.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: directory, transcript_path: path.join(directory, '.claude', 'session.jsonl'), prompt: `Fix test ${i}. PASSWORD="mock-sensitive-value"` }));
			});
		}));
		assert.strictEqual((await fs.readdir(inbox)).length, 30);
		for (const file of await fs.readdir(inbox)) {
			assert.ok(!(await fs.readFile(path.join(inbox, file), 'utf8')).includes('mock-sensitive-value'), 'Quoted secrets must be redacted before entering the inbox');
		}
		await Promise.all(Array.from({ length: 3 }, () => drainPromptInbox(inbox, async (item) => {
			await store.recordRecommendation(folder, item.recommendation);
			return true;
		})));
		assert.strictEqual((await store.readEvents(folder)).length, 31);
		assert.strictEqual(store.getRepositoryState(folder).eventCount, 31);
		assert.deepStrictEqual(await fs.readdir(inbox), []);
		await store.setPaused(folder, true);
		assert.deepStrictEqual(await store.getEnabledRepositoryPaths(), []);
		await store.setPaused(folder, false);
		assert.strictEqual((await store.getEnabledRepositoryPaths()).length, 1);
		await store.deleteRepositoryData(folder);
		assert.strictEqual(store.getCaptureMode(folder), 'off');
		assert.deepStrictEqual(await store.readEvents(folder), []);
	});

	function dashboardHtml(): string {
		const snapshot: DashboardSnapshot = { folder, mode: 'capturing', providers: [], recommendation: recommendModel('Fix tests', [], 'manual'), hasPendingDraft: true, promptFeedConnected: false };
		const webview = { html: '', cspSource: 'https://test.local', asWebviewUri: (uri: vscode.Uri) => uri, onDidReceiveMessage: () => ({ dispose() {} }) };
		const provider = new DashboardViewProvider(vscode.Uri.file(directory), () => snapshot);
		provider.resolveWebviewView({ webview, onDidDispose: () => ({ dispose() {} }) } as unknown as vscode.WebviewView);
		provider.dispose();
		return webview.html;
	}
});
