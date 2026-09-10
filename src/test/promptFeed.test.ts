import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
	addDirectPromptHook,
	addPromptHook,
	isPathInsideRoot,
	normalizePromptHookInput,
	removeDirectPromptHook,
	removePromptHook,
} from '../promptFeedProtocol';

suite('Live prompt feed protocol', () => {
	test('normalizes VS Code, Claude, and Codex prompt events', () => {
		const shared = normalizePromptHookInput({
			hook_event_name: 'UserPromptSubmit',
			cwd: '/repo',
			prompt: 'Design the service',
			session_id: 'session-1',
			transcript_path: '/Users/me/.claude/projects/session.jsonl',
		}, 'claude');
		const vscode = normalizePromptHookInput({
			hook_event_name: 'UserPromptSubmit',
			cwd: '/repo',
			prompt: 'Explain the function',
			transcript_path: '/Users/me/Library/Application Support/Code/session.jsonl',
		}, 'vscode');
		const codex = normalizePromptHookInput({
			hook_event_name: 'UserPromptSubmit',
			cwd: '/repo',
			prompt: 'Fix the test',
			session_id: 'session-2',
			turn_id: 'turn-1',
		}, 'codex');

		assert.strictEqual(shared?.source, 'claude');
		assert.strictEqual(vscode?.source, 'vscode');
		assert.strictEqual(codex?.source, 'codex');
		assert.strictEqual(codex?.turnId, 'turn-1');
		assert.strictEqual(normalizePromptHookInput({ hook_event_name: 'Stop' }, 'vscode'), undefined);
		assert.strictEqual(normalizePromptHookInput({
			hook_event_name: 'UserPromptSubmit',
			cwd: '/repo',
			prompt: 'Do not duplicate this event',
			transcript_path: '/Users/me/Library/Application Support/Code/session.jsonl',
		}, 'claude'), undefined);
	});

	test('matches canonical repository boundaries without prefix collisions', () => {
		assert.strictEqual(isPathInsideRoot('/work/app', '/work/app'), true);
		assert.strictEqual(isPathInsideRoot('/work/app/src', '/work/app'), true);
		assert.strictEqual(isPathInsideRoot('/work/application', '/work/app'), false);
		assert.strictEqual(isPathInsideRoot('/work/other', '/work/app'), false);
	});

	test('adds and removes only the Personal Benchmark hook', () => {
		const existing = {
			theme: 'dark',
			hooks: {
				UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'existing-hook' }] }],
			},
		};
		const command = 'env PERSONAL_BENCHMARK_PROMPT_HOOK=1 node /bridge.cjs';
		const connected = addPromptHook(existing, command);

		assert.strictEqual(connected.theme, 'dark');
		assert.strictEqual(connected.hooks.UserPromptSubmit.length, 2);
		assert.deepStrictEqual(removePromptHook(connected), existing);
	});

	test('does not duplicate an existing Personal Benchmark hook', () => {
		const command = 'env PERSONAL_BENCHMARK_PROMPT_HOOK=1 node /bridge.cjs';
		const once = addPromptHook({}, command);
		const twice = addPromptHook(once, command);

		assert.strictEqual(twice.hooks.UserPromptSubmit.length, 1);
	});

	test('preserves unrelated handlers that share a grouped hook entry', () => {
		const command = 'env PERSONAL_BENCHMARK_PROMPT_HOOK=1 node /bridge.cjs';
		const configuration = {
			hooks: {
				UserPromptSubmit: [{
					matcher: '*',
					hooks: [
						{ type: 'command', command: 'existing-hook' },
						{ type: 'command', command },
					],
				}],
			},
		};

		const disconnected = removePromptHook(configuration);
		assert.deepStrictEqual(disconnected.hooks.UserPromptSubmit, [{
			matcher: '*',
			hooks: [{ type: 'command', command: 'existing-hook' }],
		}]);
	});

	test('adds a direct VS Code handler and removes only its own entry', () => {
		const existing = {
			description: 'Personal user hooks',
			hooks: {
				UserPromptSubmit: [{ type: 'command', command: 'existing-hook', timeout: 4 }],
			},
		};
		const command = 'env PERSONAL_BENCHMARK_PROMPT_HOOK=1 node /bridge.cjs';
		const connected = addDirectPromptHook(existing, command);

		assert.strictEqual(connected.hooks.UserPromptSubmit.length, 2);
		assert.strictEqual('hooks' in connected.hooks.UserPromptSubmit[1], false);
		assert.deepStrictEqual(removeDirectPromptHook(connected), existing);
	});
});

suite('Prompt hook bridge', () => {
	let temporaryDirectory: string;
	let enabledRoot: string;
	let siblingRoot: string;
	let inboxDirectory: string;
	let configurationPath: string;

	setup(async () => {
		temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'personal-benchmark-feed-'));
		enabledRoot = path.join(temporaryDirectory, 'enabled');
		siblingRoot = path.join(temporaryDirectory, 'enabled-copy');
		inboxDirectory = path.join(temporaryDirectory, 'inbox');
		configurationPath = path.join(temporaryDirectory, 'config.json');
		await Promise.all([
			fs.mkdir(enabledRoot),
			fs.mkdir(siblingRoot),
		]);
		await fs.writeFile(configurationPath, JSON.stringify({
			schemaVersion: 1,
			inboxDirectory,
			enabledRoots: [enabledRoot],
			providers: [
				{ id: 'copilot', name: 'GitHub Copilot', installed: true },
				{ id: 'claude', name: 'Claude Code', installed: true },
				{ id: 'codex', name: 'OpenAI Codex', installed: true },
			],
		}));
	});

	teardown(async () => {
		await fs.rm(temporaryDirectory, { recursive: true, force: true });
	});

	test('persists only a derived, redacted recommendation for an enabled root', async () => {
		const secret = 'sk-example123456789';
		runBridge(configurationPath, {
			hook_event_name: 'UserPromptSubmit',
			cwd: enabledRoot,
			prompt: `Fix the failing auth tests with OPENAI_API_KEY=${secret}`,
			session_id: 'session-1',
		});

		const files = await fs.readdir(inboxDirectory);
		assert.strictEqual(files.length, 1);
		const persisted = await fs.readFile(path.join(inboxDirectory, files[0]), 'utf8');
		const item = JSON.parse(persisted) as Record<string, unknown>;
		const recommendation = item.recommendation as Record<string, unknown>;

		assert.ok(!persisted.includes(secret));
		assert.strictEqual(item.prompt, undefined);
		assert.strictEqual(item.sessionId, undefined);
		assert.strictEqual(item.turnId, undefined);
		assert.strictEqual(item.model, undefined);
		assert.strictEqual(recommendation.providerId, 'codex');
		assert.ok(String(recommendation.promptPreview).includes('[REDACTED]'));
		assert.strictEqual(String(recommendation.promptHash).length, 64);
	});

	test('writes nothing for a sibling repository with a shared path prefix', async () => {
		runBridge(configurationPath, {
			hook_event_name: 'UserPromptSubmit',
			cwd: siblingRoot,
			prompt: 'Fix the failing tests',
		});

		await assertInboxIsEmpty(inboxDirectory);
	});

	test('exits successfully without writing when input is malformed', async () => {
		runBridge(configurationPath, '{not-json');
		await assertInboxIsEmpty(inboxDirectory);
	});

	test('writes nothing when the prompt exceeds the character limit', async () => {
		runBridge(configurationPath, {
			hook_event_name: 'UserPromptSubmit',
			cwd: enabledRoot,
			prompt: 'x'.repeat(100_001),
		});
		await assertInboxIsEmpty(inboxDirectory);
	});
});

function runBridge(configurationPath: string, input: unknown, adapter = 'vscode'): void {
	const bridgePath = path.resolve(__dirname, '../../dist/prompt-hook.cjs');
	execFileSync(process.execPath, [bridgePath, configurationPath, adapter], {
		input: typeof input === 'string' ? input : JSON.stringify(input),
		env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
		stdio: ['pipe', 'pipe', 'pipe'],
	});
}

async function assertInboxIsEmpty(inboxDirectory: string): Promise<void> {
	try {
		assert.deepStrictEqual(await fs.readdir(inboxDirectory), []);
	} catch (error) {
		assert.strictEqual((error as NodeJS.ErrnoException).code, 'ENOENT');
	}
}