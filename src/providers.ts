import * as vscode from 'vscode';

import { ProviderStatus } from './model';

interface ProviderDefinition extends Omit<ProviderStatus, 'installed'> {
	extensionIds: readonly string[];
}

export interface ProviderIconAsset {
	id: ProviderStatus['id'];
	iconUri: vscode.Uri;
	resourceRoot: vscode.Uri;
}

const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
	{
		id: 'copilot',
		name: 'GitHub Copilot',
		extensionIds: ['github.copilot-chat', 'github.copilot'],
	},
	{
		id: 'claude',
		name: 'Claude Code',
		extensionIds: ['anthropic.claude-code'],
	},
	{
		id: 'codex',
		name: 'OpenAI Codex',
		extensionIds: ['openai.chatgpt'],
	},
];

export function detectProviders(): ProviderStatus[] {
	return PROVIDER_DEFINITIONS.map((definition) => ({
		id: definition.id,
		name: definition.name,
		installed: findInstalledExtension(definition) !== undefined,
	}));
}

export function detectProviderIconAssets(): ProviderIconAsset[] {
	return PROVIDER_DEFINITIONS.flatMap((definition) => {
		const extension = findInstalledExtension(definition);
		const iconPath = getSafeIconPath(extension?.packageJSON);
		if (!extension || !iconPath) {
			return [];
		}

		return [{
			id: definition.id,
			iconUri: vscode.Uri.joinPath(extension.extensionUri, ...iconPath.split(/[\\/]/)),
			resourceRoot: extension.extensionUri,
		}];
	});
}

function findInstalledExtension(
	definition: ProviderDefinition,
): vscode.Extension<unknown> | undefined {
	return definition.extensionIds
		.map((extensionId) => vscode.extensions.getExtension(extensionId))
		.find((extension) => extension !== undefined);
}

export function getSafeIconPath(packageJson: unknown): string | undefined {
	if (typeof packageJson !== 'object' || packageJson === null) {
		return undefined;
	}

	const icon = (packageJson as { icon?: unknown }).icon;
	if (
		typeof icon !== 'string'
		|| icon.length === 0
		|| /^(?:[a-zA-Z]:[\\/]|[\\/])/.test(icon)
		|| icon.split(/[\\/]/).includes('..')
	) {
		return undefined;
	}

	return icon;
}