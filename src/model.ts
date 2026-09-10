export type CaptureMode = 'off' | 'capturing' | 'paused';

export interface ProviderStatus {
	id: 'copilot' | 'claude' | 'codex';
	name: string;
	installed: boolean;
}

export interface ProviderReadiness {
	installed: number;
	total: number;
	label: string;
}

export function deriveCaptureMode(enabled: boolean, paused: boolean): CaptureMode {
	if (!enabled) {
		return 'off';
	}

	return paused ? 'paused' : 'capturing';
}

export function getProviderReadiness(providers: readonly ProviderStatus[]): ProviderReadiness {
	const installed = providers.filter((provider) => provider.installed).length;
	const total = providers.length;

	return {
		installed,
		total,
		label: `${installed} of ${total} providers ready`,
	};
}