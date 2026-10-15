import { useSyncExternalStore } from "react";
import * as Y from "yjs";
import { setCloudTransient } from "@/lib/cloud-sync-status";
import { getDeviceId } from "@/lib/device-id";
import type { NotesEngine, WorkspaceItem } from "@/lib/storage/types";
import { useAppStore } from "@/lib/stores/app-store";
import {
	appendSharedUpdate,
	humanizeShareError,
	removeSharedNote,
	upsertSharedNote,
	writeSharedSnapshot,
} from "@/lib/sync-provider";
import { movePath, topLevelPath } from "@/lib/workspace-paths";

/**
 * Plan 020 Step 2: push engine (local → cloud) for cloud-linked spaces.
 *
 * Design (documented per plan):
 * - Thin manager module, not UI. UI reads queue state via
 *   `subscribeLiveSyncQueue` / `getPendingCount`.
 * - Outbox is MEMORY-ONLY v1 with flush-on-unload best-effort
 *   (`attachLiveSyncLifecycle`). Rationale: persisting Yjs binary deltas to
 *   localStorage risks quota blowups; the sqlite copy is the durable source
 *   of truth and Step 5 backfill re-seeds anything lost across a restart.
 *   Queued edits survive retry (same updateId) but NOT app restart — a
 *   restart re-enqueues full-state updates via backfill on next open.
 * - `updateId` (`${deviceId}:${noteId}:${counter}`) is assigned AT ENQUEUE
 *   and never regenerated, so server idempotency on `updateId` actually
 *   works across retries. The counter is the only persisted piece
 *   (localStorage `paperite.cloud-update-counter` — cheap monotonic int).
 * - Local-only spaces cost one `cloudSpaceLinks` map lookup per edit and
 *   make zero Convex calls (019 opt-in guarantee stays absolute).
 */

export const cloudRemoteOrigin = "paperite:cloud-remote";
const loadOrigin = "paperite:y-note-load";

const counterKey = "paperite.cloud-update-counter";
const flushDebounceMs = 2000;
const flushBatchCap = 50;
const snapshotEveryFlushes = 50;
const snapshotEveryMs = 5 * 60 * 1000;
const backoffBaseMs = 2000;
const backoffMaxMs = 60 * 1000;

export type QueuedUpdate = {
	updateId: string;
	data: Uint8Array;
};

type NoteQueue = {
	noteId: string;
	updates: QueuedUpdate[];
};

type SpaceQueue = Map<string, NoteQueue>; // notePath → queue

/** spacePath → notes. Memory-only (see module doc). */
const outbox = new Map<string, SpaceQueue>();
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const backoffMsBySpace = new Map<string, number>();
const flushInFlight = new Set<string>();
const flushCountByNote = new Map<string, number>();
const lastSnapshotAt = new Map<string, number>();

type QueueListener = () => void;
const queueListeners = new Set<QueueListener>();

function notifyQueue() {
	for (const listener of queueListeners) listener();
}

export function subscribeLiveSyncQueue(listener: QueueListener) {
	queueListeners.add(listener);
	return () => {
		queueListeners.delete(listener);
	};
}

/** React binding for one space's queued-update count (plan 020 Step 4). */
export function useLiveSyncPending(spacePath: string): number {
	return useSyncExternalStore(
		subscribeLiveSyncQueue,
		() => getPendingCount(spacePath),
		() => getPendingCount(spacePath),
	);
}

export function getPendingCount(spacePath?: string): number {
	if (spacePath) {
		const space = outbox.get(spacePath);
		if (!space) return 0;
		let scoped = 0;
		for (const note of space.values()) scoped += note.updates.length;
		return scoped;
	}
	let total = 0;
	for (const space of outbox.values()) {
		for (const note of space.values()) total += note.updates.length;
	}
	return total;
}

/** Queued updateIds for one space (oldest-first). Test/debug introspection. */
export function getQueuedUpdateIds(spacePath: string): string[] {
	const space = outbox.get(spacePath);
	if (!space) return [];
	return [...space.values()].flatMap((note) =>
		note.updates.map((update) => update.updateId),
	);
}

/** Pure helper (unit-tested): stable wire-contract updateId. */
export function makeUpdateId(
	deviceId: string,
	noteId: string,
	counter: number,
): string {
	return `${deviceId}:${noteId}:${counter}`;
}

/** Pure helper (unit-tested): origins that must never enter the push queue. */
export function isPushableOrigin(origin: unknown): boolean {
	return origin !== loadOrigin && origin !== cloudRemoteOrigin;
}

/** Pure helper (unit-tested): batch cap for one flush. */
export function takeBatch<T>(items: T[], cap: number): T[] {
	return items.slice(0, Math.max(0, cap));
}

function nextCloudCounter(): number {
	let current = 0;
	try {
		current = Number(window.localStorage.getItem(counterKey) ?? "0") || 0;
	} catch {
		current = 0;
	}
	const next = current + 1;
	try {
		window.localStorage.setItem(counterKey, String(next));
	} catch {
		// Counter persistence is best-effort; worst case a duplicate
		// updateId collides server-side and is deduped (idempotent).
	}
	return next;
}

function getLinkedSpaceId(spacePath: string): string | null {
	try {
		return useAppStore.getState().cloudSpaceLinks[spacePath] ?? null;
	} catch {
		return null;
	}
}

function noteKey(spacePath: string, notePath: string): string {
	return `${spacePath}::${notePath}`;
}

/**
 * Content tap point. Call from the `doc.on("update")` listener next to the
 * existing sqlite `persistUpdate` — same skip for `loadOrigin`, plus skip
 * for `cloudRemoteOrigin` (Step-3 applies must not echo back).
 * Returns false when the edit was NOT queued (local-only space or skipped
 * origin) — the sqlite write still happens via the existing path.
 */
export function enqueueLocalYUpdate(
	notePath: string,
	noteId: string,
	update: Uint8Array,
	origin: unknown,
): boolean {
	if (!isPushableOrigin(origin)) return false;
	const spacePath = topLevelPath(notePath);
	const spaceId = getLinkedSpaceId(spacePath);
	if (!spaceId) return false;

	const updateId = makeUpdateId(getDeviceId(), noteId, nextCloudCounter());
	let space = outbox.get(spacePath);
	if (!space) {
		space = new Map();
		outbox.set(spacePath, space);
	}
	let note = space.get(notePath);
	if (!note) {
		note = { noteId, updates: [] };
		space.set(notePath, note);
	}
	// noteId is stable per note; keep the first-seen (engine is source).
	note.updates.push({ updateId, data: update.slice() });
	notifyQueue();
	scheduleFlush(spacePath);
	return true;
}

/** Move a queued note entry across a rename/move (keeps updateIds stable). */
export function rekeyQueuedNote(
	spacePath: string,
	oldPath: string,
	newPath: string,
): void {
	const space = outbox.get(spacePath);
	if (!space) return;
	const entry = space.get(oldPath);
	if (!entry) return;
	space.delete(oldPath);
	space.set(newPath, entry);
	notifyQueue();
}

function scheduleFlush(spacePath: string): void {
	const existing = flushTimers.get(spacePath);
	if (existing) clearTimeout(existing);
	const backoff = backoffMsBySpace.get(spacePath) ?? 0;
	flushTimers.set(
		spacePath,
		setTimeout(() => {
			flushTimers.delete(spacePath);
			void flushSpace(spacePath);
		}, flushDebounceMs + backoff),
	);
}

/**
 * Flush one linked space: append up to `flushBatchCap` updates per note,
 * then snapshot when due. Failure keeps payloads queued with exponential
 * backoff; success clears. Reschedules itself while the queue is non-empty.
 */
export async function flushSpace(spacePath: string): Promise<void> {
	if (flushInFlight.has(spacePath)) return;
	const spaceId = getLinkedSpaceId(spacePath);
	const space = outbox.get(spacePath);
	if (!spaceId || !space || space.size === 0) return;
	flushInFlight.add(spacePath);
	try {
		const deviceId = getDeviceId();
		for (const [notePath, note] of space) {
			const batch = takeBatch(note.updates, flushBatchCap);
			for (const queued of batch) {
				await appendSharedUpdate({
					spaceId,
					noteId: note.noteId,
					updateId: queued.updateId,
					deviceId,
					data: queued.data,
				});
			}
			if (batch.length > 0) {
				note.updates.splice(0, batch.length);
				const key = noteKey(spacePath, notePath);
				flushCountByNote.set(key, (flushCountByNote.get(key) ?? 0) + 1);
				if (
					note.updates.length === 0 &&
					space.get(notePath)?.updates.length === 0
				) {
					space.delete(notePath);
				}
				await maybeSnapshot(spaceId, spacePath, notePath, note.noteId);
			}
		}
		if (space.size === 0) outbox.delete(spacePath);
		backoffMsBySpace.delete(spacePath);
		if (getPendingCount(spacePath) === 0) {
			// Clear OUR error transient on recovery; never touch a
			// share/pull transient we didn't set (checked by prefix).
			setCloudTransient(spacePath, null);
		}
		notifyQueue();
		if (outbox.has(spacePath)) scheduleFlush(spacePath);
	} catch (error) {
		const current = backoffMsBySpace.get(spacePath) ?? backoffBaseMs;
		backoffMsBySpace.set(spacePath, Math.min(current * 2, backoffMaxMs));
		setCloudTransient(spacePath, {
			phase: "error",
			message: humanizeShareError(error),
		});
		notifyQueue();
		scheduleFlush(spacePath);
	} finally {
		flushInFlight.delete(spacePath);
	}
}

async function maybeSnapshot(
	spaceId: string,
	spacePath: string,
	notePath: string,
	noteId: string,
): Promise<void> {
	const key = noteKey(spacePath, notePath);
	const flushes = flushCountByNote.get(key) ?? 0;
	const lastAt = lastSnapshotAt.get(key) ?? 0;
	const now = Date.now();
	if (flushes % snapshotEveryFlushes !== 0 && now - lastAt < snapshotEveryMs) {
		return;
	}
	try {
		const engine = engineRef;
		if (!engine) return;
		const state = await engine.readYNote(notePath);
		const doc = new Y.Doc();
		try {
			Y.applyUpdate(doc, state.snapshot);
			const data = Y.encodeStateAsUpdate(doc);
			const stateVector = Y.encodeStateVector(doc);
			await writeSharedSnapshot({ spaceId, noteId, data, stateVector });
			lastSnapshotAt.set(key, now);
		} finally {
			doc.destroy();
		}
	} catch {
		// Snapshot failure is non-fatal — updates already landed, and the
		// next cadence tick retries. Never fail a flush over a snapshot.
	}
}

export function flushAllLinkedSpaces(): Promise<void>[] {
	return [...outbox.keys()].map((spacePath) => flushSpace(spacePath));
}

// --- Metadata hooks (single choke point for linked-space metadata) ---
//
// Constraint: zero behavior change for unlinked spaces — every hook starts
// with one `cloudSpaceLinks` lookup and returns before any Convex call when
// there is no mapping. Content edits ride `enqueueLocalYUpdate`; these cover
// create/rename/move/delete.

/** After a successful local createNote in a linked space. */
export async function notifyNoteCreated(
	spacePath: string,
	notePath: string,
	title: string,
): Promise<void> {
	const spaceId = getLinkedSpaceId(spacePath);
	if (!spaceId) return;
	try {
		const engine = engineRef;
		const state = await engine?.readYNote(notePath);
		await upsertSharedNote({
			spaceId,
			noteId: state?.noteId || notePath,
			path: notePath,
			title,
		});
	} catch (error) {
		setCloudTransient(spacePath, {
			phase: "error",
			message: humanizeShareError(error),
		});
	}
}

/** After a successful local rename/move in a linked space. */
export async function notifyNoteRenamed(
	spacePath: string,
	oldPath: string,
	newPath: string,
	title: string,
): Promise<void> {
	const spaceId = getLinkedSpaceId(spacePath);
	if (!spaceId) return;
	rekeyQueuedNote(spacePath, oldPath, newPath);
	try {
		const engine = engineRef;
		const state = await engine?.readYNote(newPath);
		await upsertSharedNote({
			spaceId,
			noteId: state?.noteId || newPath,
			path: newPath,
			title,
		});
	} catch (error) {
		setCloudTransient(spacePath, {
			phase: "error",
			message: humanizeShareError(error),
		});
	}
}

/**
 * After a successful local deleteItem in a linked space. Call with the
 * noteId captured BEFORE the delete (the path is gone afterwards).
 * Local delete → cloud tombstone → other devices move their copy to Trash
 * (Step 3), never silent loss.
 */
export async function notifyNoteDeleted(
	spacePath: string,
	noteId: string,
): Promise<void> {
	const spaceId = getLinkedSpaceId(spacePath);
	if (!spaceId) return;
	try {
		await removeSharedNote({ spaceId, noteId });
	} catch (error) {
		setCloudTransient(spacePath, {
			phase: "error",
			message: humanizeShareError(error),
		});
	}
}

// --- Engine choke point ---
//
// `wrapNotesEngineWithLiveSync` is the SINGLE choke point for linked-space
// metadata (plan 020 Step 2.3). `getNotesEngine()` returns the wrapped engine
// so every call site (sidebar commands, note actions, pull engine) is covered
// without per-site edits. Methods are forwarded explicitly (never spread —
// the engines are class instances and spreading would unbind `this`).
// Constraint: zero behavior change for unlinked spaces — every override
// starts with one `cloudSpaceLinks` lookup and returns the raw engine result
// untouched when there is no mapping.

let engineRef: NotesEngine | null = null;

type NoteIdentity = { path: string; noteId: string; title: string };

function collectDescendantNotes(
	items: WorkspaceItem[],
	out: { path: string; title: string }[],
): void {
	for (const item of items) {
		if (item.type === "note") {
			out.push({ path: item.path, title: item.title });
			continue;
		}
		collectDescendantNotes(item.children, out);
	}
}

/** Note identities under `rootPath` (the note itself, or a folder/space subtree). */
async function collectNotesUnder(
	engine: NotesEngine,
	rootPath: string,
): Promise<NoteIdentity[]> {
	const workspace = await engine.getWorkspace();
	const found: { path: string; title: string }[] = [];
	if (workspace.spaces.some((space) => space.path === rootPath)) {
		const space = workspace.spaces.find((s) => s.path === rootPath);
		if (space) collectDescendantNotes(space.children, found);
	} else {
		const stack: WorkspaceItem[] = workspace.spaces.flatMap((s) => s.children);
		let target: WorkspaceItem | null = null;
		while (stack.length > 0) {
			const item = stack.pop();
			if (!item) continue;
			if (item.path === rootPath) {
				target = item;
				break;
			}
			if (item.type === "folder") stack.push(...item.children);
		}
		if (!target) return [];
		if (target.type === "note") {
			found.push({ path: target.path, title: target.title });
		} else {
			collectDescendantNotes(target.children, found);
		}
	}
	return Promise.all(
		found.map(async (note) => {
			try {
				const state = await engine.readYNote(note.path);
				return { ...note, noteId: state.noteId || note.path };
			} catch {
				return { ...note, noteId: note.path };
			}
		}),
	);
}

/** A linked space itself was renamed — carry the cloud link to the new path. */
function moveSpaceLink(oldSpacePath: string, newSpacePath: string): void {
	const store = useAppStore.getState();
	const spaceId = store.cloudSpaceLinks[oldSpacePath];
	if (!spaceId) return;
	store.removeCloudSpaceLink(oldSpacePath);
	store.setCloudSpaceLink(newSpacePath, spaceId);
	const queue = outbox.get(oldSpacePath);
	if (queue) {
		outbox.delete(oldSpacePath);
		outbox.set(newSpacePath, queue);
	}
	setCloudTransient(oldSpacePath, null);
	notifyQueue();
}

async function upsertMovedNotes(
	spaceId: string,
	fromPath: string,
	toPath: string,
	before: NoteIdentity[],
	titleOverride?: string,
): Promise<void> {
	for (const note of before) {
		const newNotePath =
			note.path === fromPath ? toPath : movePath(note.path, fromPath, toPath);
		rekeyQueuedNote(topLevelPath(note.path), note.path, newNotePath);
		await upsertSharedNote({
			spaceId,
			noteId: note.noteId,
			path: newNotePath,
			title:
				note.path === fromPath && titleOverride ? titleOverride : note.title,
		});
	}
}

export function wrapNotesEngineWithLiveSync(engine: NotesEngine): NotesEngine {
	engineRef = engine;
	attachLiveSyncLifecycle();
	return {
		getWorkspace: () => engine.getWorkspace(),
		search: (query) => engine.search(query),
		readNote: (path) => engine.readNote(path),
		readYNote: (path) => engine.readYNote(path),
		writeYUpdate: (path, update) => engine.writeYUpdate(path, update),
		writeDerivedNote: (path, content) => engine.writeDerivedNote(path, content),
		writeNote: (path, content) => engine.writeNote(path, content),
		setPageFormat: (path, format) => engine.setPageFormat(path, format),
		pruneAssets: (path) =>
			engine.pruneAssets?.(path) ??
			Promise.resolve({ ok: true as const, deleted: 0 }),
		createNote: async (parentPath, title) => {
			const created = await engine.createNote(parentPath, title);
			void notifyNoteCreated(
				topLevelPath(created.path),
				created.path,
				created.title,
			);
			return created;
		},
		createFolder: (parentPath, title) => engine.createFolder(parentPath, title),
		createSpace: (title) => engine.createSpace(title),
		renameItem: async (path, nextName) => {
			const spacePath = topLevelPath(path);
			const spaceId = getLinkedSpaceId(spacePath);
			const before = spaceId
				? await collectNotesUnder(engine, path).catch(() => [])
				: [];
			const renamed = await engine.renameItem(path, nextName);
			if (renamed.path !== path) {
				if (path === spacePath) moveSpaceLink(path, renamed.path);
				if (spaceId) {
					try {
						await upsertMovedNotes(
							spaceId,
							path,
							renamed.path,
							before,
							nextName,
						);
					} catch (error) {
						setCloudTransient(topLevelPath(renamed.path), {
							phase: "error",
							message: humanizeShareError(error),
						});
					}
				}
			}
			return renamed;
		},
		moveItem: async (itemPath, nextParentPath) => {
			const spacePath = topLevelPath(itemPath);
			const spaceId = getLinkedSpaceId(spacePath);
			const before = spaceId
				? await collectNotesUnder(engine, itemPath).catch(() => [])
				: [];
			const moved = await engine.moveItem(itemPath, nextParentPath);
			if (moved.path !== itemPath && spaceId) {
				try {
					await upsertMovedNotes(spaceId, itemPath, moved.path, before);
				} catch (error) {
					setCloudTransient(topLevelPath(moved.path), {
						phase: "error",
						message: humanizeShareError(error),
					});
				}
			}
			return moved;
		},
		deleteItem: async (path) => {
			const spacePath = topLevelPath(path);
			const spaceId = getLinkedSpaceId(spacePath);
			const before = spaceId
				? await collectNotesUnder(engine, path).catch(() => [])
				: [];
			const result = await engine.deleteItem(path);
			if (spaceId) {
				if (path === spacePath) {
					// Whole linked space deleted locally: tombstone its notes
					// (other devices converge), then drop the local link —
					// the space is gone, there is nothing left to sync.
					// The cloud copy is kept (019 rule).
					for (const note of before) {
						try {
							await removeSharedNote({ spaceId, noteId: note.noteId });
						} catch {
							// Best-effort; link is dropped regardless.
						}
					}
					useAppStore.getState().removeCloudSpaceLink(spacePath);
					stopLiveSync(spacePath);
				} else {
					for (const note of before) {
						const queue = outbox.get(spacePath);
						queue?.delete(note.path);
						try {
							await removeSharedNote({ spaceId, noteId: note.noteId });
						} catch (error) {
							setCloudTransient(spacePath, {
								phase: "error",
								message: humanizeShareError(error),
							});
						}
					}
					notifyQueue();
				}
			}
			return result;
		},
		popoutNote: (path) => engine.popoutNote(path),
		readAppState: () => engine.readAppState(),
		writeAppState: (state) => engine.writeAppState(state),
	};
}

/**
 * Trash-restore has no engine hook (it goes through the trash engine, not
 * NotesEngine). Call this after a successful restore in a linked space —
 * the server `upsertNote` clears the tombstone (resurrect), so restored
 * notes reappear on other devices instead of staying hidden.
 */
export async function notifyNoteUpsert(
	notePath: string,
	title: string,
): Promise<void> {
	const spacePath = topLevelPath(notePath);
	const spaceId = getLinkedSpaceId(spacePath);
	if (!spaceId) return;
	try {
		const state = await engineRef?.readYNote(notePath);
		await upsertSharedNote({
			spaceId,
			noteId: state?.noteId || notePath,
			path: notePath,
			title,
		});
	} catch (error) {
		setCloudTransient(spacePath, {
			phase: "error",
			message: humanizeShareError(error),
		});
	}
}

// --- Lifecycle ---

let lifecycleAttached = false;

/**
 * Flush on window blur / page hide / Ctrl+S (best-effort; the open note's
 * queue drains instead of waiting out the debounce). Idempotent — safe to
 * call multiple times (boot path + HMR).
 */
export function attachLiveSyncLifecycle(): void {
	if (lifecycleAttached || typeof window === "undefined") return;
	lifecycleAttached = true;
	const flush = () => {
		void flushAllLinkedSpaces();
	};
	window.addEventListener("blur", flush);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") flush();
	});
	window.addEventListener("beforeunload", () => {
		void flushAllLinkedSpaces();
	});
	window.addEventListener("keydown", (event) => {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
			flush();
		}
	});
}

/** Tear down timers + queue for one space (unshare / logout). */
export function stopLiveSync(spacePath: string): void {
	const timer = flushTimers.get(spacePath);
	if (timer) clearTimeout(timer);
	flushTimers.delete(spacePath);
	outbox.delete(spacePath);
	backoffMsBySpace.delete(spacePath);
	setCloudTransient(spacePath, null);
	notifyQueue();
}

// --- Backfill (plan 020 Step 5) ---
//
// Existing 019 links keep working: on first run with live sync, enqueue a
// full-state update per local note (same bytes as share, fresh updateIds —
// idempotent server-side, harmless dupes) so pre-sync edits converge, and
// write a fresh snapshot. Runs once per space (localStorage set); no mapping
// format change, no user action needed. Fresh shares mark the space migrated
// immediately (share already pushed full state).

const backfillKey = "paperite.cloud-backfilled-v1";

function readBackfilled(): Set<string> {
	try {
		const raw = window.localStorage.getItem(backfillKey);
		if (!raw) return new Set();
		const parsed: unknown = JSON.parse(raw);
		return new Set(
			Array.isArray(parsed)
				? parsed.filter((s): s is string => typeof s === "string")
				: [],
		);
	} catch {
		return new Set();
	}
}

export function markBackfilled(spacePath: string): void {
	try {
		const done = readBackfilled();
		done.add(spacePath);
		window.localStorage.setItem(backfillKey, JSON.stringify([...done]));
	} catch {
		// Best-effort; worst case backfill re-runs (idempotent).
	}
}

/** Enqueue one full-state update (same bytes as share) for `notePath`. */
function enqueueFullState(
	spacePath: string,
	notePath: string,
	noteId: string,
	data: Uint8Array,
): void {
	let space = outbox.get(spacePath);
	if (!space) {
		space = new Map();
		outbox.set(spacePath, space);
	}
	let note = space.get(notePath);
	if (!note) {
		note = { noteId, updates: [] };
		space.set(notePath, note);
	}
	note.updates.push({
		updateId: makeUpdateId(getDeviceId(), noteId, nextCloudCounter()),
		data: data.slice(),
	});
}

export async function backfillLinkedSpace(
	spacePath: string,
	spaceId: string,
): Promise<{ migrated: boolean; noteCount: number }> {
	if (readBackfilled().has(spacePath)) return { migrated: false, noteCount: 0 };
	const engine = engineRef;
	if (!engine) return { migrated: false, noteCount: 0 };
	const workspace = await engine.getWorkspace();
	const space = workspace.spaces.find((s) => s.path === spacePath);
	if (!space) return { migrated: false, noteCount: 0 };
	const notes: { path: string; title: string }[] = [];
	collectBackfillNotes(space.children, notes);
	for (const note of notes) {
		const state = await engine.readYNote(note.path);
		const noteId = state.noteId || note.path;
		// Metadata first (upsert also resurrects cloud tombstones for notes
		// that exist locally — local truth wins on re-create by design).
		await upsertSharedNote({
			spaceId,
			noteId,
			path: note.path,
			title: note.title,
		});
		const doc = new Y.Doc();
		try {
			Y.applyUpdate(doc, state.snapshot);
			const data = Y.encodeStateAsUpdate(doc);
			const stateVector = Y.encodeStateVector(doc);
			await writeSharedSnapshot({ spaceId, noteId, data, stateVector });
			enqueueFullState(spacePath, note.path, noteId, data);
		} finally {
			doc.destroy();
		}
	}
	notifyQueue();
	scheduleFlush(spacePath);
	markBackfilled(spacePath);
	console.info(
		`[paperite] cloud backfill: migrated ${notes.length} note${notes.length === 1 ? "" : "s"} in "${spacePath}" to live sync.`,
	);
	return { migrated: true, noteCount: notes.length };
}

function collectBackfillNotes(
	items: WorkspaceItem[],
	out: { path: string; title: string }[],
): void {
	for (const item of items) {
		if (item.type === "note") {
			out.push({ path: item.path, title: item.title });
			continue;
		}
		collectBackfillNotes(item.children, out);
	}
}
