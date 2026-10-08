import { OFFICIAL_MODELS, OfficialModelVendor, PROVIDER_MODEL_SNAPSHOT } from './providerModels';

export type ModelVendor = OfficialModelVendor;
export type ReasoningEffort = 'standard' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'adaptive';
export type ModelTaskType =
	| 'Architecture'
	| 'Debugging'
	| 'Implementation'
	| 'Review'
	| 'Research'
	| 'Quick task';

export interface CodingAgentEvidence {
	index: number;
	harness: 'claude' | 'codex' | 'opencode';
	evaluatedProfile: string;
	costPerTaskUsd: number;
	timePerTaskMinutes?: number;
}

export interface ArtificialAnalysisMetrics {
	intelligenceIndex?: number;
	costPerTaskUsd?: number;
	outputTokensPerSecond?: number;
	timeToFirstAnswerSeconds?: number;
	endToEndResponseSeconds?: number;
	contextWindowTokens?: number;
}

export interface ModelProfile {
	id: string;
	modelLabel: string;
	vendor: ModelVendor;
	profileLabel: string;
	reasoningEffort: ReasoningEffort;
	modelPageUrl: string;
	artificialAnalysis: ArtificialAnalysisMetrics;
	codingAgent?: CodingAgentEvidence;
	intelligenceEstimated?: boolean;
	deprecated?: boolean;
}

export const ARTIFICIAL_ANALYSIS_SNAPSHOT = {
	capturedAt: '2026-09-06',
	intelligenceIndexVersion: '4.2',
	sourceUrl: 'https://artificialanalysis.ai/leaderboards/models',
} as const;

const ONE_MILLION_TOKENS = 1_000_000;

const MEASURED_PROFILES: readonly ModelProfile[] = [
	openAiProfile('gpt-5-6-luna-low', 'GPT-5.6 Luna', 'Low reasoning', 'low', 26, undefined, 104, 1.77, 6.57, true),
	openAiProfile('gpt-5-6-luna-medium', 'GPT-5.6 Luna', 'Medium reasoning', 'medium', 30, undefined, 107, 3.79, 8.46, true),
	openAiProfile('gpt-5-6-luna-high', 'GPT-5.6 Luna', 'High reasoning', 'high', 37, undefined, 124, 22.24, 26.27, true),
	openAiProfile('gpt-5-6-luna-xhigh', 'GPT-5.6 Luna', 'XHigh reasoning', 'xhigh', 42, 0.06, 128, 66.40, 70.31),
	openAiProfile('gpt-5-6-terra-low', 'GPT-5.6 Terra', 'Low reasoning', 'low', 32, undefined, 89, 1.84, 7.47, true),
	openAiProfile('gpt-5-6-terra-medium', 'GPT-5.6 Terra', 'Medium reasoning', 'medium', 37, undefined, 87, 1.67, 7.43, true),
	openAiProfile('gpt-5-6-terra-high', 'GPT-5.6 Terra', 'High reasoning', 'high', 41, 0.30, 97, 3.67, 8.83),
	openAiProfile('gpt-5-6-terra-xhigh', 'GPT-5.6 Terra', 'XHigh reasoning', 'xhigh', 44, 0.50, 102, 55.63, 60.53),
	openAiProfile('gpt-5-6-sol-low', 'GPT-5.6 Sol', 'Low reasoning', 'low', 41, 0.23, 74, 3.28, 10.05),
	openAiProfile('gpt-5-6-sol-medium', 'GPT-5.6 Sol', 'Medium reasoning', 'medium', 46, 0.37, 72, 6.41, 13.34),
	openAiProfile('gpt-5-6-sol-high', 'GPT-5.6 Sol', 'High reasoning', 'high', 48, 0.61, 73, 17.87, 24.68),
	openAiProfile('gpt-5-6-sol-xhigh', 'GPT-5.6 Sol', 'XHigh reasoning', 'xhigh', 50, 0.89, 82, 64.00, 70.10),
	{
		id: 'gemini-3-8-flash-high',
		modelLabel: 'Gemini 3.8 Flash',
		vendor: 'Google',
		profileLabel: 'High reasoning',
		reasoningEffort: 'high',
		modelPageUrl: 'https://artificialanalysis.ai/models/gemini-3-8-flash',
		artificialAnalysis: metrics(47, 0.74, 334, 10.84, 12.34),
		codingAgent: {
			index: 61,
			harness: 'opencode',
			evaluatedProfile: 'high',
			costPerTaskUsd: 2.04,
			timePerTaskMinutes: 11.9,
		},
	},
	{
		id: 'gemini-3-5-flash-lite',
		modelLabel: 'Gemini 3.5 Flash Lite',
		vendor: 'Google',
		profileLabel: 'Default reasoning',
		reasoningEffort: 'standard',
		modelPageUrl: 'https://artificialanalysis.ai/models/gemini-3-5-flash-lite',
		artificialAnalysis: metrics(28, 0.08, 354, 6.57, 7.98),
	},
	{
		id: 'gpt-6-astra',
		modelLabel: 'GPT-6 Astra',
		vendor: 'OpenAI',
		profileLabel: 'Max reasoning',
		reasoningEffort: 'max',
		modelPageUrl: 'https://artificialanalysis.ai/models/gpt-6-astra',
		artificialAnalysis: metrics(55, 2.57, 71, 384.30, 391.31),
		codingAgent: {
			index: 67,
			harness: 'codex',
			evaluatedProfile: 'max',
			costPerTaskUsd: 4.72,
		},
	},
	{
		id: 'claude-opus-5',
		modelLabel: 'Claude Opus 5',
		vendor: 'Anthropic',
		profileLabel: 'XHigh adaptive reasoning',
		reasoningEffort: 'xhigh',
		modelPageUrl: 'https://artificialanalysis.ai/models/claude-opus-5-xhigh',
		artificialAnalysis: metrics(53, 3.36, 54, 34.42, 43.73),
		codingAgent: {
			index: 68,
			harness: 'claude',
			evaluatedProfile: 'xhigh',
			costPerTaskUsd: 8.17,
			timePerTaskMinutes: 23.7,
		},
	},
	{
		id: 'claude-opus-4-8',
		modelLabel: 'Claude Opus 4.8',
		vendor: 'Anthropic',
		profileLabel: 'Max adaptive reasoning',
		reasoningEffort: 'max',
		modelPageUrl: 'https://artificialanalysis.ai/models/claude-opus-4-8',
		artificialAnalysis: {
			intelligenceIndex: 46,
			outputTokensPerSecond: 63.1,
			timeToFirstAnswerSeconds: 33.87,
			contextWindowTokens: ONE_MILLION_TOKENS,
		},
		intelligenceEstimated: true,
		deprecated: true,
	},
	{
		id: 'claude-fable-5',
		modelLabel: 'Claude Fable 5',
		vendor: 'Anthropic',
		profileLabel: 'Max adaptive reasoning (Opus 4.8 fallback)',
		reasoningEffort: 'max',
		modelPageUrl: 'https://artificialanalysis.ai/models/claude-fable-5',
		artificialAnalysis: metrics(53, 5.62, 68, 103.55, 110.90),
	},
	{
		id: 'claude-fable-5-1',
		modelLabel: 'Claude Fable 5.1',
		vendor: 'Anthropic',
		profileLabel: 'Max adaptive reasoning (default fallback)',
		reasoningEffort: 'max',
		modelPageUrl: 'https://artificialanalysis.ai/models/claude-fable-5-1',
		artificialAnalysis: metrics(57, 6.12, 70, 264.91, 272.01),
		codingAgent: {
			index: 70,
			harness: 'claude',
			evaluatedProfile: 'max with fallback',
			costPerTaskUsd: 9.18,
			timePerTaskMinutes: 24.0,
		},
	},
	{
		id: 'claude-sonnet-5',
		modelLabel: 'Claude Sonnet 5',
		vendor: 'Anthropic',
		profileLabel: 'Max adaptive reasoning',
		reasoningEffort: 'max',
		modelPageUrl: 'https://artificialanalysis.ai/models/claude-sonnet-5',
		artificialAnalysis: metrics(45, 3.31, 90, 184.73, 190.27),
	},
];

function openAiProfile(
	id: string,
	modelLabel: string,
	profileLabel: string,
	reasoningEffort: ReasoningEffort,
	intelligenceIndex: number,
	costPerTaskUsd: number | undefined,
	outputTokensPerSecond: number,
	timeToFirstAnswerSeconds: number,
	endToEndResponseSeconds: number,
	intelligenceEstimated = false,
): ModelProfile {
	return {
		id,
		modelLabel,
		vendor: 'OpenAI',
		profileLabel,
		reasoningEffort,
		modelPageUrl: `https://artificialanalysis.ai/models/${id}`,
		artificialAnalysis: metrics(
			intelligenceIndex,
			costPerTaskUsd,
			outputTokensPerSecond,
			timeToFirstAnswerSeconds,
			endToEndResponseSeconds,
		),
		intelligenceEstimated: intelligenceEstimated || undefined,
	};
}

function metrics(
	intelligenceIndex: number,
	costPerTaskUsd: number | undefined,
	outputTokensPerSecond: number,
	timeToFirstAnswerSeconds: number,
	endToEndResponseSeconds: number,
): ArtificialAnalysisMetrics {
	return {
		intelligenceIndex,
		costPerTaskUsd,
		outputTokensPerSecond,
		timeToFirstAnswerSeconds,
		endToEndResponseSeconds,
		contextWindowTokens: ONE_MILLION_TOKENS,
	};
}
// Officially offered models without benchmark evidence remain explicitly selectable.
// Do not invent measurements or rank them as measured recommendations.
export const MODEL_PROFILES: readonly ModelProfile[] = [
	...MEASURED_PROFILES,
	...OFFICIAL_MODELS.filter((model) => !MEASURED_PROFILES.some((profile) => profile.modelLabel === model.label))
		.map((model): ModelProfile => ({
			id: model.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, ''),
			modelLabel: model.label,
			vendor: model.vendor,
			profileLabel: 'Provider defaults · not benchmarked',
			reasoningEffort: 'standard',
			modelPageUrl: PROVIDER_MODEL_SNAPSHOT[model.providers[0]],
			artificialAnalysis: {},
		})),
];
