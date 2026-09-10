import * as path from 'node:path';

import { ProviderStatus } from './model';
import { LiveRecommendation, PromptSource } from './recommendation';

export const PROMPT_HOOK_MARKER = 'PERSONAL_BENCHMARK_PROMPT_HOOK=1';
export type PromptHookAdapter = 'vscode' | 'claude' | 'codex';

export interface NormalizedPromptHookInput {
	cwd: string;
	prompt: string;
	sessionId?: string;
	turnId?: string;
	model?: string;
	source: Exclude<PromptSource, 'manual'>;
}

export interface PromptBridgeConfiguration {
	schemaVersion: 1;
	inboxDirectory: string;
	enabledRoots: string[];
	providers: ProviderStatus[];
}

export interface PromptInboxItem {
	schemaVersion: 1;
	id: string;
	cwd: string;
	source: Exclude<PromptSource, 'manual'>;
	receivedAt: string;
	replacementCount: number;
	recommendation: LiveRecommendation;
}

interface PromptHookHandler {
	type: 'command';
	command: string;
	timeout: number;
}

interface PromptHookGroup {
	hooks: PromptHookHandler[];
}

export interface HookConfiguration extends Record<string, unknown> {
	hooks: Record<string, unknown> & {
		UserPromptSubmit: PromptHookGroup[];
	};
}

export interface DirectHookConfiguration extends Record<string, unknown> {
	hooks: Record<string, unknown> & {
		UserPromptSubmit: PromptHookHandler[];
	};
}

export function normalizePromptHookInput(
	input: unknown,
	adapter: PromptHookAdapter,
): NormalizedPromptHookInput | undefined {
	if (!isRecord(input) || input.hook_event_name !== 'UserPromptSubmit') {
		return undefined;
	}

	if (typeof input.cwd !== 'string' || typeof input.prompt !== 'string' || input.prompt.trim() === '') {
		return undefined;
	}

	const source = detectPromptSource(input, adapter);
	if (!source) {
		return undefined;
	}

	return {
		cwd: input.cwd,
		prompt: input.prompt,
		sessionId: optionalString(input.session_id),
		turnId: optionalString(input.turn_id),
		model: optionalString(input.model),
		source,
	};
}

export function isPathInsideRoot(candidatePath: string, rootPath: string): boolean {
	const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
	return relative === '' || (
		relative !== '..'
		&& !relative.startsWith(`..${path.sep}`)
		&& !path.isAbsolute(relative)
	);
}

export function addPromptHook(input: unknown, command: string): HookConfiguration {
	const configuration = cloneRecord(removePromptHook(input));
	const hooks = isRecord(configuration.hooks) ? { ...configuration.hooks } : {};
	const currentGroups = Array.isArray(hooks.UserPromptSubmit)
		? [...hooks.UserPromptSubmit]
		: [];

	hooks.UserPromptSubmit = [
		...currentGroups,
		{
			hooks: [{
				type: 'command',
				command,
				timeout: 2,
			}],
		},
	];
	configuration.hooks = hooks;
	return configuration as HookConfiguration;
}

export function removePromptHook(input: unknown): HookConfiguration {
	const configuration = cloneRecord(input);
	if (!isRecord(configuration.hooks)) {
		return configuration as HookConfiguration;
	}

	const hooks = { ...configuration.hooks };
	if (Array.isArray(hooks.UserPromptSubmit)) {
		const remainingGroups = hooks.UserPromptSubmit
			.map(removePersonalBenchmarkHandlers)
			.filter((group) => group !== undefined);
		if (remainingGroups.length > 0) {
			hooks.UserPromptSubmit = remainingGroups;
		} else {
			delete hooks.UserPromptSubmit;
		}
	}

	if (Object.keys(hooks).length > 0) {
		configuration.hooks = hooks;
	} else {
		delete configuration.hooks;
	}
	return configuration as HookConfiguration;
}

export function addDirectPromptHook(input: unknown, command: string): DirectHookConfiguration {
	const configuration = cloneRecord(removeDirectPromptHook(input));
	const hooks = isRecord(configuration.hooks) ? { ...configuration.hooks } : {};
	const currentHandlers = Array.isArray(hooks.UserPromptSubmit)
		? [...hooks.UserPromptSubmit]
		: [];

	hooks.UserPromptSubmit = [
		...currentHandlers,
		{
			type: 'command',
			command,
			timeout: 2,
		},
	];
	configuration.hooks = hooks;
	return configuration as DirectHookConfiguration;
}

export function removeDirectPromptHook(input: unknown): DirectHookConfiguration {
	const configuration = cloneRecord(input);
	if (!isRecord(configuration.hooks)) {
		return configuration as DirectHookConfiguration;
	}

	const hooks = { ...configuration.hooks };
	if (Array.isArray(hooks.UserPromptSubmit)) {
		const remainingHandlers = hooks.UserPromptSubmit.filter((handler) => !isPersonalBenchmarkHandler(handler));
		if (remainingHandlers.length > 0) {
			hooks.UserPromptSubmit = remainingHandlers;
		} else {
			delete hooks.UserPromptSubmit;
		}
	}

	if (Object.keys(hooks).length > 0) {
		configuration.hooks = hooks;
	} else {
		delete configuration.hooks;
	}
	return configuration as DirectHookConfiguration;
}

export function containsPromptHook(value: unknown): boolean {
	try {
		return JSON.stringify(value).includes(PROMPT_HOOK_MARKER);
	} catch {
		return false;
	}
}

function detectPromptSource(
	input: Record<string, unknown>,
	adapter: PromptHookAdapter,
): Exclude<PromptSource, 'manual'> | undefined {
	if (adapter !== 'claude') {
		return adapter;
	}

	const transcriptPath = optionalString(input.transcript_path) ?? '';
	return /(?:^|[\\/])\.claude(?:[\\/]|$)/.test(transcriptPath) ? 'claude' : undefined;
}

function removePersonalBenchmarkHandlers(group: unknown): unknown | undefined {
	if (!isRecord(group) || !Array.isArray(group.hooks)) {
		return group;
	}

	const remainingHandlers = group.hooks.filter((handler) => !isPersonalBenchmarkHandler(handler));
	return remainingHandlers.length > 0 ? { ...group, hooks: remainingHandlers } : undefined;
}

function isPersonalBenchmarkHandler(value: unknown): boolean {
	return isRecord(value)
		&& typeof value.command === 'string'
		&& value.command.includes(PROMPT_HOOK_MARKER);
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value !== '' ? value : undefined;
}

function cloneRecord(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) {
		return {};
	}

	return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}