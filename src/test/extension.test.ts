import * as assert from 'assert';

import * as vscode from 'vscode';

import { renderDashboard } from '../dashboard';
import { createDashboardModel } from '../dashboardModel';
import { describeEventKind, describeEventPayload } from '../extension';
import { deriveCaptureMode, getProviderReadiness } from '../model';
import { getSafeIconPath } from '../providers';
import { recommendModel } from '../recommendation';
import { parseEventLog } from '../store';

suite('Personal Benchmark model', () => {
	test('activates and registers primary commands', async () => {
		const extension = vscode.extensions.getExtension('techtorch.personal-benchmark');
		assert.ok(extension, 'Development extension was not discovered');

		await extension.activate();
		const commands = await vscode.commands.getCommands(true);

		assert.ok(commands.includes('personalBenchmark.enableRepository'));
		assert.ok(commands.includes('personalBenchmark.recordPreviewEvent'));
		assert.ok(commands.includes('personalBenchmark.deleteRepositoryData'));
		assert.ok(commands.includes('personalBenchmark.openRecommendedHarness'));
	});

	test('accepts only safe relative provider icon paths', () => {
		assert.strictEqual(getSafeIconPath({ icon: 'assets/copilot.png' }), 'assets/copilot.png');
		assert.strictEqual(getSafeIconPath({ icon: '../secret.png' }), undefined);
		assert.strictEqual(getSafeIconPath({ icon: '/tmp/icon.png' }), undefined);
		assert.strictEqual(getSafeIconPath({ icon: 42 }), undefined);
	});

	test('derives capture mode from consent and pause state', () => {
		assert.strictEqual(deriveCaptureMode(false, false), 'off');
		assert.strictEqual(deriveCaptureMode(false, true), 'off');
		assert.strictEqual(deriveCaptureMode(true, false), 'capturing');
		assert.strictEqual(deriveCaptureMode(true, true), 'paused');
	});

	test('summarizes provider readiness', () => {
		assert.deepStrictEqual(getProviderReadiness([
			{ id: 'copilot', name: 'GitHub Copilot', installed: true },
			{ id: 'claude', name: 'Claude Code', installed: true },
			{ id: 'codex', name: 'OpenAI Codex', installed: false },
		]), {
			installed: 2,
			total: 3,
			label: '2 of 3 providers ready',
		});
	});

	test('renders live recommendation provenance with a compact-height layout', () => {
		const providers = [
			{ id: 'copilot' as const, name: 'GitHub Copilot', installed: true },
			{ id: 'claude' as const, name: 'Claude Code', installed: true },
			{ id: 'codex' as const, name: 'OpenAI Codex', installed: true },
		];
		const recommendation = recommendModel(
			'Fix the failing authentication tests and run the focused suite.',
			providers,
			'codex',
			new Date('2026-09-04T12:00:00Z'),
		);
		const model = createDashboardModel({
			repositoryName: 'Custom Benchmark',
			mode: 'capturing',
			eventCount: 4,
			providers,
		});
		const webview = { cspSource: 'https://webview.test' } as vscode.Webview;
		const html = renderDashboard(
			webview,
			model,
			vscode.Uri.parse('https://webview.test/icon.png'),
			{},
			recommendation,
			true,
			true,
		);

		assert.ok(html.includes('POST-SUBMIT ANALYSIS'));
		assert.ok(html.includes('From Codex'));
		assert.ok(html.includes('data-recommendation-field="harness"'));
		assert.ok(html.includes('HARNESS · Codex'));
		assert.ok(html.includes('data-recommendation-field="model"'));
		assert.ok(html.includes('GPT-6 Astra'));
		assert.ok(html.includes('Max reasoning'));
		assert.ok(html.includes('data-recommendation-field="basis"'));
		assert.ok(html.includes('MODEL · AA HEURISTIC'));
		assert.ok(html.includes('Registered Personal Benchmark results are still being generated'));
		assert.ok(html.includes('A TECHTORCH INITIATIVE'));
		assert.ok(html.includes('BRUNO MANZANO · TECHTORCH'));
		assert.ok(!html.includes('KAIROS'));
		assert.ok(html.includes('@media (max-height: 680px)'));
		assert.ok(html.includes('section--review'));
	});

	test('renders a prompt composer before any task is sent', () => {
		const providers = [
			{ id: 'copilot' as const, name: 'GitHub Copilot', installed: true },
			{ id: 'claude' as const, name: 'Claude Code', installed: true },
			{ id: 'codex' as const, name: 'OpenAI Codex', installed: true },
		];
		const model = createDashboardModel({
			repositoryName: 'Custom Benchmark',
			mode: 'capturing',
			eventCount: 1,
			providers,
		});
		const html = renderDashboard(
			{ cspSource: 'https://webview.test' } as vscode.Webview,
			model,
			vscode.Uri.parse('https://webview.test/icon.png'),
			{},
			undefined,
			false,
			true,
		);

		assert.ok(html.includes('BEFORE YOU SEND'));
		assert.ok(html.includes('data-draft-input'));
		assert.ok(html.includes('Recommend before sending'));
		assert.ok(html.includes("command: 'analyzePrompt', prompt"));
	});

	test('offers a non-submitting handoff for a preflight recommendation', () => {
		const providers = [
			{ id: 'copilot' as const, name: 'GitHub Copilot', installed: true },
			{ id: 'claude' as const, name: 'Claude Code', installed: true },
			{ id: 'codex' as const, name: 'OpenAI Codex', installed: true },
		];
		const recommendation = recommendModel(
			'Fix the failing authentication tests and run the focused suite.',
			providers,
			'manual',
		);
		const model = createDashboardModel({
			repositoryName: 'Custom Benchmark',
			mode: 'capturing',
			eventCount: 1,
			providers,
		});
		const html = renderDashboard(
			{ cspSource: 'https://webview.test' } as vscode.Webview,
			model,
			vscode.Uri.parse('https://webview.test/icon.png'),
			{},
			recommendation,
			false,
			true,
			true,
		);

		assert.ok(html.includes('READY TO ROUTE'));
		assert.ok(html.includes('Copy &amp; open Codex'));
		assert.ok(html.includes('data-command="openRecommendedHarness"'));
	});

	test('renders the Claude provider with an inline Iconify logo', () => {
		const providers = [
			{ id: 'copilot' as const, name: 'GitHub Copilot', installed: true },
			{ id: 'claude' as const, name: 'Claude Code', installed: true },
			{ id: 'codex' as const, name: 'OpenAI Codex', installed: true },
		];
		const model = createDashboardModel({
			repositoryName: 'Custom Benchmark',
			mode: 'capturing',
			eventCount: 1,
			providers,
		});
		const webview = { cspSource: 'https://webview.test' } as vscode.Webview;
		const claudeIconUri = vscode.Uri.parse('https://webview.test/broken-claude.png');
		const html = renderDashboard(
			webview,
			model,
			vscode.Uri.parse('https://webview.test/icon.png'),
			{ claude: claudeIconUri },
			undefined,
			false,
			true,
		);

		assert.ok(html.includes('data-provider-icon="claude"'));
		assert.ok(html.includes('<svg'));
		assert.ok(!html.includes(claudeIconUri.toString()));
	});

	test('surfaces captured events in the review queue', () => {
		const providers = [
			{ id: 'copilot' as const, name: 'GitHub Copilot', installed: true },
			{ id: 'claude' as const, name: 'Claude Code', installed: true },
			{ id: 'codex' as const, name: 'OpenAI Codex', installed: true },
		];
		const render = (eventCount: number): string => renderDashboard(
			{ cspSource: 'https://webview.test' } as vscode.Webview,
			createDashboardModel({
				repositoryName: 'Custom Benchmark',
				mode: 'capturing',
				eventCount,
				providers,
			}),
			vscode.Uri.parse('https://webview.test/icon.png'),
			{},
			undefined,
			false,
			true,
		);

		const populated = render(22);
		assert.ok(populated.includes('22 captured'));
		assert.ok(populated.includes('Review captured activity'));
		assert.ok(!populated.includes('No candidates yet'));

		const empty = render(0);
		assert.ok(empty.includes('No candidates yet'));
		assert.ok(empty.includes('0 pending'));
	});
});

suite('Captured event ledger', () => {
	test('reads the newest events first and survives a torn line', () => {
		const log = [
			JSON.stringify({ schemaVersion: 1, eventId: 'a', occurredAt: '2026-09-06T10:00:00.000Z', kind: 'repository.enabled' }),
			'{"schemaVersion":1,"eventId":"b","occurred',
			JSON.stringify({ schemaVersion: 1, eventId: 'c', occurredAt: '2026-09-06T12:00:00.000Z', kind: 'prompt.recommended' }),
			'',
		].join('\n');

		const events = parseEventLog(log);

		assert.strictEqual(events.length, 2);
		assert.strictEqual(events[0].eventId, 'c');
		assert.strictEqual(events[1].eventId, 'a');
	});

	test('describes recommendations and pipeline checks for review', () => {
		assert.strictEqual(describeEventKind('prompt.recommended'), 'Prompt recommendation');
		assert.strictEqual(describeEventKind('unknown.kind'), 'unknown.kind');

		assert.strictEqual(
			describeEventPayload({
				schemaVersion: 1,
				eventId: 'a',
				occurredAt: '2026-09-06T12:00:00.000Z',
				kind: 'prompt.recommended',
				payload: {
					modelLabel: 'GPT-6 Astra',
					profileLabel: 'Max reasoning',
					taskType: 'Debugging',
					source: 'codex',
					confidence: 0.81,
				},
			}),
			'GPT-6 Astra · Max reasoning · Debugging · codex',
		);

		assert.strictEqual(
			describeEventPayload({
				schemaVersion: 1,
				eventId: 'b',
				occurredAt: '2026-09-06T12:00:00.000Z',
				kind: 'preview.event-recorded',
				payload: { message: 'Local pipeline check' },
			}),
			'Local pipeline check',
		);
	});
});
