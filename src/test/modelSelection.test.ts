import * as assert from 'assert';

import { MODEL_PROFILES, ModelTaskType } from '../modelCatalog';
import { selectModelProfile } from '../modelSelection';
import { OFFICIAL_MODELS, isModelOfferedByProvider, officialModelsForProvider } from '../providerModels';

suite('Model selection catalog', () => {
	test('covers official offerings without duplicate profile IDs or invented measurements', () => {
		assert.strictEqual(new Set(MODEL_PROFILES.map((profile) => profile.id)).size, MODEL_PROFILES.length);
		for (const model of OFFICIAL_MODELS) {
			assert.ok(MODEL_PROFILES.some((profile) => profile.modelLabel === model.label), model.label);
		}
		const haiku = MODEL_PROFILES.find((profile) => profile.modelLabel === 'Claude Haiku 4.5')!;
		assert.deepStrictEqual(haiku.artificialAnalysis, {});
		assert.ok(haiku.profileLabel.includes('not benchmarked'));
		assert.ok(!officialModelsForProvider('copilot').some((model) => model.label === 'Gemini 3.5 Flash Lite'));
		assert.ok(!officialModelsForProvider('codex').some((model) => model.label === 'GPT-5.4'));
	});

	test('makes official catalog profiles selectable on a supported provider', () => {
		for (const expected of MODEL_PROFILES) {
			const provider = OFFICIAL_MODELS.find((model) => model.label === expected.modelLabel)?.providers[0];
			if (!provider) { continue; }
			const selection = selectModelProfile(`Use ${expected.modelLabel} with ${expected.reasoningEffort} reasoning for this implementation.`, 'Implementation', provider);
			assert.strictEqual(selection.profile.id, expected.id, expected.id);
			assert.strictEqual(selection.basis, 'explicit-request');
		}
	});

	test('all task defaults stay within the selected provider offerings', () => {
		const tasks: ModelTaskType[] = ['Architecture', 'Debugging', 'Implementation', 'Review', 'Research', 'Quick task'];
		for (const provider of ['copilot', 'claude', 'codex'] as const) {
			for (const task of tasks) {
				const selected = selectModelProfile('Build a quick visual interface', task, provider);
				assert.ok(isModelOfferedByProvider(selected.profile.modelLabel, provider));
			}
		}
	});

	test('incompatible explicit requests and local results cannot bypass provider filtering', () => {
		const selected = selectModelProfile('Use Claude Fable 5.1', 'Debugging', 'codex', [
			{ modelProfileId: 'claude-opus-5', taskType: 'Debugging', sampleSize: 20, score: 100 },
			{ modelProfileId: 'vscode:custom', modelLabel: 'Custom', profileLabel: 'Default', taskType: 'Debugging', sampleSize: 20, score: 100 },
		]);
		assert.ok(isModelOfferedByProvider(selected.profile.modelLabel, 'codex'));
		assert.strictEqual(selected.basis, 'artificial-analysis-heuristic');
	});

	test('does not match a shorter model name inside a different version', () => {
		assert.notStrictEqual(selectModelProfile('Use Claude Fable 5.12', 'Research', 'claude').basis, 'explicit-request');
	});
});
