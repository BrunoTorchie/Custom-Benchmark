import * as assert from 'assert';

import { getPromptHandoff } from '../promptHandoff';

suite('Prompt handoff', () => {
	test('prefills Copilot without submitting the draft', () => {
		const handoff = getPromptHandoff('copilot', 'Review this change.');

		assert.strictEqual(handoff.commandId, 'workbench.action.chat.open');
		assert.deepStrictEqual(handoff.commandArguments, [{
			mode: 'agent',
			query: 'Review this change.',
			isPartialQuery: true,
		}]);
		assert.strictEqual(handoff.draftPrefilled, true);
	});

	test('opens third-party harnesses without attempting unsupported text injection', () => {
		const claude = getPromptHandoff('claude', 'Plan this architecture.');
		const codex = getPromptHandoff('codex', 'Fix this regression.');

		assert.deepStrictEqual(claude.commandArguments, []);
		assert.deepStrictEqual(codex.commandArguments, []);
		assert.strictEqual(claude.draftPrefilled, false);
		assert.strictEqual(codex.draftPrefilled, false);
	});
});