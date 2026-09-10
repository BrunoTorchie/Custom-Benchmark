import { ProviderStatus } from './model';

export interface PromptHandoff {
	commandId: string;
	commandArguments: readonly unknown[];
	harnessLabel: string;
	draftPrefilled: boolean;
}

export function getPromptHandoff(
	providerId: ProviderStatus['id'],
	prompt: string,
): PromptHandoff {
	switch (providerId) {
		case 'copilot':
			return {
				commandId: 'workbench.action.chat.open',
				commandArguments: [{ mode: 'agent', query: prompt, isPartialQuery: true }],
				harnessLabel: 'Copilot',
				draftPrefilled: true,
			};
		case 'claude':
			return {
				commandId: 'claude-vscode.editor.openLast',
				commandArguments: [],
				harnessLabel: 'Claude Code',
				draftPrefilled: false,
			};
		case 'codex':
			return {
				commandId: 'chatgpt.openSidebar',
				commandArguments: [],
				harnessLabel: 'Codex',
				draftPrefilled: false,
			};
	}
}