import * as assert from 'assert';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
	PromptHookFile,
	arePromptHookFilesConnected,
	updatePromptHookFiles,
} from '../promptHookFiles';

suite('Prompt hook files', () => {
	let temporaryDirectory: string;
	let copilotPath: string;
	let claudePath: string;
	let codexPath: string;
	let files: PromptHookFile[];

	setup(async () => {
		temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'personal-benchmark-hooks-'));
		copilotPath = path.join(temporaryDirectory, '.copilot', 'hooks', 'personal-benchmark.json');
		claudePath = path.join(temporaryDirectory, '.claude', 'settings.json');
		codexPath = path.join(temporaryDirectory, '.codex', 'hooks.json');
		files = [
			{ filePath: copilotPath, format: 'direct', command: markedCommand('vscode') },
			{ filePath: claudePath, format: 'grouped', command: markedCommand('claude') },
			{ filePath: codexPath, format: 'grouped', command: markedCommand('codex') },
		];
	});

	teardown(async () => {
		await fs.rm(temporaryDirectory, { recursive: true, force: true });
	});

	test('writes through a symlinked settings file and keeps its permissions', async function () {
		if (process.platform === 'win32') { this.skip(); }
		const managedPath = path.join(temporaryDirectory, 'dotfiles', 'claude-settings.json');
		await fs.mkdir(path.dirname(managedPath), { recursive: true });
		await fs.writeFile(managedPath, JSON.stringify({ theme: 'dark' }), { mode: 0o644 });
		await fs.chmod(managedPath, 0o644);
		await fs.mkdir(path.dirname(claudePath), { recursive: true });
		await fs.symlink(managedPath, claudePath);

		await updatePromptHookFiles(files, true);
		assert.ok((await fs.lstat(claudePath)).isSymbolicLink(), 'The dotfile link must survive connect');
		assert.strictEqual((await fs.stat(managedPath)).mode & 0o777, 0o644);
		assert.ok(JSON.parse(await fs.readFile(managedPath, 'utf8')).hooks);
		assert.strictEqual((await fs.stat(copilotPath)).mode & 0o777, 0o600, 'New hook files stay owner-only');

		await updatePromptHookFiles(files, false);
		assert.ok((await fs.lstat(claudePath)).isSymbolicLink(), 'The dotfile link must survive disconnect');
		assert.deepStrictEqual(JSON.parse(await fs.readFile(managedPath, 'utf8')), { theme: 'dark' });
	});

	test('connects all hosts and restores unrelated configuration on disconnect', async () => {
		const originalClaude = {
			theme: 'dark',
			hooks: {
				UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'existing-hook' }] }],
			},
		};
		await fs.mkdir(path.dirname(claudePath), { recursive: true });
		await fs.writeFile(claudePath, JSON.stringify(originalClaude));

		await updatePromptHookFiles(files, true);

		assert.strictEqual(await arePromptHookFilesConnected(files), true);
		const copilot = JSON.parse(await fs.readFile(copilotPath, 'utf8')) as {
			hooks: { UserPromptSubmit: Array<Record<string, unknown>> };
		};
		const claude = JSON.parse(await fs.readFile(claudePath, 'utf8')) as {
			theme: string;
			hooks: { UserPromptSubmit: unknown[] };
		};
		assert.strictEqual(copilot.hooks.UserPromptSubmit[0].command, markedCommand('vscode'));
		assert.strictEqual('hooks' in copilot.hooks.UserPromptSubmit[0], false);
		assert.strictEqual(claude.theme, 'dark');
		assert.strictEqual(claude.hooks.UserPromptSubmit.length, 2);

		await updatePromptHookFiles(files, false);

		assert.deepStrictEqual(JSON.parse(await fs.readFile(claudePath, 'utf8')), originalClaude);
		await assert.rejects(fs.access(copilotPath), { code: 'ENOENT' });
		await assert.rejects(fs.access(codexPath), { code: 'ENOENT' });
	});

	test('validates every existing file before changing any of them', async () => {
		const originalCopilot = {
			hooks: { UserPromptSubmit: [{ type: 'command', command: 'existing-hook' }] },
		};
		await Promise.all([
			fs.mkdir(path.dirname(copilotPath), { recursive: true }),
			fs.mkdir(path.dirname(claudePath), { recursive: true }),
		]);
		await Promise.all([
			fs.writeFile(copilotPath, JSON.stringify(originalCopilot)),
			fs.writeFile(claudePath, '{not-json'),
		]);

		await assert.rejects(updatePromptHookFiles(files, true), /not valid JSON/);

		assert.deepStrictEqual(JSON.parse(await fs.readFile(copilotPath, 'utf8')), originalCopilot);
		await assert.rejects(fs.access(codexPath), { code: 'ENOENT' });
	});
});

function markedCommand(adapter: string): string {
	return `env PERSONAL_BENCHMARK_PROMPT_HOOK=1 node bridge.cjs ${adapter}`;
}