import { CaptureMode, ProviderStatus } from './model';

export type DashboardCommand =
	| 'enableRepository'
	| 'pauseCapture'
	| 'resumeCapture'
	| 'recordPreviewEvent';

export interface DashboardAction {
	label: string;
	command: DashboardCommand;
}

export interface DashboardModelInput {
	repositoryName?: string;
	mode: CaptureMode;
	eventCount: number;
	providers: readonly ProviderStatus[];
}

export interface DashboardModel {
	repositoryName: string;
	statusLabel: string;
	headline: string;
	primaryAction: DashboardAction;
	secondaryAction?: DashboardAction;
	eventCount: number;
	providerSummary: string;
	providers: readonly ProviderStatus[];
	mode: CaptureMode;
}

export function createDashboardModel(input: DashboardModelInput): DashboardModel {
	const detectedProviders = input.providers.filter((provider) => provider.installed).length;
	const shared = {
		repositoryName: input.repositoryName ?? 'No folder open',
		eventCount: input.eventCount,
		providerSummary: `${detectedProviders} detected`,
		providers: input.providers,
		mode: input.mode,
	};

	switch (input.mode) {
		case 'capturing':
			return {
				...shared,
				statusLabel: 'Preview active',
				headline: 'Local ledger ready',
				primaryAction: {
					label: 'Run capture check',
					command: 'recordPreviewEvent',
				},
				secondaryAction: {
					label: 'Pause',
					command: 'pauseCapture',
				},
			};
		case 'paused':
			return {
				...shared,
				statusLabel: 'Preview paused',
				headline: 'Local ledger paused',
				primaryAction: {
					label: 'Resume capture',
					command: 'resumeCapture',
				},
			};
		case 'off':
			return {
				...shared,
				statusLabel: 'Capture off',
				headline: 'Private by default',
				primaryAction: {
					label: 'Enable for this folder',
					command: 'enableRepository',
				},
			};
	}
}