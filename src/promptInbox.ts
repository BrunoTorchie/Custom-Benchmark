import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { PromptInboxItem } from './promptFeedProtocol';
import { RECOMMENDATION_ENGINE_VERSION } from './recommendation';

const CLAIM_STALE_MS = 10_000;
const CLAIM_MARKER = '.json.processing-';

export async function drainPromptInbox(
	inboxDirectory: string,
	onPrompt: (item: PromptInboxItem) => Promise<boolean>,
): Promise<void> {
	let fileNames: string[];
	try {
		fileNames = await fs.readdir(inboxDirectory);
	} catch (error) {
		if (isFileMissing(error)) {
			return;
		}
		throw error;
	}

	await recoverInterruptedClaims(inboxDirectory, fileNames);
	fileNames = (await fs.readdir(inboxDirectory)).filter((name) => name.endsWith('.json')).sort();
	for (const fileName of fileNames) {
		await processInboxFile(inboxDirectory, fileName, onPrompt);
	}
}

async function processInboxFile(
	inboxDirectory: string,
	fileName: string,
	onPrompt: (item: PromptInboxItem) => Promise<boolean>,
): Promise<void> {
	const originalPath = path.join(inboxDirectory, fileName);
	const claimedPath = `${originalPath}.processing-${process.pid}-${randomUUID()}`;
	try {
		await fs.rename(originalPath, claimedPath);
	} catch {
		return;
	}

	let item: PromptInboxItem;
	try {
		const parsed = JSON.parse(await fs.readFile(claimedPath, 'utf8')) as unknown;
		if (!isPromptInboxItem(parsed)) {
			await fs.rm(claimedPath, { force: true });
			return;
		}
		item = parsed;
	} catch {
		await fs.rm(claimedPath, { force: true });
		return;
	}

	try {
		if (await onPrompt(item)) {
			await fs.rm(claimedPath, { force: true });
		} else {
			await restoreClaim(claimedPath, originalPath);
		}
	} catch {
		await restoreClaim(claimedPath, originalPath);
	}
}

async function recoverInterruptedClaims(inboxDirectory: string, fileNames: readonly string[]): Promise<void> {
	for (const fileName of fileNames) {
		const markerIndex = fileName.indexOf(CLAIM_MARKER);
		if (markerIndex < 0) {
			continue;
		}

		const claimedPath = path.join(inboxDirectory, fileName);
		try {
			const stats = await fs.stat(claimedPath);
			if (Date.now() - stats.mtimeMs < CLAIM_STALE_MS) {
				continue;
			}
			const originalPath = path.join(inboxDirectory, fileName.slice(0, markerIndex + '.json'.length));
			await restoreClaim(claimedPath, originalPath);
		} catch {
			// Another extension host may still own or recover this claim.
		}
	}
}

async function restoreClaim(claimedPath: string, originalPath: string): Promise<void> {
	try {
		await fs.link(claimedPath, originalPath);
		await fs.rm(claimedPath, { force: true });
	} catch (error) {
		if (isAlreadyExists(error)) {
			await fs.rm(claimedPath, { force: true });
			return;
		}
		throw error;
	}
}

function isPromptInboxItem(value: unknown): value is PromptInboxItem {
	if (!isRecord(value)) {
		return false;
	}
	return value.schemaVersion === 1
		&& typeof value.id === 'string'
		&& value.id.length > 0
		&& typeof value.cwd === 'string'
		&& !('prompt' in value)
		&& (value.source === 'vscode' || value.source === 'claude' || value.source === 'codex')
		&& typeof value.receivedAt === 'string'
		&& !Number.isNaN(Date.parse(value.receivedAt))
		&& Number.isInteger(value.replacementCount)
		&& Number(value.replacementCount) >= 0
		&& isRecommendation(value.recommendation, value.source);
}

function isRecommendation(value: unknown, source: PromptInboxItem['source']): boolean {
	if (!isRecord(value)) {
		return false;
	}
	return value.engineVersion === RECOMMENDATION_ENGINE_VERSION
		&& value.source === source
		&& (value.providerId === 'copilot' || value.providerId === 'claude' || value.providerId === 'codex')
		&& typeof value.modelProfileId === 'string'
		&& value.modelProfileId.length > 0
		&& typeof value.modelLabel === 'string'
		&& typeof value.profileLabel === 'string'
		&& (value.modelSelectionBasis === 'explicit-request'
			|| value.modelSelectionBasis === 'registered-benchmark'
			|| value.modelSelectionBasis === 'artificial-analysis-heuristic')
		&& typeof value.modelSelectionNote === 'string'
		&& isTaskType(value.taskType)
		&& typeof value.confidence === 'number'
		&& value.confidence >= 0
		&& value.confidence <= 100
		&& typeof value.reason === 'string'
		&& Array.isArray(value.signals)
		&& value.signals.every((signal) => typeof signal === 'string')
		&& typeof value.promptPreview === 'string'
		&& value.promptPreview.length <= 180
		&& typeof value.promptHash === 'string'
		&& /^[a-f0-9]{64}$/.test(value.promptHash)
		&& typeof value.analyzedAt === 'string'
		&& !Number.isNaN(Date.parse(value.analyzedAt))
		&& typeof value.fallbackApplied === 'boolean';
}

function isTaskType(value: unknown): boolean {
	return value === 'Architecture'
		|| value === 'Debugging'
		|| value === 'Implementation'
		|| value === 'Review'
		|| value === 'Research'
		|| value === 'Quick task';
}

function isFileMissing(error: unknown): boolean {
	return isNodeError(error) && error.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
	return isNodeError(error) && error.code === 'EEXIST';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === 'object' && error !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}