import * as Y from "yjs";
import { setCloudTransient } from "@/lib/cloud-sync-status";
import { getDeviceId } from "@/lib/device-id";
import { getNotesEngine } from "@/lib/notes-engine";
import type { WorkspaceItem } from "@/lib/storage/types";
import { useAppStore } from "@/lib/stores/app-store";
import {
	getRemoteDeviceId,
	humanizeShareError,
	listSharedNotes,
	listSharedUpdates,
	type SharedNoteRow,
	watchSharedNotes,
	watchSharedUpdates,
} from "@/lib/sync-provider";
import { parentPath } from "@/lib/workspace-paths";
import { cloudRemoteOrigin, getLiveYDoc } from "@/lib/y-note-store";

/**
 * Plan 020 Step 3: pull subscriptions (cloud → local) for linked spaces.
 *
 * - One `listNotes` subscription per linked space + one `listUpdates`
 *   subscription per note (capped at `maxUpdateSubsPerSpace`; beyond that the
 *   019 open-time pull still converges on open — documented tradeoff).
 * - Merge reuses the 019 open-time rules: cloud wins for list membership,
 *   same path + different noteId → "<title> (cloud)" copy, local-only notes
 *   are never deleted. Tombstones (noteId seen before, now absent) move the
 *   local copy to Trash — recoverable, never silent loss.
 * - Remote updates apply to the live `Y.Doc` with `cloudRemoteOrigin` when
 *   the note is open (persists to sqlite via the existing persistUpdate path,
 *   skips the Step-2 push queue) or via `engine.writeYUpdate` when closed.
 * - Own-device updates (`deviceId` match) and `seenUpdateIds` are skipped;
 *   Yjs merging is idempotent so any residual re-apply is harmless.
 * - Tear down with `stopPullForSpace` (unshare) / `stopAllPull` (logout).
 */

const maxUpdateSubsPerSpace = 200;

type KnownNote = { path: string; title: string };

/** spacePath → (noteId → last-seen row). Baseline for tombstone detection. */
const knownNotes = new Map<string, Map<string, KnownNote>>();
const listUnsubs = new Map<string, () => void>();
const updateUnsubs = new Map<string, () => void>();

function updateSubKey(spacePath: string, noteId: string): string {
	return `${spacePath}::${noteId}`;
}

function seenKey(spaceId: string, noteId: string): string {
	return `${spaceId}::${noteId}`;
}

export function isPullActive(spacePath: string): boolean {
	return listUnsubs.has(spacePath);
}

function collectSpaceNotes(
	items: WorkspaceItem[],
	out: { path: string; title: string }[],
): void {
	for (const item of items) {
		if (item.type === "note") {
			out.push({ path: item.path, title: item.title });
			continue;
		}
		collectSpaceNotes(item.children, out);
	}
}

/** Find a local note in `spacePath` by its stable noteId (bounded scan). */
async function findLocalNoteById(
	spacePath: string,
	noteId: string,
): Promise<{ path: string; title: string } | null> {
	const engine = getNotesEngine();
	if (!engine) return null;
	const workspace = await engine.getWorkspace().catch(() => null);
	if (!workspace) return null;
	const space = workspace.spaces.find((s) => s.path === spacePath);
	if (!space) return null;
	const notes: { path: string; title: string }[] = [];
	collectSpaceNotes(space.children, notes);
	for (const note of notes) {
		try {
			const state = await engine.readYNote(note.path);
			if ((state.noteId || note.path) === noteId) return note;
		} catch {}
	}
	return null;
}

function getSeenIds(spaceId: string, noteId: string): Set<string> {
	try {
		const ids =
			useAppStore.getState().cloudSeenUpdates[seenKey(spaceId, noteId)] ?? [];
		return new Set(ids);
	} catch {
		return new Set();
	}
}

function subscribeNoteUpdates(
	spacePath: string,
	spaceId: string,
	noteId: string,
	localPath: string,
): void {
	const key = updateSubKey(spacePath, noteId);
	if (updateUnsubs.has(key)) return;
	let perSpace = 0;
	for (const existing of updateUnsubs.keys()) {
		if (existing.startsWith(`${spacePath}::`)) perSpace += 1;
	}
	if (perSpace >= maxUpdateSubsPerSpace) {
		// Cap reached — the open-time pull still converges this note on open.
		return;
	}
	try {
		const unsub = watchSharedUpdates(
			spaceId,
			noteId,
			(rows) => {
				void handleRemoteUpdates(
					spaceId,
					noteId,
					localPath,
					rows.map((r) => ({
						updateId: r.updateId,
						deviceId: r.deviceId,
						data: r.data,
					})),
					spacePath,
				);
			},
			spacePath,
		);
		updateUnsubs.set(key, unsub);
	} catch (error) {
		setCloudTransient(spacePath, {
			phase: "error",
			message: humanizeShareError(error),
		});
	}
}

type RemoteUpdate = { updateId: string; deviceId: string; data: Uint8Array };

async function handleRemoteUpdates(
	spaceId: string,
	noteId: string,
	localPath: string,
	rows: RemoteUpdate[],
	spacePath: string,
): Promise<void> {
	const ownDevice =
		(await getRemoteDeviceId(spacePath, spaceId)) ?? getDeviceId();
	const seen = getSeenIds(spaceId, noteId);
	const fresh = rows.filter(
		(row) => row.deviceId !== ownDevice && !seen.has(row.updateId),
	);
	if (fresh.length === 0) return;
	const applied: string[] = [];
	const liveDoc = getLiveYDoc(localPath);
	for (const row of fresh) {
		try {
			if (liveDoc) {
				Y.applyUpdate(liveDoc, row.data, cloudRemoteOrigin);
			} else {
				await getNotesEngine()?.writeYUpdate(localPath, row.data);
			}
			applied.push(row.updateId);
		} catch {}
	}
	if (applied.length > 0) {
		try {
			useAppStore
				.getState()
				.addSeenCloudUpdates(seenKey(spaceId, noteId), applied);
		} catch {
			// Seen-set persistence is best-effort perf only.
		}
	}
}

/** Merge one note-list snapshot with local state (019 rules + tombstones). */
async function handleNoteList(
	spacePath: string,
	spaceId: string,
	rows: SharedNoteRow[],
): Promise<void> {
	const engine = getNotesEngine();
	if (!engine) return;
	const prev = knownNotes.get(spacePath) ?? new Map<string, KnownNote>();
	const next = new Map<string, KnownNote>();
	for (const row of rows)
		next.set(row.noteId, { path: row.path, title: row.title });

	// 1. New / changed rows.
	for (const row of rows) {
		const known = prev.get(row.noteId);
		if (known && known.path === row.path && known.title === row.title) {
			const stillLocal = await findLocalNoteById(spacePath, row.noteId).catch(
				() => null,
			);
			if (stillLocal) {
				subscribeNoteUpdates(spacePath, spaceId, row.noteId, stillLocal.path);
			}
			continue;
		}
		const local = await findLocalNoteById(spacePath, row.noteId).catch(
			() => null,
		);
		if (!local) {
			// Cloud-only note (or our own just-created note echoing back):
			// createLocalCopyFromCloud re-checks path+noteId per 019 rules.
			const created = await createLocalCopyFromCloud(
				spacePath,
				spaceId,
				row,
			).catch(() => null);
			if (created)
				subscribeNoteUpdates(spacePath, spaceId, row.noteId, created);
			continue;
		}
		let targetPath = local.path;
		if (local.path !== row.path || local.title !== row.title) {
			await mirrorRemoteRename(spacePath, local.path, row).catch(() => null);
			targetPath =
				(await findLocalNoteById(spacePath, row.noteId).catch(() => null))
					?.path ?? local.path;
		}
		subscribeNoteUpdates(spacePath, spaceId, row.noteId, targetPath);
	}

	// 2. Tombstones: seen before, absent now → Trash (recoverable).
	for (const [noteId, known] of prev) {
		if (next.has(noteId)) continue;
		const local = await findLocalNoteById(spacePath, noteId).catch(() => null);
		const localPath = local?.path ?? known.path;
		try {
			await engine.deleteItem(localPath);
		} catch {
			// Already gone locally (user deleted + our wrapper already
			// tombstoned) — convergence achieved, nothing to do.
		}
		updateUnsubs.get(updateSubKey(spacePath, noteId))?.();
		updateUnsubs.delete(updateSubKey(spacePath, noteId));
	}

	knownNotes.set(spacePath, next);
}

/**
 * Pure helper (unit-tested): the 019 path-collision rule. A local note at the
 * same path with a DIFFERENT noteId is a different note — keep both (cloud
 * copy lands as "<title> (cloud)"). Same noteId (or no local note) merges.
 */
export function resolveCloudNoteMerge(
	localNoteId: string | null,
	cloudNoteId: string,
): "merge" | "copy" {
	if (localNoteId === null) return "merge";
	return localNoteId === cloudNoteId ? "merge" : "copy";
}

/** Create the local copy of a cloud note + apply unseen updates. */
async function createLocalCopyFromCloud(
	spacePath: string,
	spaceId: string,
	row: SharedNoteRow,
): Promise<string | null> {
	const engine = getNotesEngine();
	if (!engine) return null;
	// Re-check: a local note with this path but a DIFFERENT noteId means a
	// path collision → keep both ("<title> (cloud)"), per 019.
	const workspace = await engine.getWorkspace().catch(() => null);
	const space = workspace?.spaces.find((s) => s.path === spacePath);
	const siblings: { path: string; title: string }[] = [];
	if (space) collectSpaceNotes(space.children, siblings);
	const colliding = siblings.find((n) => n.path === row.path);
	if (colliding) {
		const state = await engine.readYNote(colliding.path).catch(() => null);
		const localNoteId = state ? state.noteId || colliding.path : null;
		if (resolveCloudNoteMerge(localNoteId, row.noteId) === "copy") {
			const copy = await engine.createNote(spacePath, `${row.title} (cloud)`);
			await applyCloudUpdatesToLocal(spacePath, spaceId, row.noteId, copy.path);
			return copy.path;
		}
		// Merge: same noteId at the same path (echo), or unreadable local
		// state — apply cloud updates onto the existing local note.
		await applyCloudUpdatesToLocal(
			spacePath,
			spaceId,
			row.noteId,
			colliding.path,
		);
		return colliding.path;
	}
	const tryParents = [parentPath(row.path), spacePath].filter(Boolean);
	let createdPath: string | null = null;
	for (const parent of tryParents) {
		try {
			const created = await engine.createNote(parent, row.title);
			createdPath = created.path;
			break;
		} catch {}
	}
	if (!createdPath) return null;
	await applyCloudUpdatesToLocal(spacePath, spaceId, row.noteId, createdPath);
	return createdPath;
}

async function applyCloudUpdatesToLocal(
	spacePath: string,
	spaceId: string,
	noteId: string,
	localPath: string,
): Promise<void> {
	const seen = getSeenIds(spaceId, noteId);
	const ownDevice =
		(await getRemoteDeviceId(spacePath, spaceId)) ?? getDeviceId();
	const updates = await listSharedUpdates(spaceId, noteId, spacePath).catch(
		() => [],
	);
	const fresh = updates.filter(
		(u) => u.deviceId !== ownDevice && !seen.has(u.updateId),
	);
	const applied: string[] = [];
	const liveDoc = getLiveYDoc(localPath);
	for (const update of fresh) {
		try {
			if (liveDoc) {
				Y.applyUpdate(liveDoc, update.data, cloudRemoteOrigin);
			} else {
				await getNotesEngine()?.writeYUpdate(localPath, update.data);
			}
			applied.push(update.updateId);
		} catch {}
	}
	if (applied.length > 0) {
		try {
			useAppStore
				.getState()
				.addSeenCloudUpdates(seenKey(spaceId, noteId), applied);
		} catch {
			// Best-effort perf only.
		}
	}
}

/** Best-effort mirror of a remote rename/move onto the local copy. */
async function mirrorRemoteRename(
	spacePath: string,
	localPath: string,
	row: SharedNoteRow,
): Promise<void> {
	const engine = getNotesEngine();
	if (!engine) return;
	if (parentPath(localPath) !== parentPath(row.path)) {
		const nextParent = parentPath(row.path) || spacePath;
		const moved = await engine
			.moveItem(localPath, nextParent)
			.catch(() => null);
		if (!moved || moved.path === localPath) return;
		localPath = moved.path;
	}
	if (localPath !== row.path) {
		// Same parent, different filename — converge the title; the local
		// filename follows local naming rules and may still differ.
		await engine.renameItem(localPath, row.title).catch(() => null);
	}
}

/**
 * Start live pull for one linked space. Safe to call repeatedly (idempotent);
 * local-only spaces never reach here (callers check the mapping first).
 */
export async function startPullForSpace(
	spacePath: string,
	spaceId: string,
): Promise<void> {
	if (listUnsubs.has(spacePath)) return;
	// Seed the tombstone baseline BEFORE subscribing so the first snapshot
	// diff doesn't trash everything.
	try {
		const rows = await listSharedNotes(spaceId, spacePath);
		const seed = new Map<string, KnownNote>();
		for (const row of rows) {
			seed.set(row.noteId, { path: row.path, title: row.title });
			const local = await findLocalNoteById(spacePath, row.noteId).catch(
				() => null,
			);
			if (local) {
				subscribeNoteUpdates(spacePath, spaceId, row.noteId, local.path);
				if (updateUnsubs.size >= maxUpdateSubsPerSpace) break;
			}
		}
		knownNotes.set(spacePath, seed);
	} catch (error) {
		setCloudTransient(spacePath, {
			phase: "error",
			message: humanizeShareError(error),
		});
		return;
	}
	try {
		const unsub = watchSharedNotes(
			spaceId,
			(rows) => {
				void handleNoteList(spacePath, spaceId, rows).catch(
					(error: unknown) => {
						setCloudTransient(spacePath, {
							phase: "error",
							message: humanizeShareError(error),
						});
					},
				);
			},
			spacePath,
		);
		listUnsubs.set(spacePath, unsub);
	} catch (error) {
		setCloudTransient(spacePath, {
			phase: "error",
			message: humanizeShareError(error),
		});
	}
}

export function stopPullForSpace(spacePath: string): void {
	listUnsubs.get(spacePath)?.();
	listUnsubs.delete(spacePath);
	for (const [key, unsub] of [...updateUnsubs]) {
		if (key.startsWith(`${spacePath}::`)) {
			try {
				unsub();
			} catch {
				// Teardown must never throw.
			}
			updateUnsubs.delete(key);
		}
	}
	knownNotes.delete(spacePath);
}

export function stopAllPull(): void {
	for (const spacePath of [...listUnsubs.keys()]) stopPullForSpace(spacePath);
}
