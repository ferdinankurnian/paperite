import * as Y from "yjs";
import { cloudRemoteOrigin, enqueueLocalYUpdate } from "@/lib/cloud-live-sync";
import { getNotesEngine } from "@/lib/notes-engine";

const loadOrigin = "paperite:y-note-load";

export { cloudRemoteOrigin, loadOrigin };

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

export function getLiveYDoc(notePath: string): Y.Doc | null {
	return liveDocs.get(notePath) ?? null;
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
		if (origin === loadOrigin) return;
		void notesApi.writeYUpdate(notePath, update);
		// Plan 020 Step 2: same listener, own origin filter. Local-only
		// notes cost one map lookup inside enqueue and return false.
		enqueueLocalYUpdate(notePath, state.noteId, update, origin);
	};

	doc.on("update", persistUpdate);
	liveDocs.set(notePath, doc);

	return {
		noteId: state.noteId,
		doc,
		destroy: () => {
			doc.off("update", persistUpdate);
			if (liveDocs.get(notePath) === doc) liveDocs.delete(notePath);
			doc.destroy();
		},
	};
}

function toUint8Array(value: Uint8Array) {
	return value instanceof Uint8Array ? value : new Uint8Array(value);
}
