import * as assert from 'assert';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
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