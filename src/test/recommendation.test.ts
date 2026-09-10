import * as assert from 'assert';

import { ProviderStatus } from '../model';
import { LiveRecommendation, isCurrentRecommendation, recommendModel } from '../recommendation';

const providers: ProviderStatus[] = [
	{ id: 'copilot', name: 'GitHub Copilot', installed: true },
	{ id: 'claude', name: 'Claude Code', installed: true },
	{ id: 'codex', name: 'OpenAI Codex', installed: true },
];

suite('Prompt recommendation', () => {
	test('rejects a persisted recommendation from the fixed-model engine', () => {
		const legacy = { engineVersion: 1 } as unknown as LiveRecommendation;

		assert.strictEqual(isCurrentRecommendation(legacy), false);
		assert.strictEqual(isCurrentRecommendation(undefined), false);
		assert.strictEqual(isCurrentRecommendation(recommendModel('Explain this.', providers, 'manual')), true);
	});

	test('routes architecture trade-offs through Claude with the frontier research model', () => {
		const recommendation = recommendModel(
			'Design the architecture for a multi-tenant event system. Compare trade-offs, security boundaries, migration risks, and document an ADR.',
			providers,
			'manual',
			new Date('2026-09-04T12:00:00Z'),
		);

		assert.strictEqual(recommendation.providerId, 'claude');
		assert.strictEqual(recommendation.modelLabel, 'Claude Fable 5.1');
		assert.strictEqual(recommendation.profileLabel, 'Max adaptive reasoning (default fallback)');
		assert.strictEqual(recommendation.modelSelectionBasis, 'artificial-analysis-heuristic');
		assert.ok(recommendation.modelSelectionNote.includes('still being generated'));
		assert.strictEqual(recommendation.taskType, 'Architecture');
		assert.ok(recommendation.confidence >= 75);
	});

	test('routes repository debugging and test loops to Codex', () => {
		const recommendation = recommendModel(
			'Fix the failing authentication tests, trace the regression, implement the patch, and run the focused test suite.',
			providers,
			'codex',
			new Date('2026-09-04T12:00:00Z'),
		);

		assert.strictEqual(recommendation.providerId, 'codex');
		assert.strictEqual(recommendation.modelLabel, 'GPT 6 Astra');
		assert.strictEqual(recommendation.profileLabel, 'Max reasoning');
		assert.strictEqual(recommendation.taskType, 'Debugging');
		assert.ok(recommendation.reason.includes('test'));
	});

	test('routes a narrow explanation to the fast lightweight model', () => {
		const recommendation = recommendModel(
			'Explain what this function does in two sentences.',
			providers,
			'vscode',
			new Date('2026-09-04T12:00:00Z'),
		);

		assert.strictEqual(recommendation.providerId, 'copilot');
		assert.strictEqual(recommendation.modelLabel, 'Gemini 3.5 Flash Lite');
		assert.strictEqual(recommendation.profileLabel, 'Default reasoning');
		assert.strictEqual(recommendation.taskType, 'Quick task');
	});

	test('falls back to an installed provider', () => {
		const recommendation = recommendModel(
			'Plan the architecture and evaluate the security trade-offs.',
			providers.map((provider) => ({
				...provider,
				installed: provider.id === 'codex',
			})),
			'manual',
			new Date('2026-09-04T12:00:00Z'),
		);

		assert.strictEqual(recommendation.providerId, 'codex');
		assert.strictEqual(recommendation.modelLabel, 'Claude Fable 5.1');
		assert.strictEqual(recommendation.fallbackApplied, true);
	});

	test('redacts secrets from the persisted prompt preview', () => {
		const recommendation = recommendModel(
			'Fix the API client using OPENAI_API_KEY=sk-example123456789 and add a regression test.',
			providers,
			'manual',
			new Date('2026-09-04T12:00:00Z'),
		);

		assert.ok(!recommendation.promptPreview.includes('sk-example123456789'));
		assert.ok(recommendation.promptPreview.includes('[REDACTED]'));
		assert.strictEqual(recommendation.analyzedAt, '2026-09-04T12:00:00.000Z');
	});

	test('hashes the redacted canonical prompt instead of secret values', () => {
		const first = recommendModel(
			'Fix the API client using API_KEY=sk-firstsecret123456 and add a test.',
			providers,
			'manual',
		);
		const second = recommendModel(
			'Fix the API client using API_KEY=sk-secondsecret123456 and add a test.',
			providers,
			'manual',
		);

		assert.strictEqual(first.promptHash, second.promptHash);
	});

	test('routes extension and UI product work to Codex implementation', () => {
		const recommendation = recommendModel(
			'Update the extension so users can see a live model recommendation in the dashboard for the task they just submitted.',
			providers,
			'vscode',
		);

		assert.strictEqual(recommendation.providerId, 'codex');
		assert.strictEqual(recommendation.taskType, 'Implementation');
		assert.strictEqual(recommendation.modelLabel, 'Gemini 3.8 Flash High');
	});

	test('uses the fast profile for a small request without specialist signals', () => {
		const recommendation = recommendModel(
			'Help me choose a concise variable name.',
			providers,
			'manual',
		);

		assert.strictEqual(recommendation.providerId, 'copilot');
		assert.strictEqual(recommendation.taskType, 'Quick task');
		assert.strictEqual(recommendation.modelLabel, 'Gemini 3.5 Flash Lite');
	});

	test('honors an explicitly requested GPT 5.6 family and effort', () => {
		const recommendation = recommendModel(
			'Use GPT 5.6 Terra with medium reasoning to implement the settings page.',
			providers,
			'manual',
		);

		assert.strictEqual(recommendation.modelProfileId, 'gpt-5-6-terra-medium');
		assert.strictEqual(recommendation.modelLabel, 'GPT 5.6 Terra');
		assert.strictEqual(recommendation.profileLabel, 'Medium reasoning');
		assert.strictEqual(recommendation.modelSelectionBasis, 'explicit-request');
	});

	test('uses sufficiently sampled registered results ahead of the heuristic', () => {
		const recommendation = recommendModel(
			'Fix the failing authentication tests and trace the regression.',
			providers,
			'codex',
			new Date('2026-09-04T12:00:00Z'),
			[
				{ modelProfileId: 'claude-opus-4-8', taskType: 'Debugging', sampleSize: 8, score: 96 },
				{ modelProfileId: 'gpt-6-astra', taskType: 'Debugging', sampleSize: 12, score: 82 },
			],
		);

		assert.strictEqual(recommendation.modelProfileId, 'claude-opus-4-8');
		assert.strictEqual(recommendation.modelSelectionBasis, 'registered-benchmark');
		assert.ok(recommendation.modelSelectionNote.includes('8 registered debugging cases'));
	});

	test('ignores registered results below the minimum sample size', () => {
		const recommendation = recommendModel(
			'Debug the production regression and run the focused tests.',
			providers,
			'codex',
			new Date('2026-09-04T12:00:00Z'),
			[{ modelProfileId: 'claude-opus-4-8', taskType: 'Debugging', sampleSize: 2, score: 100 }],
		);

		assert.strictEqual(recommendation.modelProfileId, 'gpt-6-astra');
		assert.strictEqual(recommendation.modelSelectionBasis, 'artificial-analysis-heuristic');
	});
});