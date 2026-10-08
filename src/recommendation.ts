import { isModelOfferedByProvider } from './providerModels';
import { createHash } from 'node:crypto';

import { ProviderStatus } from './model';
import { ModelTaskType } from './modelCatalog';
import {
	ModelSelectionBasis,
	RegisteredModelPerformance,
	selectModelProfile,
	findExplicitlyRequestedProfiles,
} from './modelSelection';
import { redactSecrets } from './redaction';

export type PromptSource = 'manual' | 'vscode' | 'claude' | 'codex';
export type RecommendationTaskType = ModelTaskType;
export const RECOMMENDATION_ENGINE_VERSION = 3 as const;

export interface LiveRecommendation {
	engineVersion: typeof RECOMMENDATION_ENGINE_VERSION;
	providerId: ProviderStatus['id'];
	modelProfileId: string;
	modelLabel: string;
	profileLabel: string;
	modelSelectionBasis: ModelSelectionBasis;
	modelSelectionNote: string;
	taskType: RecommendationTaskType;
	confidence: number;
	reason: string;
	signals: string[];
	promptPreview: string;
	promptHash: string;
	source: PromptSource;
	analyzedAt: string;
	fallbackApplied: boolean;
}

export function isCurrentRecommendation(
	recommendation: LiveRecommendation | undefined,
): recommendation is LiveRecommendation {
	return recommendation?.engineVersion === RECOMMENDATION_ENGINE_VERSION;
}

interface Scores {
	copilot: number;
	claude: number;
	codex: number;
}

interface TaskScores {
	Architecture: number;
	Debugging: number;
	Implementation: number;
	Review: number;
	Research: number;
	'Quick task': number;
}

export function recommendModel(
	prompt: string,
	providers: readonly ProviderStatus[],
	source: PromptSource,
	now = new Date(),
	registeredPerformance: readonly RegisteredModelPerformance[] = [],
): LiveRecommendation {
	const normalizedPrompt = prompt.replace(/\s+/g, ' ').trim();
	const lowerPrompt = normalizedPrompt.toLowerCase();
	const wordCount = normalizedPrompt === '' ? 0 : normalizedPrompt.split(/\s+/).length;
	const scores: Scores = { copilot: 1, claude: 1, codex: 1 };
	const taskScores: TaskScores = {
		Architecture: 0,
		Debugging: 0,
		Implementation: 0,
		Review: 0,
		Research: 0,
		'Quick task': 0,
	};
	const signals: string[] = [];

	applySignal(
		/\b(architect(?:ure)?|system design|trade-?offs?|domain model|adr|migration strateg|distributed|scalab|multi-tenant)\b/i,
		'Cross-cutting design',
		{ claude: 8, codex: 1 },
		'Architecture',
		8,
	);
	applySignal(
		/\b(security|threat model|vulnerab|authorization|authentication|privacy|risk)\b/i,
		'Security-sensitive reasoning',
		{ claude: 4, codex: 2 },
		'Review',
		3,
	);
	applySignal(
		/\b(debug|failing|failure|regression|stack trace|exception|error|root cause|reproduc)\b/i,
		'Failure diagnosis',
		{ codex: 8, claude: 1 },
		'Debugging',
		8,
	);
	applySignal(
		/\b(implement|build|create|add|fix|refactor|patch|endpoint|component|feature|write code)\b/i,
		'Repository implementation',
		{ codex: 5, claude: 1 },
		'Implementation',
		5,
	);
	applySignal(
		/\b(extension|dashboard|user interface|ui|ux|webview|command|hook|integration|workflow)\b/i,
		'Product surface change',
		{ codex: 4, claude: 1 },
		'Implementation',
		4,
	);
	applySignal(
		/\b(test|tests|pytest|jest|vitest|spec|lint|compile|typecheck|validation)\b/i,
		'Executable validation',
		{ codex: 4 },
		'Debugging',
		3,
	);
	applySignal(
		/\b(review|audit|critique|inspect|assess|find issues|code quality)\b/i,
		'Critical review',
		{ claude: 5, codex: 2 },
		'Review',
		6,
	);
	applySignal(
		/\b(research|compare|investigate|explore|evaluate options|documentation|docs|survey)\b/i,
		'Open-ended research',
		{ claude: 6 },
		'Research',
		7,
	);

	if (wordCount <= 14 && /\b(explain|summarize|rename|translate|what does|two sentences|one line|quick)\b/i.test(lowerPrompt)) {
		scores.copilot += 9;
		taskScores['Quick task'] += 10;
		signals.push('Narrow, well-specified request');
	}

	if (/```|\b(?:traceback|error [A-Z]*\d+|at \S+\([^)]*:\d+)\b/.test(prompt)) {
		scores.codex += 4;
		taskScores.Debugging += 3;
		signals.push('Code or diagnostic context');
	}

	if (wordCount >= 80) {
		scores.claude += 3;
		signals.push('Long-context task');
	}

	if (Object.values(taskScores).every((score) => score === 0)) {
		if (wordCount <= 20) {
			scores.copilot += 5;
			taskScores['Quick task'] += 6;
			signals.push('Small general request');
		} else if (wordCount >= 80) {
			taskScores.Research += 4;
		} else {
			scores.codex += 3;
			taskScores.Implementation += 4;
			signals.push('General repository task');
		}
	}

	const rankedProviders = (Object.entries(scores) as Array<[ProviderStatus['id'], number]>)
		.sort((left, right) => right[1] - left[1]);
	const preferredProviderId = rankedProviders[0][0];
	const installedProviderIds = new Set(
		providers.filter((provider) => provider.installed).map((provider) => provider.id),
	);
	const requestedProfiles = findExplicitlyRequestedProfiles(prompt);
	const requestedProvider = rankedProviders.find(([candidate]) => installedProviderIds.has(candidate)
		&& requestedProfiles.some((profile) => isModelOfferedByProvider(profile.modelLabel, candidate)))?.[0];
	const providerId = requestedProvider ?? rankedProviders.find(([candidate]) => installedProviderIds.has(candidate))?.[0]
		?? preferredProviderId;
	const fallbackApplied = requestedProvider === undefined && providerId !== preferredProviderId;
	const taskType = (Object.entries(taskScores) as Array<[RecommendationTaskType, number]>)
		.sort((left, right) => right[1] - left[1])[0][0];
	const scoreMargin = rankedProviders[0][1] - rankedProviders[1][1];
	const confidence = clamp(
		58 + Math.min(22, scoreMargin * 3) + Math.min(12, signals.length * 2) - (fallbackApplied ? 15 : 0),
		52,
		94,
	);
	const redactedPrompt = redactSecrets(normalizedPrompt).value;
	const modelSelection = selectModelProfile(prompt, taskType, providerId, registeredPerformance);
	const profile = modelSelection.profile;
	const fallbackSuffix = fallbackApplied
		? ' The first-choice provider is not installed, so this is the strongest available fallback.'
		: '';

	return {
		engineVersion: RECOMMENDATION_ENGINE_VERSION,
		providerId,
		modelProfileId: profile.id,
		modelLabel: profile.modelLabel,
		profileLabel: profile.profileLabel,
		modelSelectionBasis: modelSelection.basis,
		modelSelectionNote: modelSelection.note,
		taskType,
		confidence,
		reason: `${getReason(providerId, taskType)}${fallbackSuffix}`,
		signals: signals.slice(0, 3),
		promptPreview: truncate(redactedPrompt, 180),
		promptHash: createHash('sha256').update(redactedPrompt).digest('hex'),
		source,
		analyzedAt: now.toISOString(),
		fallbackApplied,
	};

	function applySignal(
		pattern: RegExp,
		label: string,
		providerWeights: Partial<Scores>,
		type: RecommendationTaskType,
		taskWeight: number,
	): void {
		if (!pattern.test(prompt)) {
			return;
		}

		for (const [providerId, weight] of Object.entries(providerWeights) as Array<[keyof Scores, number]>) {
			scores[providerId] += weight;
		}
		taskScores[type] += taskWeight;
		signals.push(label);
	}
}

function getReason(providerId: ProviderStatus['id'], taskType: RecommendationTaskType): string {
	if (providerId === 'claude') {
		return taskType === 'Architecture'
			? 'Use the Claude harness for cross-cutting trade-offs, long-context planning, and careful system reasoning.'
			: 'Use the Claude harness for careful synthesis, nuanced review, and long-context reasoning.';
	}

	if (providerId === 'codex') {
		return taskType === 'Debugging'
			? 'Use the Codex harness for repository debugging, patch generation, and iterative test loops.'
			: 'Use the Codex harness for implementation, repository edits, and executable validation.';
	}

	return 'Use the Copilot harness for efficient, accurate responses on focused tasks.';
}

function truncate(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, Math.round(value)));
}