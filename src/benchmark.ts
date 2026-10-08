import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ModelTaskType } from './modelCatalog';
import { RegisteredModelPerformance } from './modelSelection';
import { redactSecrets } from './redaction';

export const TASK_TYPES: readonly ModelTaskType[] = ['Architecture', 'Debugging', 'Implementation', 'Review', 'Research', 'Quick task'];
export type CheckKind = 'contains' | 'excludes' | 'exact' | 'json';
export interface BenchmarkCheck { kind: CheckKind; expected: string; }
export interface BenchmarkCase {
	id: string;
	fingerprint: string;
	title: string;
	taskType: ModelTaskType;
	prompt: string;
	checks: BenchmarkCheck[];
	createdAt: string;
	synthetic?: boolean;
}
export interface BenchmarkModel { id: string; name: string; vendor: string; version: string; }
export interface BenchmarkResult {
	caseId: string;
	fingerprint: string;
	taskType: ModelTaskType;
	model: BenchmarkModel;
	status: 'scored' | 'error' | 'cancelled';
	score: number;
	passed: boolean[];
	output: string;
	outputTruncated?: boolean;
	durationMs: number;
	error?: string;
}
export interface BenchmarkRun {
	id: string;
	startedAt: string;
	finishedAt?: string;
	status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
	demo: boolean;
	cases: BenchmarkCase[];
	models: BenchmarkModel[];
	results: BenchmarkResult[];
}
export interface BenchmarkData { schemaVersion: 1; cases: BenchmarkCase[]; runs: BenchmarkRun[]; }
export type BenchmarkExecutor = (model: BenchmarkModel, prompt: string, signal: AbortSignal) => Promise<string>;
export const emptyBenchmark = (): BenchmarkData => ({ schemaVersion: 1, cases: [], runs: [] });

const TITLE_LIMIT = 120;
const PROMPT_LIMIT = 20_000;
const EXPECTED_LIMIT = 2_000;
type CaseFields = Pick<BenchmarkCase, 'title' | 'taskType' | 'prompt' | 'checks'>;

export function createBenchmarkCase(input: unknown): BenchmarkCase {
	const raw = parseCaseFields(input, (text) => text);
	const fields = parseCaseFields(input, (text) => redactSecrets(text).value);
	// Redaction can lengthen text (TOKEN=ab becomes TOKEN=[REDACTED]), so the stored form must fit too.
	for (const candidate of [raw, fields]) {
		if (candidate.title.length > TITLE_LIMIT || candidate.prompt.length > PROMPT_LIMIT) {
			throw new Error('Provide a title (up to 120 characters), prompt (up to 20,000), task type and 1–20 checks. Redacted secrets count toward these limits.');
		}
		if (candidate.checks.some((check) => check.expected.length > EXPECTED_LIMIT)) {
			throw new Error('Each check needs a supported kind and non-empty expected text (up to 2,000 characters). Redacted secrets count toward this limit.');
		}
	}
	return { id: randomUUID(), fingerprint: caseFingerprint(fields), ...fields, createdAt: new Date().toISOString() };
}

function parseCaseFields(input: unknown, transform: (text: string) => string): CaseFields {
	if (!isRecord(input) || typeof input.title !== 'string' || !input.title.trim()
		|| typeof input.prompt !== 'string' || !input.prompt.trim()
		|| !TASK_TYPES.includes(input.taskType as ModelTaskType)
		|| !Array.isArray(input.checks) || input.checks.length < 1 || input.checks.length > 20) {
		throw new Error('Provide a title (up to 120 characters), prompt (up to 20,000), task type and 1–20 checks.');
	}
	const checks: BenchmarkCheck[] = input.checks.map((check: unknown) => {
		if (!isRecord(check) || !['contains', 'excludes', 'exact', 'json'].includes(String(check.kind))
			|| typeof check.expected !== 'string'
			|| (check.kind !== 'json' && !check.expected.trim())) {
			throw new Error('Each check needs a supported kind and non-empty expected text (up to 2,000 characters).');
		}
		return { kind: check.kind as CheckKind, expected: check.kind === 'json' ? '' : transform(check.expected) };
	});
	return { title: transform(input.title.trim()), taskType: input.taskType as ModelTaskType, prompt: transform(input.prompt), checks };
}

function caseFingerprint({ prompt, taskType, checks }: CaseFields): string {
	return createHash('sha256').update(JSON.stringify({ prompt: prompt.trim(), taskType, checks })).digest('hex');
}

/** Adds a case, or replaces the case with `caseId`. An edited demo case stops being synthetic once its content changes. */
export function upsertBenchmarkCase(data: BenchmarkData, item: BenchmarkCase, caseId?: unknown): void {
	const index = typeof caseId === 'string' ? data.cases.findIndex((candidate) => candidate.id === caseId) : -1;
	if (data.cases.some((candidate, i) => i !== index && candidate.fingerprint === item.fingerprint)) { throw new Error('This prompt and checks are already in your corpus.'); }
	if (index >= 0) {
		const previous = data.cases[index];
		data.cases[index] = { ...item, id: previous.id, ...(previous.synthetic && previous.fingerprint === item.fingerprint ? { synthetic: true } : {}) };
		return;
	}
	if (data.cases.length >= 100) { throw new Error('This corpus already contains 100 cases.'); }
	data.cases.push(item);
}

export function scoreAnswer(output: string, checks: readonly BenchmarkCheck[]): { score: number; passed: boolean[] } {
	if (checks.length === 0) { throw new Error('A benchmark needs at least one check.'); }
	const passed = checks.map((check) => {
		switch (check.kind) {
			case 'contains': return output.toLowerCase().includes(check.expected.toLowerCase());
			case 'excludes': return !output.toLowerCase().includes(check.expected.toLowerCase());
			case 'exact': return output.trim() === check.expected.trim();
			case 'json':
				try { JSON.parse(output.trim()); return true; } catch { return false; }
		}
	});
	return { score: Math.round(100 * passed.filter(Boolean).length / passed.length), passed };
}

export async function executeBenchmark(
	cases: readonly BenchmarkCase[], models: readonly BenchmarkModel[], execute: BenchmarkExecutor,
	options: { signal: AbortSignal; demo?: boolean; timeoutMs?: number; onProgress?: (run: BenchmarkRun) => Promise<void> },
): Promise<BenchmarkRun> {
	if (!cases.length || !models.length || cases.length > 100 || models.length > 5) {
		throw new Error('Select 1–100 cases and 1–5 models.');
	}
	const run: BenchmarkRun = { id: randomUUID(), startedAt: new Date().toISOString(), status: 'running', demo: options.demo ?? false, cases: structuredClone([...cases]), models: structuredClone([...models]), results: [] };
	await options.onProgress?.(structuredClone(run));
	for (const benchmarkCase of run.cases) {
		for (const model of run.models) {
			if (options.signal.aborted) { break; }
			const started = Date.now();
			const controller = new AbortController();
			const abort = (): void => controller.abort();
			options.signal.addEventListener('abort', abort, { once: true });
			let timedOut = false;
			const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 60_000);
			let onAbort: (() => void) | undefined;
			try {
				const cancelled = new Promise<never>((_, reject) => {
					onAbort = () => reject(new Error(timedOut ? 'Model request timed out.' : 'Run cancelled.'));
					controller.signal.addEventListener('abort', onAbort, { once: true });
				});
				const output = await Promise.race([execute(model, benchmarkCase.prompt, controller.signal), cancelled]);
				if (output.length > 64_000) { throw new Error('Model output exceeded the 64,000 character limit.'); }
				run.results.push({ caseId: benchmarkCase.id, fingerprint: benchmarkCase.fingerprint, taskType: benchmarkCase.taskType, model, status: 'scored', ...scoreAnswer(output, benchmarkCase.checks), output: redactSecrets(output).value.slice(0, 8_000), outputTruncated: output.length > 8_000, durationMs: Date.now() - started });
			} catch (error) {
				run.results.push({ caseId: benchmarkCase.id, fingerprint: benchmarkCase.fingerprint, taskType: benchmarkCase.taskType, model, status: options.signal.aborted ? 'cancelled' : 'error', score: 0, passed: [], output: '', durationMs: Date.now() - started, error: redactSecrets(error instanceof Error ? error.message : String(error)).value.slice(0, 500) });
			} finally {
				clearTimeout(timer);
				options.signal.removeEventListener('abort', abort);
				if (onAbort) { controller.signal.removeEventListener('abort', onAbort); }
				controller.abort();
			}
			await options.onProgress?.(structuredClone(run));
		}
		if (options.signal.aborted) { break; }
	}
	run.status = options.signal.aborted ? 'cancelled' : run.results.some((result) => result.status === 'error') ? 'failed' : 'completed';
	run.finishedAt = new Date().toISOString();
	await options.onProgress?.(structuredClone(run));
	return run;
}

/** Latest complete, non-demo comparison per task; every model sees the same distinct cases. */
export function registeredBenchmarkPerformance(data: BenchmarkData): RegisteredModelPerformance[] {
	const performance: RegisteredModelPerformance[] = [];
	const covered = new Set<ModelTaskType>();
	const current = new Set(data.cases.filter((item) => !item.synthetic).map((item) => item.fingerprint));
	for (const run of [...data.runs].reverse()) {
		if (run.demo || run.status !== 'completed') { continue; }
		for (const taskType of TASK_TYPES) {
			if (covered.has(taskType)) { continue; }
			const distinct = new Map<string, string>();
			for (const item of run.cases) {
				if (item.taskType === taskType && current.has(item.fingerprint)) { distinct.set(item.prompt.replace(/\s+/g, ' ').trim(), item.fingerprint); }
			}
			const cases = [...distinct.values()];
			if (cases.length < 3) { continue; }
			const rows = run.models.map((model) => ({ model, results: cases.map((fingerprint) => run.results.find((result) => result.fingerprint === fingerprint && modelKey(result.model) === modelKey(model) && result.status === 'scored')) }));
			if (rows.every((row) => /^auto$/i.test(row.model.name)) || rows.some((row) => row.results.some((result) => !result))) { continue; }
			for (const { model, results } of rows) {
				if (/^auto$/i.test(model.name)) { continue; }
				performance.push({ modelProfileId: modelKey(model), modelLabel: model.name, profileLabel: `${model.vendor} · provider defaults`, taskType, sampleSize: cases.length, score: results.reduce((sum, result) => sum + result!.score, 0) / cases.length });
			}
			covered.add(taskType);
		}
	}
	return performance;
}

export function modelKey(model: BenchmarkModel): string { return `vscode:${[model.vendor, model.id, model.version].map(encodeURIComponent).join(':')}`; }

export class BenchmarkRepository {
	private queue: Promise<void> = Promise.resolve();
	constructor(private readonly filePath: string) {}
	async read(): Promise<BenchmarkData> {
		try {
			const parsed: unknown = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
			if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.cases) || !Array.isArray(parsed.runs)) { throw new Error('Invalid benchmark data.'); }
			// Validate saved cases before they can be sent to a model.
			for (const item of parsed.cases) { validateSavedCase(item); }
			for (const run of parsed.runs) {
				if (!isRecord(run) || typeof run.id !== 'string' || typeof run.demo !== 'boolean'
					|| !['running', 'completed', 'failed', 'cancelled', 'interrupted'].includes(String(run.status))
					|| typeof run.startedAt !== 'string' || !Array.isArray(run.cases) || !Array.isArray(run.models) || !Array.isArray(run.results)) {
					throw new Error('Invalid saved benchmark run.');
				}
				for (const item of run.cases) { validateSavedCase(item); }
				for (const model of run.models) { validateModel(model); }
				for (const result of run.results) {
					if (!isRecord(result) || typeof result.caseId !== 'string' || typeof result.fingerprint !== 'string'
						|| !TASK_TYPES.includes(result.taskType as ModelTaskType) || !['scored', 'error', 'cancelled'].includes(String(result.status))
						|| typeof result.score !== 'number' || !Number.isFinite(result.score) || result.score < 0 || result.score > 100
						|| typeof result.output !== 'string' || typeof result.durationMs !== 'number' || !Array.isArray(result.passed)
						|| !result.passed.every((passed) => typeof passed === 'boolean')) { throw new Error('Invalid saved benchmark result.'); }
					validateModel(result.model);
				}
			}
			return parsed as unknown as BenchmarkData;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return emptyBenchmark(); }
			throw new Error(`Could not read benchmark data: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	update(change: (data: BenchmarkData) => void): Promise<BenchmarkData> {
		const operation = this.queue.then(async () => {
			const data = await this.read();
			change(data);
			data.runs = data.runs.slice(-50);
			let serialized = JSON.stringify(data, null, 2);
			while (data.runs.length > 1 && Buffer.byteLength(serialized) > 16 * 1024 * 1024) { data.runs.shift(); serialized = JSON.stringify(data, null, 2); }
			await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
			const temporary = `${this.filePath}.${randomUUID()}.tmp`;
			try {
				await fs.writeFile(temporary, serialized, { mode: 0o600, flag: 'wx' });
				await fs.rename(temporary, this.filePath);
			} finally { await fs.rm(temporary, { force: true }); }
			return data;
		});
		this.queue = operation.then(() => {}, () => {});
		return operation;
	}
}

export function demoCases(): BenchmarkCase[] {
	return [
		{ title: 'Stable sort', prompt: 'Explain why a stable sort preserves the order of equal elements.', expected: 'equal' },
		{ title: 'Missing await', prompt: 'Explain why a missing await can cause a test to pass before an assertion runs.', expected: 'await' },
		{ title: 'Empty input', prompt: 'Explain why a parser should handle empty input explicitly.', expected: 'empty' },
	].map((item) => ({ ...createBenchmarkCase({ ...item, taskType: 'Debugging', checks: [{ kind: 'contains', expected: item.expected }] }), synthetic: true }));
}
export const DEMO_MODELS: BenchmarkModel[] = [
	{ id: 'demo-careful', name: 'Demo · careful', vendor: 'synthetic', version: '1' },
	{ id: 'demo-terse', name: 'Demo · terse', vendor: 'synthetic', version: '1' },
];
export const demoExecutor: BenchmarkExecutor = async (model, prompt) => model.id === 'demo-careful' ? `Consider equal elements, await and empty input. ${prompt}` : 'Check the implementation.';
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

function validateModel(value: unknown): void {
	if (!isRecord(value) || !['id', 'name', 'vendor', 'version'].every((key) => typeof value[key] === 'string')) {
		throw new Error('Invalid saved model identity.');
	}
}

/**
 * Saved cases were redacted and length-checked when created. Re-running redaction or the limits here
 * would let a future redaction rule, or redaction growth, make the whole file unreadable.
 */
function validateSavedCase(value: unknown): void {
	const fields = parseCaseFields(value, (text) => text);
	if (!isRecord(value) || typeof value.id !== 'string' || !value.id
		|| value.fingerprint !== caseFingerprint(fields) || typeof value.createdAt !== 'string'
		|| Number.isNaN(Date.parse(value.createdAt))) { throw new Error('Invalid saved case identity or fingerprint.'); }
}

export function selectBenchmarkModels<T extends BenchmarkModel>(models: readonly T[], selectedKeys: readonly unknown[]): T[] {
	return [...new Map(models.filter((model) => selectedKeys.includes(modelKey(model))).map((model) => [modelKey(model), model])).values()];
}
