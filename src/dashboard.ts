import { randomBytes } from 'node:crypto';

import * as vscode from 'vscode';

import { createDashboardModel } from './dashboardModel';
import { providerIcons } from './generated/providerIcons';
import { CaptureMode, ProviderStatus } from './model';
import { detectProviderIconAssets } from './providers';
import { LiveRecommendation } from './recommendation';
import { RepositoryState } from './store';

export interface DashboardSnapshot {
	folder?: vscode.WorkspaceFolder;
	mode: CaptureMode;
	repositoryState?: RepositoryState;
	providers: readonly ProviderStatus[];
	recommendation?: LiveRecommendation;
	hasPendingDraft: boolean;
	promptFeedConnected: boolean;
}

const COMMAND_IDS: Readonly<Record<string, string>> = {
	enableRepository: 'personalBenchmark.enableRepository',
	pauseCapture: 'personalBenchmark.pauseCapture',
	resumeCapture: 'personalBenchmark.resumeCapture',
	recordPreviewEvent: 'personalBenchmark.recordPreviewEvent',
	reviewCandidates: 'personalBenchmark.reviewCandidates',
	runBenchmark: 'personalBenchmark.runBenchmark',
	openDataFolder: 'personalBenchmark.openDataFolder',
	disableRepository: 'personalBenchmark.disableRepository',
	deleteRepositoryData: 'personalBenchmark.deleteRepositoryData',
	refresh: 'personalBenchmark.refresh',
	openFolder: 'workbench.action.files.openFolder',
	analyzePrompt: 'personalBenchmark.analyzePrompt',
	openRecommendedHarness: 'personalBenchmark.openRecommendedHarness',
	connectLivePrompts: 'personalBenchmark.connectLivePrompts',
	disconnectLivePrompts: 'personalBenchmark.disconnectLivePrompts',
};

export class DashboardViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	private view?: vscode.WebviewView;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly getSnapshot: () => DashboardSnapshot,
	) {}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;

		this.disposables.push(
			view.webview.onDidReceiveMessage((message: unknown) => this.handleMessage(message)),
			view.onDidDispose(() => {
				this.view = undefined;
			}),
		);
		this.refresh();
	}

	refresh(): void {
		if (!this.view) {
			return;
		}

		const snapshot = this.getSnapshot();
		const model = createDashboardModel({
			repositoryName: snapshot.folder?.name,
			mode: snapshot.mode,
			eventCount: snapshot.repositoryState?.eventCount ?? 0,
			providers: snapshot.providers,
		});
		const iconUri = this.view.webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'resources', 'icon.png'),
		);
		const providerAssets = detectProviderIconAssets();
		this.view.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, 'resources'),
				...providerAssets.map((asset) => asset.resourceRoot),
			],
		};
		const providerIconUris = Object.fromEntries(providerAssets.map((asset) => [
			asset.id,
			this.view!.webview.asWebviewUri(asset.iconUri),
		])) as Partial<Record<ProviderStatus['id'], vscode.Uri>>;
		this.view.webview.html = renderDashboard(
			this.view.webview,
			model,
			iconUri,
			providerIconUris,
			snapshot.recommendation,
			snapshot.promptFeedConnected,
			snapshot.folder !== undefined,
		);
	}

	dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	private handleMessage(message: unknown): void {
		if (!isCommandMessage(message)) {
			return;
		}

		const commandId = COMMAND_IDS[message.command];
		if (commandId) {
			const args = message.command === 'analyzePrompt' && message.prompt
				? [message.prompt]
				: [];
			void vscode.commands.executeCommand(commandId, ...args);
		}
	}
}

interface CommandMessage {
	type: 'command';
	command: string;
	prompt?: string;
}

function isCommandMessage(message: unknown): message is CommandMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}

	const candidate = message as Partial<CommandMessage>;
	return candidate.type === 'command'
		&& typeof candidate.command === 'string'
		&& (candidate.prompt === undefined
			|| (typeof candidate.prompt === 'string' && candidate.prompt.length <= 100_000));
}

export function renderDashboard(
	webview: vscode.Webview,
	model: ReturnType<typeof createDashboardModel>,
	iconUri: vscode.Uri,
	providerIconUris: Partial<Record<ProviderStatus['id'], vscode.Uri>>,
	recommendation: LiveRecommendation | undefined,
	promptFeedConnected: boolean,
	hasFolder: boolean,
	hasPendingDraft = false,
): string {
	const nonce = randomBytes(16).toString('base64');
	const repositoryName = escapeHtml(model.repositoryName);
	const primaryCommand = hasFolder ? model.primaryAction.command : 'openFolder';
	const primaryLabel = hasFolder ? model.primaryAction.label : 'Open a folder';
	const secondaryAction = model.secondaryAction
		? `<button class="button button--secondary" data-command="${model.secondaryAction.command}" title="${escapeHtml(model.secondaryAction.label)}" aria-label="${escapeHtml(model.secondaryAction.label)}"><span class="button__icon" aria-hidden="true">Ⅱ</span><span class="button__label">${escapeHtml(model.secondaryAction.label)}</span></button>`
		: '';
	const providerRows = model.providers.map((provider) => {
		const providerClass = provider.installed ? 'source--detected' : 'source--missing';
		const providerStatus = provider.installed
			? (promptFeedConnected ? 'Detected · post-submit capture connected' : 'Detected · post-submit capture available')
			: 'Not installed';
		const providerMark = renderProviderMark(provider.id, providerIconUris[provider.id]);
		return `
			<div class="source ${providerClass}" title="${escapeHtml(provider.name)} · ${providerStatus}">
				<span class="source__mark" aria-hidden="true">${providerMark}</span>
				<strong>${providerShortName(provider.id)}</strong>
				<span class="source__dot" title="${provider.installed ? 'Extension detected' : 'Extension not detected'}"></span>
			</div>`;
	}).join('');
	const canUseDataActions = hasFolder && (model.mode !== 'off' || model.eventCount > 0);
	const reviewQueue = model.eventCount > 0
		? {
			summary: `${model.eventCount} captured`,
			title: 'Review captured activity',
			subtitle: 'Inspect the local ledger; no cases yet',
		}
		: {
			summary: '0 pending',
			title: 'No candidates yet',
			subtitle: 'Waiting for verified episodes',
		};
	const recommendationSection = renderRecommendation(
		recommendation,
		providerIconUris,
		promptFeedConnected,
		hasFolder,
		hasPendingDraft,
	);

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<title>Personal Benchmark</title>
	<style>
		:root {
			/* TechTorch brand. The mark and wordmark are monochrome #252b38. */
			--brand: #252b38;
			--brand-deep: #1b202a;
			--brand-light: #4b5567;
			--surface: #f7f8fa;
			/* Text and rules that sit on a brand-coloured surface. */
			--on-brand: #f7f8fa;
			--on-brand-dim: rgba(247, 248, 250, 0.62);
			/* Interactive accent is inherited from the editor theme, so contrast
			   holds in both light and dark VS Code themes. */
			--accent: var(--vscode-textLink-foreground, #3794ff);
			--accent-hover: var(--vscode-textLink-activeForeground, var(--accent));
			--success: #55b879;
			--warning: #d3a653;
			--line: var(--vscode-sideBarSectionHeader-border, rgba(128, 128, 128, 0.22));
		}

		* { box-sizing: border-box; }
		html, body { min-width: 210px; }
		body {
			margin: 0;
			color: var(--vscode-foreground);
			background: var(--vscode-sideBar-background);
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			line-height: 1.35;
		}
		button { font: inherit; letter-spacing: 0; }
		button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }

		.brand {
			position: relative;
			padding: 12px 12px 10px;
			color: var(--surface);
			background: var(--brand-deep);
			border-bottom: 2px solid var(--on-brand-dim);
			overflow: hidden;
		}
		.brand::after {
			content: '';
			position: absolute;
			right: -18px;
			bottom: -28px;
			width: 96px;
			height: 58px;
			border: 1px solid rgba(247, 248, 250, 0.18);
			transform: rotate(-8deg);
		}
		.brand__row { position: relative; z-index: 1; display: flex; align-items: center; gap: 8px; }
		.brand__mark { width: 38px; height: 38px; flex: 0 0 38px; border-radius: 5px; box-shadow: 0 5px 14px rgba(0, 0, 0, 0.24); }
		.brand__copy { min-width: 0; flex: 1; }
		.brand__eyebrow { display: block; margin-bottom: 1px; color: var(--on-brand-dim); font-size: 8px; font-weight: 700; letter-spacing: 0; }
		.brand h1 { margin: 0; font-size: 13px; font-weight: 650; letter-spacing: 0; white-space: nowrap; }
		.icon-button {
			position: relative;
			z-index: 1;
			width: 26px;
			height: 26px;
			flex: 0 0 26px;
			padding: 0;
			color: var(--surface);
			background: transparent;
			border: 1px solid rgba(247, 248, 250, 0.28);
			border-radius: 4px;
			font-size: 16px;
			line-height: 23px;
			cursor: pointer;
		}
		.icon-button:hover { background: rgba(247, 248, 250, 0.1); border-color: var(--on-brand-dim); }
		.brand-rule { position: relative; z-index: 1; width: 68px; height: 4px; margin-top: 9px; background: repeating-linear-gradient(90deg, var(--on-brand-dim) 0 8px, transparent 8px 12px); opacity: 0.85; }

		.capture { padding: 13px 12px 12px; border-bottom: 1px solid var(--line); }
		.capture__top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
		.status { display: inline-flex; align-items: center; gap: 6px; color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 650; }
		.status__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-descriptionForeground); box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-descriptionForeground) 18%, transparent); }
		.status--capturing .status__dot { background: var(--success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 18%, transparent); }
		.status--paused .status__dot { background: var(--warning); box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning) 18%, transparent); }
		.repository { min-width: 0; color: var(--vscode-descriptionForeground); font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.capture h2 { margin: 9px 0 3px; color: var(--vscode-foreground); font-size: 18px; line-height: 1.15; font-weight: 650; letter-spacing: 0; overflow-wrap: anywhere; }
		.capture__subline { margin: 0 0 10px; color: var(--vscode-descriptionForeground); font-size: 10px; }
		.action-row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 7px; }
		.action-row:has(.button--secondary) { grid-template-columns: minmax(0, 1fr) auto; }
		.button {
			min-height: 32px;
			padding: 6px 10px;
			border-radius: 4px;
			cursor: pointer;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.button--primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 1px solid var(--vscode-button-background); font-weight: 700; }
		.button--primary:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); border-color: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
		.button--secondary { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 32px; color: var(--vscode-foreground); background: transparent; border: 1px solid var(--vscode-button-secondaryBackground, var(--line)); }
		.button--secondary:hover { background: var(--vscode-list-hoverBackground); }
		.button__icon { font-size: 12px; line-height: 1; }
		.privacy { display: flex; align-items: center; gap: 6px; margin-top: 9px; padding-left: 7px; border-left: 2px solid var(--brand-light); color: var(--vscode-descriptionForeground); font-size: 9px; }
		.privacy strong { color: var(--vscode-foreground); font-size: 9px; }

		.recommendation { padding: 11px 12px; background: color-mix(in srgb, var(--brand) 13%, var(--vscode-sideBar-background)); border-bottom: 1px solid var(--line); box-shadow: inset 2px 0 0 var(--accent); }
		.recommendation__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
		.recommendation__head h3 { margin: 0; color: var(--vscode-foreground); font-size: 10px; font-weight: 750; letter-spacing: 0; }
		.live-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 5px; color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent); border-radius: 3px; font-size: 8px; font-weight: 750; }
		.live-badge::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
		.live-badge--connected { color: var(--success); }
		.recommendation__top { display: flex; align-items: center; gap: 9px; min-width: 0; }
		.recommendation__mark { display: grid; place-items: center; width: 34px; height: 34px; flex: 0 0 34px; color: var(--surface); background: var(--brand-deep); border: 1px solid var(--brand-light); border-radius: 50%; font-size: 10px; font-weight: 800; }
		.recommendation__mark .source__logo { width: 22px; height: 22px; }
		.recommendation__mark .source__logo--codex { width: 20px; height: 20px; }
		.recommendation__model { min-width: 0; flex: 1; }
		.recommendation__model small, .recommendation__model strong, .recommendation__model span { display: block; }
		.recommendation__model small { color: var(--accent); font-size: 8px; font-weight: 750; }
		.recommendation__model strong { margin-top: 1px; color: var(--vscode-foreground); font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.recommendation__model span { margin-top: 1px; color: var(--vscode-descriptionForeground); font-size: 9px; }
		.confidence { flex: 0 0 auto; color: var(--vscode-foreground); font-size: 14px; font-weight: 650; }
		.confidence small { display: block; color: var(--vscode-descriptionForeground); font-size: 7px; font-weight: 600; text-align: right; }
		.recommendation__meta { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
		.chip { padding: 2px 5px; color: var(--vscode-descriptionForeground); background: var(--vscode-list-hoverBackground); border-radius: 3px; font-size: 8px; }
		.chip--harness { color: var(--vscode-foreground); }
		.recommendation__reason { display: -webkit-box; margin: 7px 0 0; color: var(--vscode-foreground); font-size: 9px; line-height: 1.35; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
		.recommendation__basis { display: -webkit-box; margin: 5px 0 0; color: var(--vscode-descriptionForeground); font-size: 8px; line-height: 1.35; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
		.recommendation__prompt { margin: 7px 0 0; padding-left: 7px; color: var(--vscode-descriptionForeground); border-left: 1px solid var(--accent); font-size: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.recommendation__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
		.recommendation__launch { min-width: 0; flex: 1 1 130px; }
		.link-button { padding: 0; color: var(--accent); background: transparent; border: 0; font-size: 9px; cursor: pointer; }
		.link-button:hover { color: var(--accent-hover); text-decoration: underline; }
		.recommendation__empty { margin: 0; color: var(--vscode-descriptionForeground); font-size: 9px; line-height: 1.4; }
		.recommendation__empty strong { display: block; margin-bottom: 2px; color: var(--vscode-foreground); font-size: 11px; }
		.draft-form { display: grid; gap: 7px; }
		.draft-input {
			width: 100%;
			min-height: 68px;
			max-height: 150px;
			padding: 7px 8px;
			resize: vertical;
			color: var(--vscode-input-foreground);
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border, var(--line));
			border-radius: 4px;
			font: inherit;
			font-size: 10px;
			letter-spacing: 0;
		}
		.draft-input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
		.draft-input::placeholder { color: var(--vscode-input-placeholderForeground); }
		.draft-submit { width: 100%; }
		.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

		.workflow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-bottom: 1px solid var(--line); }
		.workflow__step { min-width: 0; padding: 8px 4px 7px; color: var(--vscode-disabledForeground); background: transparent; border: 0; border-right: 1px solid var(--line); text-align: center; cursor: pointer; }
		.workflow__step:last-child { border-right: 0; }
		.workflow__step:hover { color: var(--vscode-foreground); background: var(--vscode-list-hoverBackground); }
		.workflow__step strong { display: block; margin-bottom: 2px; color: inherit; font-size: 9px; font-weight: 700; }
		.workflow__step span { display: block; font-size: 10px; overflow: hidden; text-overflow: ellipsis; }
		.workflow__step--active { color: var(--vscode-foreground); box-shadow: inset 0 -2px 0 var(--accent); }

		.metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 9px 6px; border-bottom: 1px solid var(--line); }
		.metric { min-width: 0; padding: 0 6px; border-right: 1px solid var(--line); }
		.metric:last-child { border-right: 0; }
		.metric strong { display: block; color: var(--vscode-foreground); font-size: 16px; line-height: 1.1; font-weight: 650; }
		.metric span { display: block; margin-top: 3px; color: var(--vscode-descriptionForeground); font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

		.section { padding: 11px 12px; border-bottom: 1px solid var(--line); }
		.section__head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
		.section__head h3 { margin: 0; color: var(--vscode-foreground); font-size: 11px; font-weight: 700; letter-spacing: 0; }
		.section__head span { color: var(--vscode-descriptionForeground); font-size: 10px; }
		.sources { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
		.source { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; min-width: 0; min-height: 54px; padding: 7px 3px 6px; background: color-mix(in srgb, var(--vscode-list-hoverBackground) 55%, transparent); border: 1px solid var(--line); border-radius: 4px; }
		.source:hover { background: var(--vscode-list-hoverBackground); }
		.source__mark { display: grid; place-items: center; width: 25px; height: 25px; color: var(--accent); background: color-mix(in srgb, var(--brand) 38%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 48%, transparent); border-radius: 50%; font-size: 8px; font-weight: 800; }
		.source__logo { display: block; width: 17px; height: 17px; object-fit: contain; mix-blend-mode: screen; }
		.source__logo--copilot { width: 18px; height: 18px; filter: grayscale(1) invert(1) contrast(160%); }
		.source__logo--claude { width: 18px; height: 18px; filter: brightness(0) invert(1); }
		.source__logo--codex { width: 16px; height: 16px; }
		.source strong { max-width: 100%; color: var(--vscode-foreground); font-size: 9px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.source__dot { position: absolute; top: 6px; right: 6px; width: 6px; height: 6px; border-radius: 50%; background: var(--vscode-descriptionForeground); }
		.source--detected .source__dot { background: var(--success); }
		.sources-note { margin: 7px 0 0; color: var(--vscode-descriptionForeground); font-size: 9px; text-align: center; }

		.queue { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 44px; padding: 5px; color: inherit; background: transparent; border: 0; border-radius: 4px; text-align: left; cursor: pointer; }
		.queue:hover { background: var(--vscode-list-hoverBackground); }
		.queue__glyph { display: grid; place-items: center; width: 30px; height: 30px; flex: 0 0 30px; color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent); border-radius: 50%; font-size: 9px; font-weight: 700; }
		.queue__copy { min-width: 0; }
		.queue__copy strong, .queue__copy span { display: block; }
		.queue__copy strong { color: var(--vscode-foreground); font-size: 11px; font-weight: 600; }
		.queue__copy span { margin-top: 2px; color: var(--vscode-descriptionForeground); font-size: 9px; }
		.queue__arrow { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 17px; }

		.footer-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--line); border-bottom: 1px solid var(--line); }
		.text-action { min-width: 0; min-height: 32px; padding: 6px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); border: 0; cursor: pointer; font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.text-action:hover:not(:disabled) { color: var(--accent); background: var(--vscode-list-hoverBackground); }
		.text-action:disabled { color: var(--vscode-disabledForeground); cursor: default; }
		.footer { padding: 6px 12px 8px; color: var(--vscode-descriptionForeground); font-size: 8px; text-align: center; }

		@media (max-width: 245px) {
			.brand { padding-inline: 10px; }
			.capture, .section { padding-inline: 10px; }
			.brand__mark { width: 32px; height: 32px; flex-basis: 32px; }
			.brand h1 { font-size: 12px; }
			.icon-button { width: 24px; height: 24px; flex-basis: 24px; line-height: 21px; }
			.button--secondary .button__label { display: none; }
		}
		@media (max-height: 680px) {
			.metrics, .section--review { display: none; }
			.section--sources { padding: 7px 10px; }
			.section--sources .section__head { margin-bottom: 6px; }
			.section--sources .source { min-height: 46px; padding-block: 4px; gap: 3px; }
			.section--sources .source__mark { width: 22px; height: 22px; }
			.section--sources .source__logo { width: 15px; height: 15px; }
			.section--sources .sources-note { display: none; }
			.footer { padding-block: 4px 5px; }
		}
	</style>
</head>
<body>
	<header class="brand">
		<div class="brand__row">
			<img class="brand__mark" src="${iconUri}" alt="Personal Benchmark">
			<div class="brand__copy">
				<span class="brand__eyebrow">A TECHTORCH INITIATIVE</span>
				<h1>Personal Benchmark</h1>
			</div>
			<button class="icon-button" data-command="refresh" title="Refresh dashboard" aria-label="Refresh dashboard">↻</button>
		</div>
		<div class="brand-rule" aria-hidden="true"></div>
	</header>

	<main>
		<section class="capture">
			<div class="capture__top">
				<span class="status status--${model.mode}"><span class="status__dot"></span>${escapeHtml(model.statusLabel)}</span>
				<span class="repository" title="${repositoryName}">${repositoryName}</span>
			</div>
			<h2>${escapeHtml(model.headline)}</h2>
			<p class="capture__subline">${hasFolder ? 'Current folder' : 'Workspace required'}</p>
			<div class="action-row">
				<button class="button button--primary" data-command="${primaryCommand}">${escapeHtml(primaryLabel)}</button>
				${secondaryAction}
			</div>
			<div class="privacy"><strong>LOCAL ONLY</strong><span>Redacted before write</span></div>
		</section>

		${recommendationSection}

		<nav class="workflow" aria-label="Benchmark workflow">
			<button class="workflow__step workflow__step--active" data-command="${primaryCommand}" aria-current="step"><strong>01</strong><span>Capture</span></button>
			<button class="workflow__step" data-command="reviewCandidates"><strong>02</strong><span>Review</span></button>
			<button class="workflow__step" data-command="runBenchmark"><strong>03</strong><span>Benchmark</span></button>
		</nav>

		<section class="metrics" aria-label="Corpus totals">
			<div class="metric"><strong>${model.eventCount}</strong><span>EVENTS</span></div>
			<div class="metric"><strong>0</strong><span>REVIEW</span></div>
			<div class="metric"><strong>0</strong><span>CASES</span></div>
		</section>

		<section class="section section--sources">
			<div class="section__head"><h3>AI SOURCES</h3><span>${model.providerSummary}</span></div>
			<div class="sources">${providerRows}</div>
			<p class="sources-note">${promptFeedConnected ? 'Post-submit capture connected locally' : 'Optional post-submit capture'}</p>
		</section>

		<section class="section section--review">
			<div class="section__head"><h3>REVIEW QUEUE</h3><span>${escapeHtml(reviewQueue.summary)}</span></div>
			<button class="queue" data-command="reviewCandidates">
				<span class="queue__glyph" aria-hidden="true">02</span>
				<span class="queue__copy"><strong>${escapeHtml(reviewQueue.title)}</strong><span>${escapeHtml(reviewQueue.subtitle)}</span></span>
				<span class="queue__arrow" aria-hidden="true">›</span>
			</button>
		</section>

		<div class="footer-actions">
			<button class="text-action" data-command="openDataFolder" ${hasFolder ? '' : 'disabled'}>Open local data</button>
			<button class="text-action" data-command="deleteRepositoryData" ${canUseDataActions ? '' : 'disabled'}>Delete folder data</button>
		</div>
	</main>
	<footer class="footer">BRUNO MANZANO · TECHTORCH</footer>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const draftForm = document.querySelector('[data-draft-form]');
		const draftInput = document.querySelector('[data-draft-input]');
		const draftSubmit = document.querySelector('[data-draft-submit]');
		const syncDraftSubmit = () => {
			if (draftInput && draftSubmit) draftSubmit.disabled = draftInput.value.trim() === '';
		};
		draftInput?.addEventListener('input', syncDraftSubmit);
		draftForm?.addEventListener('submit', (event) => {
			event.preventDefault();
			const prompt = draftInput?.value.trim();
			if (!prompt || !draftSubmit) return;
			draftSubmit.disabled = true;
			draftSubmit.textContent = 'Analyzing...';
			vscode.postMessage({ type: 'command', command: 'analyzePrompt', prompt });
		});
		document.addEventListener('click', (event) => {
			const button = event.target.closest('[data-command]');
			if (!button || button.disabled) return;
			vscode.postMessage({ type: 'command', command: button.dataset.command });
		});
	</script>
</body>
</html>`;
}

function providerInitials(providerId: ProviderStatus['id']): string {
	switch (providerId) {
		case 'copilot': return 'GH';
		case 'claude': return 'C';
		case 'codex': return 'O';
	}
}

function renderProviderMark(
	providerId: ProviderStatus['id'],
	providerIconUri: vscode.Uri | undefined,
): string {
	if (providerId === 'claude') {
		const icon = providerIcons['claude-icon'];
		return `<svg class="source__logo source__logo--claude" data-provider-icon="claude" viewBox="${icon.left} ${icon.top} ${icon.width} ${icon.height}" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${icon.body}</svg>`;
	}

	return providerIconUri
		? `<img class="source__logo source__logo--${providerId}" src="${providerIconUri}" alt="">`
		: providerInitials(providerId);
}

function renderRecommendation(
	recommendation: LiveRecommendation | undefined,
	providerIconUris: Partial<Record<ProviderStatus['id'], vscode.Uri>>,
	promptFeedConnected: boolean,
	hasFolder: boolean,
	hasPendingDraft: boolean,
): string {
	const badgeClass = promptFeedConnected ? 'live-badge live-badge--connected' : 'live-badge';
	const badgeLabel = hasPendingDraft
		? 'READY'
		: (recommendation ? 'POST-SUBMIT' : 'DRAFT');
	if (!recommendation) {
		return `
		<section class="recommendation" aria-label="Preflight model recommendation">
			<div class="recommendation__head"><h3>BEFORE YOU SEND</h3><span class="${badgeClass}">${badgeLabel}</span></div>
			<form class="draft-form" data-draft-form>
				<label class="visually-hidden" for="prompt-draft">Task prompt</label>
				<textarea id="prompt-draft" class="draft-input" data-draft-input maxlength="100000" placeholder="Describe the task you are about to send" ${hasFolder ? '' : 'disabled'}></textarea>
				<button class="button button--primary draft-submit" data-draft-submit type="submit" disabled>Recommend before sending</button>
			</form>
			<div class="recommendation__actions">
				<button class="link-button" data-command="${promptFeedConnected ? 'disconnectLivePrompts' : 'connectLivePrompts'}" ${hasFolder ? '' : 'disabled'}>${promptFeedConnected ? 'Disconnect feed' : 'Connect live feed'}</button>
			</div>
		</section>`;
	}

	const providerMark = renderProviderMark(
		recommendation.providerId,
		providerIconUris[recommendation.providerId],
	);
	const sourceLabel = recommendation.source === 'manual'
		? 'Manual prompt'
		: `From ${promptSourceLabel(recommendation.source)}`;
	const selectionBasis = recommendation.modelSelectionBasis ?? 'artificial-analysis-heuristic';
	const selectionBasisLabel = modelSelectionBasisLabel(selectionBasis);
	const selectionNote = recommendation.modelSelectionNote
		?? 'Registered Personal Benchmark results are still being generated; this model uses the Artificial Analysis heuristic fallback.';
	const recommendationHeading = hasPendingDraft ? 'READY TO ROUTE' : 'POST-SUBMIT ANALYSIS';
	const primaryAction = hasPendingDraft
		? `<button class="button button--primary recommendation__launch" data-command="openRecommendedHarness">Copy &amp; open ${escapeHtml(providerShortName(recommendation.providerId))}</button>`
		: '<button class="button button--primary recommendation__launch" data-command="analyzePrompt">Draft before sending</button>';

	return `
	<section class="recommendation" aria-label="Model recommendation">
		<div class="recommendation__head"><h3>${recommendationHeading}</h3><span class="${badgeClass}">${badgeLabel}</span></div>
		<div class="recommendation__top">
			<span class="recommendation__mark" aria-hidden="true">${providerMark}</span>
			<span class="recommendation__model" data-recommendation-field="model"><small>MODEL</small><strong>${escapeHtml(recommendation.modelLabel)}</strong><span>${escapeHtml(recommendation.profileLabel)}</span></span>
			<span class="confidence">${recommendation.confidence}%<small>CONFIDENCE</small></span>
		</div>
		<div class="recommendation__meta"><span class="chip chip--harness" data-recommendation-field="harness">HARNESS · ${escapeHtml(providerShortName(recommendation.providerId))}</span><span class="chip" data-recommendation-field="basis">MODEL · ${escapeHtml(selectionBasisLabel)}</span><span class="chip">${escapeHtml(recommendation.taskType)}</span><span class="chip">${escapeHtml(sourceLabel)}</span></div>
		<p class="recommendation__reason" title="${escapeHtml(recommendation.reason)}">${escapeHtml(recommendation.reason)}</p>
		<p class="recommendation__basis" title="${escapeHtml(selectionNote)}">${escapeHtml(selectionNote)}</p>
		<p class="recommendation__prompt" title="${escapeHtml(recommendation.promptPreview)}">“${escapeHtml(recommendation.promptPreview)}”</p>
		<div class="recommendation__actions">
			${primaryAction}
			<button class="link-button" data-command="analyzePrompt">Analyze another</button>
		</div>
	</section>`;
}

function modelSelectionBasisLabel(basis: NonNullable<LiveRecommendation['modelSelectionBasis']>): string {
	switch (basis) {
		case 'explicit-request': return 'PROMPT REQUEST';
		case 'registered-benchmark': return 'LOCAL RESULTS';
		case 'artificial-analysis-heuristic': return 'AA HEURISTIC';
	}
}

function promptSourceLabel(source: LiveRecommendation['source']): string {
	switch (source) {
		case 'manual': return 'manual input';
		case 'vscode': return 'VS Code Chat';
		case 'claude': return 'Claude Code';
		case 'codex': return 'Codex';
	}
}

function providerShortName(providerId: ProviderStatus['id']): string {
	switch (providerId) {
		case 'copilot': return 'Copilot';
		case 'claude': return 'Claude';
		case 'codex': return 'Codex';
	}
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');
}