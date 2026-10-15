import { useCallback, useRef } from "react";
import {
	canonicalNotePath,
	NoteSessionEngine,
} from "@/lib/note-session-engine";
import type { NotesEngine } from "@/lib/notes-engine";

/** React adapter for the non-React note session engine. */
export function useNoteSession(notesApi: NotesEngine | null) {
	const engineRef = useRef<NoteSessionEngine | null>(null);
	if (!engineRef.current) engineRef.current = new NoteSessionEngine(notesApi);
	engineRef.current.setNotesApi(notesApi);
	const engine = engineRef.current;

	const readNoteOnce = useCallback(
		(notePath: string) => engine.readNoteOnce(canonicalNotePath(notePath)),
		[engine],
	);
	const loadYNoteOnce = useCallback(
		(notePath: string) => engine.loadYNoteOnce(canonicalNotePath(notePath)),
		[engine],
	);
	const enqueueNoteWrite = useCallback(
		(
			notePath: string,
			content: Parameters<NoteSessionEngine["enqueueNoteWrite"]>[1],
		) => engine.enqueueNoteWrite(canonicalNotePath(notePath), content),
		[engine],
	);

	return {
		noteContentCache: useRef(engine.noteContentCache),
		noteLiveContentGetters: useRef(engine.noteLiveContentGetters),
		loadedYNoteCache: useRef(engine.loadedYNoteCache),
		notePersistedCache: useRef(engine.notePersistedCache),
		noteWriteQueue: useRef(engine.noteWriteQueue),
		readNoteOnce,
		loadYNoteOnce,
		enqueueNoteWrite,
	};
}
