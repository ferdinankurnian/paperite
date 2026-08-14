import { useCallback, useRef } from "react";
import type { NotesEngine } from "@/lib/notes-engine";
import { NoteSessionEngine } from "@/lib/note-session-engine";

/** React adapter for the non-React note session engine. */
export function useNoteSession(notesApi: NotesEngine | null) {
	const engineRef = useRef<NoteSessionEngine | null>(null);
	if (!engineRef.current) engineRef.current = new NoteSessionEngine(notesApi);
	engineRef.current.setNotesApi(notesApi);
	const engine = engineRef.current;

	const readNoteOnce = useCallback(
		(notePath: string) => engine.readNoteOnce(notePath),
		[engine],
	);
	const loadYNoteOnce = useCallback(
		(notePath: string) => engine.loadYNoteOnce(notePath),
		[engine],
	);
	const enqueueNoteWrite = useCallback(
		(notePath: string, content: Parameters<NoteSessionEngine["enqueueNoteWrite"]>[1]) =>
			engine.enqueueNoteWrite(notePath, content),
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
