import * as assert from 'assert';

import { createDashboardModel } from '../dashboardModel';
import { ProviderStatus } from '../model';

const providers: ProviderStatus[] = [
	{ id: 'copilot', name: 'GitHub Copilot', installed: true },
	{ id: 'claude', name: 'Claude Code', installed: true },
	{ id: 'codex', name: 'OpenAI Codex', installed: true },
];

suite('Dashboard model', () => {
	test('offers consent as the primary action when capture is off', () => {
		const model = createDashboardModel({
			repositoryName: 'Custom Benchmark',
			mode: 'off',
			eventCount: 0,
			providers,
		});

		assert.strictEqual(model.statusLabel, 'Capture off');
		assert.strictEqual(model.headline, 'Private by default');
		assert.deepStrictEqual(model.primaryAction, {
			label: 'Enable for this folder',
			command: 'enableRepository',
		});
		assert.strictEqual(model.providerSummary, '3 detected');
	});

	test('offers a local pipeline check while capture is active', () => {
		const model = createDashboardModel({
			repositoryName: 'Custom Benchmark',
			mode: 'capturing',
			eventCount: 4,
			providers,
		});

		assert.strictEqual(model.statusLabel, 'Preview active');
		assert.strictEqual(model.headline, 'Local ledger ready');
		assert.deepStrictEqual(model.primaryAction, {
			label: 'Run capture check',
			command: 'recordPreviewEvent',
		});
		assert.deepStrictEqual(model.secondaryAction, {
			label: 'Pause',
			command: 'pauseCapture',
		});
	});

	test('makes resume the primary action while paused', () => {
		const model = createDashboardModel({
			mode: 'paused',
			eventCount: 2,
			providers: providers.map((provider, index) => ({
				...provider,
				installed: index !== 2,
			})),
		});

		assert.strictEqual(model.statusLabel, 'Preview paused');
		assert.strictEqual(model.headline, 'Local ledger paused');
		assert.deepStrictEqual(model.primaryAction, {
			label: 'Resume capture',
			command: 'resumeCapture',
		});
		assert.strictEqual(model.providerSummary, '2 detected');
	});
});