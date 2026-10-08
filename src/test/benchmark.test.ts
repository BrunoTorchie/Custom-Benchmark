import * as assert from 'node:assert';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Script } from 'node:vm';
import * as vscode from 'vscode';
import { BenchmarkRepository, DEMO_MODELS, createBenchmarkCase, demoCases, demoExecutor, emptyBenchmark, executeBenchmark, registeredBenchmarkPerformance, upsertBenchmarkCase, modelKey, selectBenchmarkModels, scoreAnswer } from '../benchmark';
import { describeModel, languageModelExecutor, renderBenchmarkWorkbench } from '../benchmarkPanel';
import { recommendModel } from '../recommendation';

suite('Scored benchmark execution', () => {
	const models = [{ id: 'local-a', name: 'Local A', vendor: 'test', version: '1' }, { id: 'local-b', name: 'Local B', vendor: 'test', version: '1' }];
	const cases = () => [1, 2, 3].map((i) => createBenchmarkCase({ title: `Debug ${i}`, taskType: 'Debugging', prompt: `Explain test failure ${i}`, checks: [{ kind: 'contains', expected: 'await' }, { kind: 'excludes', expected: 'ignore tests' }] }));
	test('selects exactly one endpoint when providers reuse the same model ID', () => {
		const providers = [{ ...models[0], id: 'auto', vendor: 'copilot' }, { ...models[0], id: 'auto', vendor: 'copilotcli' }];
		assert.deepStrictEqual(selectBenchmarkModels(providers, [modelKey(providers[0])]), [providers[0]]);
		assert.deepStrictEqual(selectBenchmarkModels(providers, ['auto']), []);
	});

	test('scores all supported checks with defined case and whitespace semantics', () => {
		assert.deepStrictEqual(scoreAnswer('  Hello WORLD  ', [{ kind: 'contains', expected: 'world' }, { kind: 'excludes', expected: 'unsafe' }, { kind: 'exact', expected: 'Hello WORLD' }, { kind: 'json', expected: '' }]), { score: 75, passed: [true, true, true, false] });
		assert.strictEqual(scoreAnswer('{"ok":true}', [{ kind: 'json', expected: '' }]).score, 100);
		assert.throws(() => scoreAnswer('', []));
	});
	test('validates and redacts cases; titles cannot manufacture distinct samples', () => {
		assert.throws(() => createBenchmarkCase({}));
		const first = createBenchmarkCase({ title: 'First', taskType: 'Debugging', prompt: 'Fix PASSWORD="synthetic secret"', checks: [{ kind: 'contains', expected: 'fixed' }] });
		const second = createBenchmarkCase({ ...first, title: 'Renamed' });
		assert.ok(!first.prompt.includes('synthetic secret'));
		assert.strictEqual(first.fingerprint, second.fingerprint);
		assert.notStrictEqual(first.id, second.id);
	});
	test('executes a fair comparison, records checks and uses real evidence for recommendations', async () => {
		const corpus = cases();
		const run = await executeBenchmark(corpus, models, async (model) => model.id === 'local-a' ? 'Use await' : 'Ignore tests', { signal: new AbortController().signal });
		assert.strictEqual(run.status, 'completed');
		assert.strictEqual(run.results.length, 6);
		assert.deepStrictEqual(run.results.map((result) => result.score), [100, 0, 100, 0, 100, 0]);
		const data = { ...emptyBenchmark(), cases: corpus, runs: [run] };
		const performance = registeredBenchmarkPerformance(data);
		assert.strictEqual(performance.length, 2);
		const recommended = recommendModel('Debug the failing tests', [{ id: 'copilot', name: 'GitHub Copilot', installed: true }], 'manual', new Date(), performance);
		assert.strictEqual(recommended.modelSelectionBasis, 'registered-benchmark');
		assert.strictEqual(recommended.modelLabel, 'Local A');
	});
	test('excludes demo, synthetic cases, failures, cancelled runs and repeated cases', async () => {
		const corpus = cases();
		const run = await executeBenchmark(corpus, models, async () => 'await', { signal: new AbortController().signal });
		for (const status of ['cancelled', 'failed', 'interrupted', 'running'] as const) {
			assert.deepStrictEqual(registeredBenchmarkPerformance({ ...emptyBenchmark(), cases: corpus, runs: [{ ...run, status }] }), []);
		}
		assert.deepStrictEqual(registeredBenchmarkPerformance({ ...emptyBenchmark(), cases: corpus, runs: [{ ...run, demo: true }] }), []);
		assert.deepStrictEqual(registeredBenchmarkPerformance({ ...emptyBenchmark(), cases: corpus.map((item) => ({ ...item, synthetic: true })), runs: [run] }), []);
		const repeated = await executeBenchmark([corpus[0], corpus[0], corpus[0]], models, async () => 'await', { signal: new AbortController().signal });
		assert.deepStrictEqual(registeredBenchmarkPerformance({ ...emptyBenchmark(), cases: corpus, runs: [repeated] }), []);
	});
	test('different rubrics for the same prompt and Auto routing do not create model evidence', async () => {
		const corpus = [1, 2, 3].map((i) => createBenchmarkCase({ title: `Rubric ${i}`, taskType: 'Debugging', prompt: 'One repeated prompt', checks: [{ kind: 'contains', expected: String(i) }] }));
		const run = await executeBenchmark(corpus, models, async () => '1 2 3', { signal: new AbortController().signal });
		assert.deepStrictEqual(registeredBenchmarkPerformance({ ...emptyBenchmark(), cases: corpus, runs: [run] }), []);
		const distinct = cases();
		const autoRun = await executeBenchmark(distinct, [{ ...models[0], name: 'Auto' }], async () => 'await', { signal: new AbortController().signal });
		assert.deepStrictEqual(registeredBenchmarkPerformance({ ...emptyBenchmark(), cases: distinct, runs: [autoRun] }), []);
	});

	test('case edits and removals invalidate stale evidence', async () => {
		const corpus = cases();
		const run = await executeBenchmark(corpus, models, async () => 'await', { signal: new AbortController().signal });
		assert.strictEqual(registeredBenchmarkPerformance({ ...emptyBenchmark(), cases: corpus, runs: [run] }).length, 2);
		assert.deepStrictEqual(registeredBenchmarkPerformance({ ...emptyBenchmark(), cases: corpus.slice(1), runs: [run] }), []);
		const edited = { ...emptyBenchmark(), cases: structuredClone(corpus), runs: [run] };
		upsertBenchmarkCase(edited, createBenchmarkCase({ ...corpus[0], prompt: 'Explain a different failure' }), corpus[0].id);
		assert.strictEqual(edited.cases[0].id, corpus[0].id);
		assert.deepStrictEqual(registeredBenchmarkPerformance(edited), []);
	});
	test('editing a demo case makes it real only when its content changes', () => {
		const data = { ...emptyBenchmark(), cases: demoCases() };
		const [demo] = data.cases;
		upsertBenchmarkCase(data, createBenchmarkCase({ ...demo, title: 'Renamed demo' }), demo.id);
		assert.strictEqual(data.cases[0].synthetic, true);
		upsertBenchmarkCase(data, createBenchmarkCase({ ...demo, prompt: 'Explain a real regression in our parser.' }), demo.id);
		assert.strictEqual(data.cases[0].synthetic, undefined);
		assert.throws(() => upsertBenchmarkCase(data, createBenchmarkCase(data.cases[1])), /already in your corpus/);
	});
	test('limits apply after redaction, and saved cases are never re-redacted on load', async () => {
		const growing = `${'x'.repeat(111)} TOKEN=ab`;
		assert.strictEqual(growing.length, 120, 'Fits the limit before redaction');
		assert.throws(() => createBenchmarkCase({ title: growing, taskType: 'Debugging', prompt: 'Fix it', checks: [{ kind: 'contains', expected: 'fixed' }] }), /Redacted secrets count/);
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-legacy-'));
		try {
			const file = path.join(directory, 'benchmark.json');
			// A case written before this fix (title grew past 120) and one a future redaction rule would change.
			const legacy = { ...createBenchmarkCase({ title: 'Legacy', taskType: 'Debugging', prompt: 'Fix it', checks: [{ kind: 'contains', expected: 'fixed' }] }), title: 'y'.repeat(128) };
			const rawPrompt = 'Rotate PASSWORD="kept-by-an-older-rule-set"';
			const checks = [{ kind: 'contains', expected: 'rotated' }];
			const futureRule = { id: 'future', fingerprint: createHash('sha256').update(JSON.stringify({ prompt: rawPrompt, taskType: 'Debugging', checks })).digest('hex'), title: 'Future rule', taskType: 'Debugging', prompt: rawPrompt, checks, createdAt: new Date().toISOString() };
			await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, cases: [legacy, futureRule], runs: [] }));
			const data = await new BenchmarkRepository(file).read();
			assert.deepStrictEqual(data.cases.map((item) => item.prompt), ['Fix it', rawPrompt]);
		} finally { await fs.rm(directory, { recursive: true, force: true }); }
	});
	test('times out an unresponsive model, persists the error, and continues', async () => {
		const run = await executeBenchmark(cases().slice(0, 1), models, async (model) => model.id === 'local-a' ? new Promise<string>(() => {}) : 'await', { timeoutMs: 10, signal: new AbortController().signal });
		assert.strictEqual(run.status, 'failed');
		assert.match(run.results[0].error ?? '', /timed out/);
		assert.strictEqual(run.results[1].score, 100);
	});
	test('cancels during a pending request without executing later cells', async () => {
		const controller = new AbortController();
		let calls = 0;
		const run = await executeBenchmark(cases(), models, async () => { calls++; controller.abort(); return new Promise<string>(() => {}); }, { signal: controller.signal });
		assert.strictEqual(run.status, 'cancelled');
		assert.strictEqual(calls, 1);
		assert.strictEqual(run.results[0].status, 'cancelled');
	});
	test('supports a pre-cancelled run and rejects empty plans', async () => {
		const controller = new AbortController(); controller.abort();
		const run = await executeBenchmark(cases(), models, async () => { throw new Error('Must not execute'); }, { signal: controller.signal });
		assert.strictEqual(run.status, 'cancelled');
		assert.strictEqual(run.results.length, 0);
		await assert.rejects(executeBenchmark([], models, demoExecutor, { signal: controller.signal }));
	});
	test('redacts output and errors and enforces an output limit', async () => {
		const run = await executeBenchmark(cases(), [models[0]], async (_, prompt) => {
			if (prompt.endsWith('1')) { return 'await PASSWORD="synthetic secret"'; }
			if (prompt.endsWith('2')) { throw new Error('TOKEN=synthetic-error-secret'); }
			return 'x'.repeat(64_001);
		}, { signal: new AbortController().signal });
		assert.ok(!JSON.stringify(run).includes('synthetic secret'));
		assert.ok(!JSON.stringify(run).includes('synthetic-error-secret'));
		assert.strictEqual(run.results[2].status, 'error');
	});
	test('completes the maximum 500-cell plan with durable progress snapshots', async () => {
		const corpus = Array.from({ length: 100 }, (_, i) => createBenchmarkCase({ title: `Case ${i}`, taskType: 'Debugging', prompt: `Fix ${i}`, checks: [{ kind: 'exact', expected: 'ok' }] }));
		const comparison = Array.from({ length: 5 }, (_, i) => ({ ...models[0], id: `model-${i}` }));
		let progress = 0;
		const run = await executeBenchmark(corpus, comparison, async () => 'ok', { signal: new AbortController().signal, onProgress: async (snapshot) => { progress++; if (snapshot.results.length) { snapshot.results[0].score = -1; } } });
		assert.strictEqual(run.results.length, 500);
		assert.strictEqual(progress, 502);
		assert.ok(run.results.every((result) => result.score === 100));
	});
	test('demo exercises the same scoring pipeline without registering performance', async () => {
		const corpus = demoCases();
		const run = await executeBenchmark(corpus, DEMO_MODELS, demoExecutor, { demo: true, signal: new AbortController().signal });
		assert.deepStrictEqual(run.results.map((item) => item.score), [100, 0, 100, 0, 100, 0]);
		assert.deepStrictEqual(registeredBenchmarkPerformance({ ...emptyBenchmark(), cases: corpus, runs: [run] }), []);
	});
	test('writes private atomic files, serializes updates, survives reload and reports corruption', async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-score-'));
		const file = path.join(directory, 'benchmark.json');
		try {
			const repository = new BenchmarkRepository(file);
			await Promise.all(cases().map((item) => repository.update((data) => data.cases.push(item))));
			assert.strictEqual((await new BenchmarkRepository(file).read()).cases.length, 3);
			if (process.platform !== 'win32') { assert.strictEqual((await fs.stat(file)).mode & 0o777, 0o600); }
			assert.deepStrictEqual(await fs.readdir(directory), ['benchmark.json']);
			await fs.writeFile(file, '{broken');
			await assert.rejects(repository.read(), /Could not read benchmark data/);
			await assert.rejects(repository.update(() => {}));
			assert.strictEqual(await fs.readFile(file, 'utf8'), '{broken');
		} finally { await fs.rm(directory, { recursive: true, force: true }); }
	});
	test('renders a CSP-locked workbench with syntactically valid script and escaped drafts', () => {
		const html = renderBenchmarkWorkbench({ cspSource: 'https://test.local' }, '<script>repo</script>', '</textarea><script>alert(1)</script>');
		assert.ok(!html.includes('<script>alert(1)</script>'));
		assert.ok(!html.includes('<script>repo</script>'));
		assert.ok(html.includes('&lt;script&gt;repo&lt;/script&gt;'));
		const nonce = html.match(/script-src 'nonce-([^']+)'/)?.[1];
		assert.ok(nonce && html.includes("default-src 'none'"), 'The workbench must declare a nonce-based CSP');
		assert.deepStrictEqual([...html.matchAll(/<script nonce="([^"]+)">/g)].map((match) => match[1]), [nonce]);
		assert.ok(html.includes('Review &amp; run'));
		assert.ok(html.includes('Run demo benchmark'));
		const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
		assert.ok(script); assert.doesNotThrow(() => new Script(script));
	});
	test('real Language Model API adapter sends only the prompt and consumes streamed answers', async () => {
		const model = {
			id: 'test-stream', name: 'Stream', vendor: 'test', version: '1', maxInputTokens: 100,
			countTokens: async () => 3,
			sendRequest: async (messages: vscode.LanguageModelChatMessage[], _options: unknown, token: vscode.CancellationToken) => {
				assert.strictEqual(messages.length, 1);
				assert.strictEqual((messages[0].content[0] as vscode.LanguageModelTextPart).value, 'Only this prompt');
				assert.ok(!token.isCancellationRequested);
				return { text: (async function* () { yield 'hello '; yield 'world'; })() };
			},
		} as unknown as vscode.LanguageModelChat;
		assert.strictEqual(await languageModelExecutor([model])(describeModel(model), 'Only this prompt', new AbortController().signal), 'hello world');
	});
});
