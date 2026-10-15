import * as Y from "yjs";
import { cloudRemoteOrigin, enqueueLocalYUpdate } from "@/lib/cloud-live-sync";
import {
	attachLocalLiveNote,
	detachLocalLiveNote,
	localRemoteOrigin,
} from "@/lib/local-live-sync";
import { getNotesEngine } from "@/lib/notes-engine";

const loadOrigin = "paperite:y-note-load";

export { cloudRemoteOrigin, loadOrigin, localRemoteOrigin };

export type LoadedYNote = {
	noteId: string;
	doc: Y.Doc;
	destroy: () => void;
};

/**
 * Plan 020 Step 3: registry of live (open) Y.Docs by note path. The pull
 * engine applies remote updates to the live doc when one exists (so the
 * editor converges without reload) and falls back to `engine.writeYUpdate`
 * for closed notes. Docs created by `loadYNote` register here; callers that
 * construct their own Y.Doc (share flow, tests) are unaffected.
 */
const liveDocs = new Map<string, Y.Doc>();
const liveDocNotes = new Map<
	string,
	{
		noteId: string;
		persistUpdate: (update: Uint8Array, origin: unknown) => void;
	}
>();

export function getLiveYDoc(notePath: string): Y.Doc | null {
	return liveDocs.get(notePath) ?? null;
}

/**
 * Full cleanup of one live-doc registration (map entries + update
 * listener + live transport sub). Path-explicit so rename rekeys stay
 * correct even when the LoadedYNote.destroy closure captured the old path.
 */
export function destroyLiveYDoc(notePath: string, doc: Y.Doc): void {
	const meta = liveDocNotes.get(notePath);
	if (meta && liveDocs.get(notePath) === doc) {
		doc.off("update", meta.persistUpdate);
		liveDocs.delete(notePath);
		liveDocNotes.delete(notePath);
	}
	detachLocalLiveNote(notePath, doc);
}

function isSameOrChildPath(parentPath: string, childPath: string): boolean {
	return (
		childPath === parentPath || childPath.startsWith(`${parentPath}/`)
	);
}

function movePath(childPath: string, fromPath: string, toPath: string): string {
	if (childPath === fromPath) return toPath;
	return toPath + childPath.slice(fromPath.length);
}

/**
 * Rename rekey: every live doc under fromPath (note or folder subtree)
 * follows toPath. The persist listener closes over the note path, so it
 * is swapped for one bound to the new path — a bare map rekey would keep
 * writing Y updates to the dead path (split state). On key collision the
 * existing entry wins and the incoming doc is destroyed (mirrors the
 * loadedYNoteCache policy in moveNoteRuntimeState).
 */
export function rekeyLiveYDoc(fromPath: string, toPath: string): void {
	if (fromPath === toPath) return;
	const notesApi = getNotesEngine();
	for (const [notePath, doc] of [...liveDocs]) {
		if (!isSameOrChildPath(fromPath, notePath)) continue;
		const nextPath = movePath(notePath, fromPath, toPath);
		const meta = liveDocNotes.get(notePath);
		if (meta) doc.off("update", meta.persistUpdate);
		liveDocs.delete(notePath);
		liveDocNotes.delete(notePath);
		if (liveDocs.has(nextPath)) {
			doc.destroy();
			continue;
		}
		const persistUpdate = (update: Uint8Array, origin: unknown) => {
			if (origin === loadOrigin || origin === localRemoteOrigin) return;
			void notesApi?.writeYUpdate(nextPath, update);
			enqueueLocalYUpdate(nextPath, meta?.noteId ?? "", update, origin);
		};
		doc.on("update", persistUpdate);
		liveDocs.set(nextPath, doc);
		if (meta) liveDocNotes.set(nextPath, { noteId: meta.noteId, persistUpdate });
	}
}

export async function loadYNote(notePath: string): Promise<LoadedYNote | null> {
	const notesApi = getNotesEngine();
	if (!notesApi) return null;

	const started = performance.now();
	const state = await notesApi.readYNote(notePath);
	const readDuration = performance.now() - started;
	const doc = new Y.Doc();

	const applyStarted = performance.now();
	Y.applyUpdate(doc, toUint8Array(state.snapshot), loadOrigin);
	const applyDuration = performance.now() - applyStarted;
	if (readDuration > 16 || applyDuration > 16) {
		console.info(
			`[paperite perf] yNote ${readDuration.toFixed(1)}ms read + ${applyDuration.toFixed(1)}ms apply ${notePath}`,
		);
	}

	const persistUpdate = (update: Uint8Array, origin: unknown) => {
		if (origin === loadOrigin || origin === localRemoteOrigin) return;
		void notesApi.writeYUpdate(notePath, update);
		// Plan 020 Step 2: same listener, own origin filter. Local-only
		// notes cost one map lookup inside enqueue and return false.
		enqueueLocalYUpdate(notePath, state.noteId, update, origin);
	};

	doc.on("update", persistUpdate);
	liveDocs.set(notePath, doc);
	liveDocNotes.set(notePath, {
		noteId: state.noteId,
		persistUpdate,
	});
	attachLocalLiveNote(notePath, doc);

	return {
		noteId: state.noteId,
		doc,
		destroy: () => {
			destroyLiveYDoc(notePath, doc);
			doc.destroy();
		},
	};
}

function toUint8Array(value: Uint8Array) {
	return value instanceof Uint8Array ? value : new Uint8Array(value);
}
