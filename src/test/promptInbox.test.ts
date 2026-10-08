import * as assert from 'assert';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import * as path from 'node:path';

import { PromptInboxItem } from '../promptFeedProtocol';
import { drainPromptInbox } from '../promptInbox';
import { recommendModel } from '../recommendation';

suite('Prompt inbox', () => {
	let temporaryDirectory: string;

	setup(async () => {
		temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'personal-benchmark-inbox-'));
	});

	teardown(async () => {
		await fs.rm(temporaryDirectory, { recursive: true, force: true });
	});

	test('restores a claimed item when processing fails, then consumes it on retry', async () => {
		await writeItem('event.json');

		await drainPromptInbox(temporaryDirectory, async () => {
			throw new Error('Temporary storage failure');
		});
		assert.deepStrictEqual(await fs.readdir(temporaryDirectory), ['event.json']);

		let received: PromptInboxItem | undefined;
		await drainPromptInbox(temporaryDirectory, async (item) => {
			received = item;
			return true;
		});
		assert.strictEqual(received?.recommendation.providerId, 'codex');
		assert.deepStrictEqual(await fs.readdir(temporaryDirectory), []);
	});

	test('discards malformed files and recovers stale interrupted claims', async () => {
		await fs.writeFile(path.join(temporaryDirectory, 'malformed.json'), '{not-json');
		const claimedName = 'event.json.processing-dead-process';
		await writeItem(claimedName);
		const oldDate = new Date(Date.now() - 60_000);
		await fs.utimes(path.join(temporaryDirectory, claimedName), oldDate, oldDate);

		let calls = 0;
		await drainPromptInbox(temporaryDirectory, async () => {
			calls += 1;
			return true;
		});

		assert.strictEqual(calls, 1);
		assert.deepStrictEqual(await fs.readdir(temporaryDirectory), []);
	});

	test('recovers a claim whose numeric owner process has exited, but not one held by a live process', async () => {
		const deadPid = await new Promise<number>((resolve, reject) => {
			const child = spawn(process.execPath, ['-e', ''], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
			child.on('error', reject);
			child.on('exit', () => resolve(child.pid!));
		});
		const oldDate = new Date(Date.now() - 60_000);
		for (const name of [`dead.json.processing-${deadPid}-claim`, `live.json.processing-${process.pid}-claim`]) {
			await writeItem(name);
			await fs.utimes(path.join(temporaryDirectory, name), oldDate, oldDate);
		}

		const consumed: string[] = [];
		await drainPromptInbox(temporaryDirectory, async (item) => {
			consumed.push(item.id);
			return true;
		});

		assert.strictEqual(consumed.length, 1);
		assert.deepStrictEqual(await fs.readdir(temporaryDirectory), [`live.json.processing-${process.pid}-claim`]);
	});

	test('does not steal an old item while another consumer is still processing it', async () => {
		await writeItem('slow.json');
		const oldDate = new Date(Date.now() - 60_000);
		await fs.utimes(path.join(temporaryDirectory, 'slow.json'), oldDate, oldDate);
		let release!: () => void;
		let started!: () => void;
		const processing = new Promise<void>((resolve) => { started = resolve; });
		const gate = new Promise<void>((resolve) => { release = resolve; });
		let calls = 0;
		const first = drainPromptInbox(temporaryDirectory, async () => {
			calls += 1;
			started();
			await gate;
			return true;
		});
		await processing;
		try {
			await drainPromptInbox(temporaryDirectory, async () => {
				calls += 1;
				return true;
			});
		} finally {
			release();
			await first;
		}
		assert.strictEqual(calls, 1, 'An active claim must not be processed twice');
	});

	async function writeItem(fileName: string): Promise<void> {
		const recommendation = recommendModel(
			'Fix the failing tests and verify the patch.',
			[
				{ id: 'copilot', name: 'GitHub Copilot', installed: true },
				{ id: 'claude', name: 'Claude Code', installed: true },
				{ id: 'codex', name: 'OpenAI Codex', installed: true },
			],
			'codex',
			new Date('2026-09-04T12:00:00Z'),
		);
		const item: PromptInboxItem = {
			schemaVersion: 1,
			id: 'event-id',
			cwd: temporaryDirectory,
			source: 'codex',
			receivedAt: '2026-09-04T12:00:00.000Z',
			replacementCount: 0,
			recommendation,
		};
		await fs.writeFile(path.join(temporaryDirectory, fileName), JSON.stringify(item));
	}
});