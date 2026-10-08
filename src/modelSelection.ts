import { isModelOfferedByProvider, PROVIDER_MODEL_SNAPSHOT } from './providerModels';
import { ProviderStatus } from './model';
import {
	ARTIFICIAL_ANALYSIS_SNAPSHOT,
	MODEL_PROFILES,
	ModelProfile,
	ModelTaskType,
	ReasoningEffort,
} from './modelCatalog';

export type ModelSelectionBasis = 'explicit-request' | 'registered-benchmark' | 'artificial-analysis-heuristic';

export interface RegisteredModelPerformance {
	modelProfileId: string;
	modelLabel?: string;
	profileLabel?: string;
	taskType: ModelTaskType;
	sampleSize: number;
	score: number;
}

export interface ModelSelection {
	profile: Pick<ModelProfile, 'id' | 'modelLabel' | 'profileLabel'>;
	basis: ModelSelectionBasis;
	note: string;
}

export const REGISTERED_MODEL_MINIMUM_CASES = 3;

interface MetricWeights {
	intelligence: number;
	speed: number;
	latency: number;
	cost: number;
	coding: number;
}

const TASK_WEIGHTS: Readonly<Record<ModelTaskType, MetricWeights>> = {
	Architecture: { intelligence: 0.65, speed: 0.05, latency: 0.05, cost: 0.05, coding: 0.20 },
	Debugging: { intelligence: 0.35, speed: 0.05, latency: 0.05, cost: 0.10, coding: 0.45 },
	Implementation: { intelligence: 0.30, speed: 0.25, latency: 0.15, cost: 0.15, coding: 0.15 },
	Review: { intelligence: 0.50, speed: 0.05, latency: 0.15, cost: 0.15, coding: 0.15 },
	Research: { intelligence: 0.65, speed: 0.08, latency: 0.08, cost: 0.08, coding: 0.11 },
	'Quick task': { intelligence: 0.10, speed: 0.35, latency: 0.30, cost: 0.25, coding: 0 },
};

const EFFORT_ORDER: Readonly<Record<ReasoningEffort, number>> = {
	standard: 1,
	low: 1,
	medium: 2,
	high: 3,
	xhigh: 4,
	adaptive: 4,
	max: 5,
};

const TARGET_EFFORT: Readonly<Record<ModelTaskType, number>> = {
	Architecture: 4,
	Debugging: 3,
	Implementation: 2,
	Review: 4,
	Research: 4,
	'Quick task': 1,
};

const TASK_PROFILE_PRIORS: Readonly<Record<ModelTaskType, readonly string[]>> = {
	Architecture: ['claude-fable-5-1', 'claude-opus-5', 'gpt-6-astra', 'gpt-5-6-sol-xhigh'],
	Debugging: ['gpt-6-astra', 'claude-opus-5', 'gpt-5-6-sol-high', 'gpt-5-6-terra-high'],
	Implementation: ['gemini-3-8-flash-high', 'gpt-6-astra', 'claude-sonnet-5', 'gpt-5-6-terra-medium'],
	Review: ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5-1', 'gpt-5-6-sol-xhigh'],
	Research: ['claude-fable-5-1', 'claude-fable-5', 'claude-opus-5', 'gpt-6-astra'],
	'Quick task': ['gemini-3-5-flash-lite', 'gpt-5-6-luna-low', 'gpt-5-6-terra-low'],
};

export function selectModelProfile(
	prompt: string,
	taskType: ModelTaskType,
	providerId: ProviderStatus['id'],
	registeredPerformance: readonly RegisteredModelPerformance[] = [],
): ModelSelection {
	const availableProfiles = MODEL_PROFILES.filter((profile) => isModelOfferedByProvider(profile.modelLabel, providerId));
	const requestedProfiles = findExplicitlyRequestedProfiles(prompt);
	const explicitlyRequested = requestedProfiles.filter((profile) => availableProfiles.includes(profile));
	if (explicitlyRequested.length > 0) {
		const profile = rankProfiles(explicitlyRequested, prompt, taskType, providerId)[0];
		return {
			profile,
			basis: 'explicit-request',
			note: 'Selected from the model family and reasoning effort named in the task prompt.',
		};
	}

	const registeredWinner = selectFromRegisteredPerformance(taskType, registeredPerformance, providerId);
	if (registeredWinner) {
		return registeredWinner;
	}

	// Evidence measured through VS Code models exists but cannot be used on this harness.
	const inapplicableEvidence = registeredPerformance.some((entry) => entry.taskType === taskType && isUsableRegisteredPerformance(entry));
	const profile = rankProfiles(
		availableProfiles.filter((candidate) => !candidate.deprecated && candidate.artificialAnalysis.intelligenceIndex !== undefined),
		prompt,
		taskType,
		providerId,
	)[0];
	return {
		profile,
		basis: 'artificial-analysis-heuristic',
		note: `${buildArtificialAnalysisNote(profile, taskType, inapplicableEvidence ? providerId : undefined)} Official provider catalog checked ${PROVIDER_MODEL_SNAPSHOT.checkedAt}; account access may vary.${requestedProfiles.length > 0 ? ` The requested model is not listed for ${providerId}; selected a supported alternative.` : ''}`,
	};
}

function selectFromRegisteredPerformance(
	taskType: ModelTaskType,
	registeredPerformance: readonly RegisteredModelPerformance[],
	providerId: ProviderStatus['id'],
): ModelSelection | undefined {
	const ranked = registeredPerformance
		.filter((entry) => entry.taskType === taskType)
		.filter(isUsableRegisteredPerformance)
		.map((entry) => ({
			entry,
			profile: MODEL_PROFILES.find((profile) => profile.id === entry.modelProfileId && isModelOfferedByProvider(profile.modelLabel, providerId))
				?? (providerId === 'copilot' && entry.modelProfileId.startsWith('vscode:') && entry.modelLabel && entry.profileLabel
					? { id: entry.modelProfileId, modelLabel: entry.modelLabel, profileLabel: entry.profileLabel } : undefined),
			adjustedScore: entry.score - (10 / Math.sqrt(entry.sampleSize)),
		}))
		.filter((candidate): candidate is typeof candidate & { profile: ModelSelection['profile'] } => candidate.profile !== undefined)
		.sort((left, right) => right.adjustedScore - left.adjustedScore
			|| right.entry.sampleSize - left.entry.sampleSize
			|| left.profile.id.localeCompare(right.profile.id));

	const winner = ranked[0];
	if (!winner) {
		return undefined;
	}

	return {
		profile: winner.profile,
		basis: 'registered-benchmark',
		note: `Selected from ${winner.entry.sampleSize} registered ${taskType.toLowerCase()} cases with a ${winner.entry.score.toFixed(1)} score.`,
	};
}

function isUsableRegisteredPerformance(entry: RegisteredModelPerformance): boolean {
	return Number.isInteger(entry.sampleSize)
		&& entry.sampleSize >= REGISTERED_MODEL_MINIMUM_CASES
		&& Number.isFinite(entry.score)
		&& entry.score >= 0
		&& entry.score <= 100;
}

export function findExplicitlyRequestedProfiles(prompt: string): ModelProfile[] {
	const normalizedPrompt = normalizeWords(prompt);
	const modelLabels = [...new Set(MODEL_PROFILES.map((profile) => profile.modelLabel))]
		.sort((left, right) => right.length - left.length);
	const requestedLabel = modelLabels.find((label) => new RegExp(`(?:^| )${normalizeWords(label)}(?= |$)(?! [0-9])`).test(normalizedPrompt));
	if (!requestedLabel) {
		return [];
	}

	const matchingProfiles = MODEL_PROFILES.filter((profile) => profile.modelLabel === requestedLabel);
	const requestedEffort = detectRequestedEffort(prompt);
	return requestedEffort
		? matchingProfiles.filter((profile) => profile.reasoningEffort === requestedEffort)
		: matchingProfiles;
}

function detectRequestedEffort(prompt: string): ReasoningEffort | undefined {
	const match = prompt.match(/\b(?:reasoning|effort)\s*[:=-]?\s*(low|medium|high|xhigh|max)\b|\b(low|medium|high|xhigh|max)\s+(?:reasoning|effort)\b/i);
	return (match?.[1] ?? match?.[2])?.toLowerCase() as ReasoningEffort | undefined;
}

function rankProfiles(
	profiles: readonly ModelProfile[],
	prompt: string,
	taskType: ModelTaskType,
	providerId: ProviderStatus['id'],
): ModelProfile[] {
	return [...profiles].sort((left, right) =>
		scoreProfile(right, prompt, taskType, providerId) - scoreProfile(left, prompt, taskType, providerId)
		|| left.id.localeCompare(right.id));
}

function scoreProfile(
	profile: ModelProfile,
	prompt: string,
	taskType: ModelTaskType,
	providerId: ProviderStatus['id'],
): number {
	const weights = TASK_WEIGHTS[taskType];
	const metrics = profile.artificialAnalysis;
	const intelligence = (metrics.intelligenceIndex ?? 28.5) / 57;
	const speed = Math.min(1, (metrics.outputTokensPerSecond ?? 70) / 354);
	const latency = 1 / (1 + ((metrics.timeToFirstAnswerSeconds ?? 20) / 10));
	const cost = 1 / (1 + (metrics.costPerTaskUsd ?? 1));
	const coding = profile.codingAgent ? profile.codingAgent.index / 70 : intelligence * 0.85;
	const effortDistance = Math.abs(EFFORT_ORDER[profile.reasoningEffort] - TARGET_EFFORT[taskType]);
	const priorIndex = TASK_PROFILE_PRIORS[taskType].indexOf(profile.id);
	let score = (intelligence * weights.intelligence)
		+ (speed * weights.speed)
		+ (latency * weights.latency)
		+ (cost * weights.cost)
		+ (coding * weights.coding)
		+ Math.max(0, 0.10 - (effortDistance * 0.025));
	if (priorIndex >= 0) {
		score += 0.12 - (priorIndex * 0.02);
	}

	if (
		profile.codingAgent?.harness === providerId
		&& (taskType === 'Debugging' || taskType === 'Implementation' || taskType === 'Architecture')
	) {
		score += 0.06;
	}
	if (/\b(fast|quickly|low latency|interactive|immediate|responsive)\b/i.test(prompt)) {
		score += (speed * 0.10) + (latency * 0.08);
	}
	if (/\b(cheap|budget|cost(?:-effective| sensitive)?|economical|many runs|high volume)\b/i.test(prompt)) {
		score += cost * 0.16;
	}
	if (/\b(image|screenshot|audio|video|multimodal|visual)\b/i.test(prompt) && profile.vendor === 'Google') {
		score += 0.16;
	}
	if (/\b(highest quality|best available|mission critical|safety critical|deep reasoning|no compromise)\b/i.test(prompt)) {
		score += intelligence * 0.14;
	}
	if (profile.intelligenceEstimated) {
		score -= 0.05;
	}
	if (profile.deprecated) {
		score -= 0.30;
	}

	return score;
}

function buildArtificialAnalysisNote(profile: ModelProfile, taskType: ModelTaskType, inapplicableEvidenceProvider?: ProviderStatus['id']): string {
	const metrics = profile.artificialAnalysis;
	const facts = [
		metrics.intelligenceIndex === undefined ? undefined : `Intelligence ${metrics.intelligenceIndex}`,
		profile.codingAgent && (taskType === 'Debugging' || taskType === 'Implementation')
			? `Coding Agent Index ${profile.codingAgent.index}`
			: undefined,
		metrics.outputTokensPerSecond === undefined ? undefined : `${Math.round(metrics.outputTokensPerSecond)} output tokens/s`,
	].filter((fact): fact is string => fact !== undefined);

	const snapshot = `the ${ARTIFICIAL_ANALYSIS_SNAPSHOT.capturedAt} Artificial Analysis v${ARTIFICIAL_ANALYSIS_SNAPSHOT.intelligenceIndexVersion} snapshot (${facts.join(', ')})`;
	if (inapplicableEvidenceProvider) {
		return `Your ${taskType} benchmark results were measured through VS Code models and apply only to the Copilot route, not ${inapplicableEvidenceProvider}. Using prompt signals and ${snapshot}.`;
	}
	return `Registered Personal Benchmark results are still being generated. Using prompt signals and ${snapshot} until at least ${REGISTERED_MODEL_MINIMUM_CASES} comparable local cases exist.`;
}

function normalizeWords(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}