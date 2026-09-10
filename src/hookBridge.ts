import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	PromptBridgeConfiguration,
	PromptHookAdapter,
	PromptInboxItem,
	isPathInsideRoot,
	normalizePromptHookInput,
} from './promptFeedProtocol';
import { recommendModel } from './recommendation';
import { redactSecrets } from './redaction';

const MAX_INPUT_BYTES = 1_000_000;
const MAX_PROMPT_CHARACTERS = 100_000;

let input = '';
let inputBytes = 0;
let inputTooLarge = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
	inputBytes += Buffer.byteLength(chunk, 'utf8');
	if (inputBytes > MAX_INPUT_BYTES) {
		input = '';
		inputTooLarge = true;
		return;
	}
	if (!inputTooLarge) {
		input += chunk;
	}
});
process.stdin.on('end', () => {
	try {
		if (!inputTooLarge) {
			ingest(input);
		}
	} catch {
		// Capture must never interrupt the agent that emitted the hook.
	}
});
process.stdin.resume();

function ingest(rawInput: string): void {
	if (rawInput.length === 0 || Buffer.byteLength(rawInput, 'utf8') > MAX_INPUT_BYTES) {
		return;
	}

	const configPath = process.argv[2];
	const adapter = parseAdapter(process.argv[3]);
	if (!configPath) {
		return;
	}

	const configuration = parseConfiguration(fs.readFileSync(configPath, 'utf8'));
	const normalized = normalizePromptHookInput(JSON.parse(rawInput) as unknown, adapter);
	if (!normalized || normalized.prompt.length > MAX_PROMPT_CHARACTERS) {
		return;
	}

	const canonicalCwd = canonicalPath(normalized.cwd);
	const allowed = configuration.enabledRoots.some((root) => (
		isPathInsideRoot(canonicalCwd, canonicalPath(root))
	));
	if (!allowed) {
		return;
	}

	const replacementCount = redactSecrets(normalized.prompt).replacementCount;
	const receivedAt = new Date();
	const item: PromptInboxItem = {
		cwd: canonicalCwd,
		source: normalized.source,
		schemaVersion: 1,
		id: randomUUID(),
		receivedAt: receivedAt.toISOString(),
		replacementCount,
		recommendation: recommendModel(
			normalized.prompt,
			configuration.providers,
			normalized.source,
			receivedAt,
		),
	};
	const content = `${JSON.stringify(item)}\n`;
	const fileName = `${Date.now()}-${createHash('sha256').update(item.id).digest('hex').slice(0, 12)}.json`;
	const finalPath = path.join(configuration.inboxDirectory, fileName);
	const temporaryPath = `${finalPath}.tmp`;

	fs.mkdirSync(configuration.inboxDirectory, { recursive: true, mode: 0o700 });
	tryChmod(configuration.inboxDirectory, 0o700);
	fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
	tryChmod(temporaryPath, 0o600);
	fs.renameSync(temporaryPath, finalPath);
}

function parseAdapter(value: string | undefined): PromptHookAdapter {
	if (value === 'vscode' || value === 'claude' || value === 'codex') {
		return value;
	}
	throw new Error('Invalid prompt hook adapter');
}

function parseConfiguration(value: string): PromptBridgeConfiguration {
	const parsed = JSON.parse(value) as Partial<PromptBridgeConfiguration>;
	if (
		parsed.schemaVersion !== 1
		|| typeof parsed.inboxDirectory !== 'string'
		|| !Array.isArray(parsed.enabledRoots)
		|| !parsed.enabledRoots.every((root) => typeof root === 'string')
		|| !Array.isArray(parsed.providers)
		|| !parsed.providers.every(isProviderStatus)
	) {
		throw new Error('Invalid prompt bridge configuration');
	}
	return parsed as PromptBridgeConfiguration;
}

function isProviderStatus(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const provider = value as Record<string, unknown>;
	return (provider.id === 'copilot' || provider.id === 'claude' || provider.id === 'codex')
		&& typeof provider.name === 'string'
		&& provider.name.length > 0
		&& typeof provider.installed === 'boolean';
}

function canonicalPath(value: string): string {
	try {
		return fs.realpathSync(value);
	} catch {
		return path.resolve(value);
	}
}

function tryChmod(targetPath: string, mode: number): void {
	try {
		fs.chmodSync(targetPath, mode);
	} catch {
		// Redaction and allowlisting still apply on filesystems without POSIX modes.
	}
}