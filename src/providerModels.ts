import type { ProviderStatus } from './model';

// Official product availability, independent of the frozen benchmark measurements.
// Account entitlements, organization policy and client rollout can narrow these lists.
export const PROVIDER_MODEL_SNAPSHOT = {
	checkedAt: '2026-09-18',
	copilot: 'https://docs.github.com/en/copilot/reference/ai-models/supported-models',
	claude: 'https://code.claude.com/docs/en/model-config',
	codex: 'https://learn.chatgpt.com/docs/models',
} as const;

export type OfficialModelVendor = 'Anthropic' | 'Google' | 'OpenAI' | 'Microsoft' | 'Moonshot AI' | 'xAI';
export interface OfficialModel {
	label: string;
	vendor: OfficialModelVendor;
	providers: readonly ProviderStatus['id'][];
}

export const OFFICIAL_MODELS: readonly OfficialModel[] = [
	{ label: 'GPT-6 Astra', vendor: 'OpenAI', providers: ['copilot', 'codex'] },
	{ label: 'GPT-5.6 Sol', vendor: 'OpenAI', providers: ['copilot', 'codex'] },
	{ label: 'GPT-5.6 Terra', vendor: 'OpenAI', providers: ['copilot', 'codex'] },
	{ label: 'GPT-5.6 Luna', vendor: 'OpenAI', providers: ['copilot', 'codex'] },
	{ label: 'GPT-5.5', vendor: 'OpenAI', providers: ['copilot', 'codex'] },
	{ label: 'GPT-5.4', vendor: 'OpenAI', providers: ['copilot'] },
	{ label: 'GPT-5.4 mini', vendor: 'OpenAI', providers: ['copilot'] },
	{ label: 'GPT-5.4 nano', vendor: 'OpenAI', providers: ['copilot'] },
	{ label: 'GPT-5.3-Codex', vendor: 'OpenAI', providers: ['copilot'] },
	{ label: 'GPT-5 mini', vendor: 'OpenAI', providers: ['copilot'] },
	{ label: 'Claude Fable 5.1', vendor: 'Anthropic', providers: ['copilot', 'claude'] },
	{ label: 'Claude Fable 5', vendor: 'Anthropic', providers: ['copilot', 'claude'] },
	{ label: 'Claude Opus 5', vendor: 'Anthropic', providers: ['copilot', 'claude'] },
	{ label: 'Claude Sonnet 5', vendor: 'Anthropic', providers: ['copilot', 'claude'] },
	{ label: 'Claude Haiku 4.5', vendor: 'Anthropic', providers: ['copilot', 'claude'] },
	{ label: 'Claude Opus 4.8', vendor: 'Anthropic', providers: ['copilot', 'claude'] },
	{ label: 'Claude Opus 4.7', vendor: 'Anthropic', providers: ['copilot', 'claude'] },
	{ label: 'Claude Sonnet 4.6', vendor: 'Anthropic', providers: ['copilot', 'claude'] },
	{ label: 'Claude Opus 4.8 (fast mode) (preview)', vendor: 'Anthropic', providers: ['copilot'] },
	{ label: 'Gemini 3.8 Flash', vendor: 'Google', providers: ['copilot'] },
	{ label: 'Gemini 3.7 Flash', vendor: 'Google', providers: ['copilot'] },
	{ label: 'Gemini 3.6 Flash', vendor: 'Google', providers: ['copilot'] },
	{ label: 'Gemini 3.5 Flash', vendor: 'Google', providers: ['copilot'] },
	{ label: 'MAI-Code-1.1-Flash', vendor: 'Microsoft', providers: ['copilot'] },
	{ label: 'Kimi K3', vendor: 'Moonshot AI', providers: ['copilot'] },
	{ label: 'Kimi K2.7 Code', vendor: 'Moonshot AI', providers: ['copilot'] },
	{ label: 'Grok 4.6', vendor: 'xAI', providers: ['copilot'] },
	{ label: 'Grok 4.5', vendor: 'xAI', providers: ['copilot'] },
];

export function officialModelsForProvider(providerId: ProviderStatus['id']): readonly OfficialModel[] {
	return OFFICIAL_MODELS.filter((model) => model.providers.includes(providerId));
}

export function isModelOfferedByProvider(label: string, providerId: ProviderStatus['id']): boolean {
	return officialModelsForProvider(providerId).some((model) => model.label === label);
}
