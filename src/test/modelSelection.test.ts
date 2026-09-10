import * as assert from 'assert';

import { MODEL_PROFILES } from '../modelCatalog';
import { selectModelProfile } from '../modelSelection';

suite('Model selection catalog', () => {
	test('contains every requested model profile exactly once', () => {
		assert.strictEqual(MODEL_PROFILES.length, 20);
		assert.strictEqual(new Set(MODEL_PROFILES.map((profile) => profile.id)).size, 20);
		assert.deepStrictEqual(
			[...new Set(MODEL_PROFILES.map((profile) => profile.modelLabel))].sort(),
			[
				'Claude Fable 5',
				'Claude Fable 5.1',
				'Claude Opus 4.8',
				'Claude Opus 5',
				'Claude Sonnet 5',
				'GPT 5.6 Luna',
				'GPT 5.6 Sol',
				'GPT 5.6 Terra',
				'GPT 6 Astra',
				'Gemini 3.5 Flash Lite',
				'Gemini 3.8 Flash High',
			].sort(),
		);

		for (const family of ['GPT 5.6 Luna', 'GPT 5.6 Terra', 'GPT 5.6 Sol']) {
			assert.deepStrictEqual(
				MODEL_PROFILES
					.filter((profile) => profile.modelLabel === family)
					.map((profile) => profile.reasoningEffort)
					.sort(),
				['high', 'low', 'medium', 'xhigh'],
			);
		}
	});

	test('makes every catalog entry selectable by an explicit request', () => {
		for (const expected of MODEL_PROFILES) {
			const selection = selectModelProfile(
				`Use ${expected.modelLabel} with ${expected.reasoningEffort} reasoning for this implementation.`,
				'Implementation',
				'codex',
			);
			assert.strictEqual(selection.profile.id, expected.id, expected.id);
			assert.strictEqual(selection.basis, 'explicit-request');
		}
	});

	test('keeps deprecated estimated profiles out of heuristic defaults', () => {
		const selection = selectModelProfile(
			'Review this authentication implementation for subtle security risks.',
			'Review',
			'claude',
		);

		assert.strictEqual(selection.profile.id, 'claude-opus-5');
		assert.notStrictEqual(selection.profile.id, 'claude-opus-4-8');
	});
});