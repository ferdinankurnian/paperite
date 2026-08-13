import * as Y from "yjs";
import { getNotesEngine } from "@/lib/notes-engine";

const loadOrigin = "paperite:y-note-load";

export type LoadedYNote = {
	noteId: string;
	doc: Y.Doc;
	destroy: () => void;
};

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
	};

	doc.on("update", persistUpdate);

	return {
		noteId: state.noteId,
		doc,
		destroy: () => {
			doc.off("update", persistUpdate);
			doc.destroy();
		},
	};
}

function toUint8Array(value: Uint8Array) {
	return value instanceof Uint8Array ? value : new Uint8Array(value);
}
