import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import {
	addDirectPromptHook,
	addPromptHook,
	containsPromptHook,
	removeDirectPromptHook,
	removePromptHook,
} from './promptFeedProtocol';

export interface PromptHookFile {
	filePath: string;
	format: 'direct' | 'grouped';
	command: string;
}

interface HookFileSnapshot {
	file: PromptHookFile;
	existed: boolean;
	content: string;
	configuration: Record<string, unknown>;
}

export async function updatePromptHookFiles(
	files: readonly PromptHookFile[],
	connect: boolean,
): Promise<void> {
	const snapshots = await Promise.all(files.map(readSnapshot));
	const applied: HookFileSnapshot[] = [];

	try {
		for (const snapshot of snapshots) {
			if (!connect && !snapshot.existed) {
				continue;
			}

			const next = updateConfiguration(snapshot, connect);
			if (Object.keys(next).length === 0) {
				await fs.rm(snapshot.file.filePath, { force: true });
			} else {
				await writeAtomically(snapshot.file.filePath, `${JSON.stringify(next, null, 2)}\n`);
			}
			applied.push(snapshot);
		}
	} catch (error) {
		await Promise.allSettled(applied.reverse().map(restoreSnapshot));
		throw error;
	}
}

export async function arePromptHookFilesConnected(files: readonly PromptHookFile[]): Promise<boolean> {
	const statuses = await Promise.all(files.map(async (file) => {
		try {
			return containsPromptHook(JSON.parse(await fs.readFile(file.filePath, 'utf8')) as unknown);
		} catch {
			return false;
		}
	}));
	return statuses.every(Boolean);
}

async function readSnapshot(file: PromptHookFile): Promise<HookFileSnapshot> {
	try {
		const content = await fs.readFile(file.filePath, 'utf8');
		let parsed: unknown;
		try {
			parsed = JSON.parse(content) as unknown;
		} catch {
			throw new Error(`Cannot safely update ${file.filePath}; it is not valid JSON.`);
		}
		if (!isRecord(parsed)) {
			throw new Error(`Cannot safely update ${file.filePath}; it must contain a JSON object.`);
		}
		return { file, existed: true, content, configuration: parsed };
	} catch (error) {
		if (isFileMissing(error)) {
			return { file, existed: false, content: '', configuration: {} };
		}
		throw error;
	}
}

function updateConfiguration(snapshot: HookFileSnapshot, connect: boolean): Record<string, unknown> {
	if (snapshot.file.format === 'direct') {
		return connect
			? addDirectPromptHook(snapshot.configuration, snapshot.file.command)
			: removeDirectPromptHook(snapshot.configuration);
	}
	return connect
		? addPromptHook(snapshot.configuration, snapshot.file.command)
		: removePromptHook(snapshot.configuration);
}

async function restoreSnapshot(snapshot: HookFileSnapshot): Promise<void> {
	if (snapshot.existed) {
		await writeAtomically(snapshot.file.filePath, snapshot.content);
	} else {
		await fs.rm(snapshot.file.filePath, { force: true });
	}
}

async function writeAtomically(filePath: string, content: string): Promise<void> {
	// Write through a symlinked settings file (dotfile managers) instead of replacing the link,
	// and keep an existing file's permissions. New files are owner-only.
	let targetPath = filePath;
	let mode = 0o600;
	try {
		targetPath = await fs.realpath(filePath);
		mode = (await fs.stat(targetPath)).mode & 0o777;
	} catch (error) {
		if (!isFileMissing(error)) {
			throw error;
		}
	}
	await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
	const temporaryPath = `${targetPath}.${process.pid}-${randomUUID()}.tmp`;
	try {
		await fs.writeFile(temporaryPath, content, { encoding: 'utf8', mode, flag: 'wx' });
		await tryChmod(temporaryPath, mode);
		await fs.rename(temporaryPath, targetPath);
	} finally {
		await fs.rm(temporaryPath, { force: true });
	}
}

async function tryChmod(targetPath: string, mode: number): Promise<void> {
	try {
		await fs.chmod(targetPath, mode);
	} catch {
		// Filesystems without POSIX modes still receive atomic writes.
	}
}

function isFileMissing(error: unknown): boolean {
	return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}