import * as Y from "yjs";
import { getDeviceId } from "@/lib/device-id";
import { getNotesEngine } from "@/lib/notes-engine";
import type { WorkspaceItem, WorkspaceNote } from "@/lib/storage/types";
import {
	appendSharedUpdate,
	createSharedSpace,
	humanizeShareError,
	listSharedNotes,
	listSharedUpdates,
	upsertSharedNote,
	writeSharedSnapshot,
} from "@/lib/sync-provider";
import { parentPath } from "@/lib/workspace-paths";

export { getDeviceId };

export type CloudSyncStatus =
	| "local"
	| "linking"
	| "live"
	| "pending"
	| "error";

function collectSpaceNotes(items: WorkspaceItem[], out: WorkspaceNote[]) {
	for (const item of items) {
		if (item.type === "note") {
			out.push(item);
			continue;
		}
		collectSpaceNotes(item.children, out);
	}
}

export async function collectLocalSpaceNotes(spacePath: string) {
	const engine = getNotesEngine();
	if (!engine) throw new Error("Notes engine is not available.");
	const workspace = await engine.getWorkspace();
	const space = workspace.spaces.find((s) => s.path === spacePath);
	if (!space) throw new Error("Space not found.");
	const notes: WorkspaceNote[] = [];
	collectSpaceNotes(space.children, notes);
	return { engine, spaceTitle: space.title, notes };
}

/**
 * One-shot share (plan 019, Step 3).
 * Order: metadata first, content second, mapping last (caller saves it).
 * Images/asset binaries stay local — note rows carry path + title, Yjs text syncs.
 */
export async function shareSpaceToCloud(spacePath: string): Promise<{
	spaceId: string;
	noteCount: number;
}> {
	const { engine, spaceTitle, notes } = await collectLocalSpaceNotes(spacePath);
	const deviceId = getDeviceId();

	try {
		// createSharedSpace lives INSIDE the try so limit/auth failures flow
		// through humanizeShareError (plan 020 Step 0) — never raw [CONV …].
		const { spaceId } = await createSharedSpace(spaceTitle, spacePath);
		// 1. Metadata first.
		const noteIds = new Map<string, string>();
		for (const note of notes) {
			const state = await engine.readYNote(note.path);
			const noteId = state.noteId || note.path;
			noteIds.set(note.path, noteId);
			await upsertSharedNote({
				spaceId,
				noteId,
				path: note.path,
				title: note.title,
				spacePath,
			});
		}

		// 2. Content second: full-state snapshot + one idempotent full update.
		for (const note of notes) {
			const noteId = noteIds.get(note.path) ?? note.path;
			const state = await engine.readYNote(note.path);
			const doc = new Y.Doc();
			try {
				Y.applyUpdate(doc, state.snapshot);
				const data = Y.encodeStateAsUpdate(doc);
				const stateVector = Y.encodeStateVector(doc);
				await writeSharedSnapshot({
					spaceId,
					noteId,
					data,
					stateVector,
					spacePath,
				});
				await appendSharedUpdate({
					spaceId,
					noteId,
					updateId: `initial-${noteId}`,
					deviceId,
					data,
					spacePath,
				});
			} finally {
				doc.destroy();
			}
		}

		return { spaceId, noteCount: notes.length };
	} catch (error) {
		// Mapping is NOT saved on failure — retry is a fresh toggle ON,
		// which creates a fresh share (no resurrection of a partial link).
		throw new Error(humanizeShareError(error));
	}
}

export type CloudPullResult = {
	cloudNotes: number;
	appliedUpdates: number;
	createdLocalNotes: number;
	conflicts: string[];
	localOnly: number;
};

/**
 * Open-time pull (plan 019, Step 4).
 * Cloud wins for note-list membership; local unsynced edits are never
 * deleted — on path collision with a different noteId both copies are kept
 * (cloud copy lands as "<title> (cloud)") and the conflict is reported.
 */
export async function pullCloudSpace(
	spacePath: string,
	spaceId: string,
): Promise<CloudPullResult> {
	const engine = getNotesEngine();
	if (!engine) throw new Error("Notes engine is not available.");
	const cloudNotes = await listSharedNotes(spaceId, spacePath);
	const workspace = await engine.getWorkspace();
	const space = workspace.spaces.find((s) => s.path === spacePath);
	const localByPath = new Map<string, WorkspaceNote>();
	if (space) {
		const localNotes: WorkspaceNote[] = [];
		collectSpaceNotes(space.children, localNotes);
		for (const note of localNotes) localByPath.set(note.path, note);
	}

	const conflicts: string[] = [];
	let appliedUpdates = 0;
	let createdLocalNotes = 0;

	for (const cloudNote of cloudNotes) {
		const local = localByPath.get(cloudNote.path);
		if (!local) {
			// Cloud-only note: create locally, then merge cloud updates into it.
			const tryParents = [parentPath(cloudNote.path), spacePath].filter(
				Boolean,
			);
			let createdPath: string | null = null;
			let lastError: unknown = null;
			for (const parent of tryParents) {
				try {
					const created = await engine.createNote(parent, cloudNote.title);
					createdPath = created.path;
					break;
				} catch (error) {
					lastError = error;
				}
			}
			if (!createdPath) throw lastError ?? new Error("Could not create note.");
			createdLocalNotes += 1;
			const updates = await listSharedUpdates(
				spaceId,
				cloudNote.noteId,
				spacePath,
			);
			for (const update of updates) {
				await engine.writeYUpdate(createdPath, update.data);
				appliedUpdates += 1;
			}
			continue;
		}

		// Overlapping path: verify identity before merging.
		const localState = await engine.readYNote(local.path);
		if (localState.noteId && localState.noteId !== cloudNote.noteId) {
			const copy = await engine.createNote(
				spacePath,
				`${cloudNote.title} (cloud)`,
			);
			createdLocalNotes += 1;
			const updates = await listSharedUpdates(
				spaceId,
				cloudNote.noteId,
				spacePath,
			);
			for (const update of updates) {
				await engine.writeYUpdate(copy.path, update.data);
				appliedUpdates += 1;
			}
			conflicts.push(cloudNote.path);
			continue;
		}

		const updates = await listSharedUpdates(
			spaceId,
			cloudNote.noteId,
			spacePath,
		);
		for (const update of updates) {
			await engine.writeYUpdate(local.path, update.data);
			appliedUpdates += 1;
		}
	}

	const cloudPaths = new Set(cloudNotes.map((n) => n.path));
	const localOnly = [...localByPath.keys()].filter(
		(p) => !cloudPaths.has(p),
	).length;

	return {
		cloudNotes: cloudNotes.length,
		appliedUpdates,
		createdLocalNotes,
		conflicts,
		localOnly,
	};
}
