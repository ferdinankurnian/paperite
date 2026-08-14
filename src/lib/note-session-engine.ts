import type { NotesEngine } from "@/lib/notes-engine";
import type { NoteContent } from "@/lib/storage/types";
import { type LoadedYNote, loadYNote } from "@/lib/y-note-store";

/** Non-React note runtime: caches and I/O coordination only. */
export class NoteSessionEngine {
	readonly noteContentCache = new Map<string, NoteContent>();
	readonly noteLiveContentGetters = new Map<string, () => NoteContent>();
	readonly loadedYNoteCache = new Map<string, LoadedYNote>();
	readonly notePersistedCache = new Map<string, NoteContent>();
	readonly noteWriteQueue = new Map<string, Promise<void>>();

	private readonly noteContentInFlight = new Map<string, Promise<NoteContent>>();
	private readonly yNoteInFlight = new Map<string, Promise<LoadedYNote | null>>();

	private notesApi: NotesEngine | null;

	constructor(notesApi: NotesEngine | null) {
		this.notesApi = notesApi;
	}

	setNotesApi(notesApi: NotesEngine | null) {
		this.notesApi = notesApi;
	}

	readNoteOnce(notePath: string) {
		const cached = this.noteContentCache.get(notePath);
		if (cached) return Promise.resolve(cached);

		const inFlight = this.noteContentInFlight.get(notePath);
		if (inFlight) return inFlight;

		const request = this.notesApi?.readNote(notePath);
		if (!request) return Promise.reject(new Error("Storage unavailable"));

		const tracked = request.finally(() => {
			this.noteContentInFlight.delete(notePath);
		});
		this.noteContentInFlight.set(notePath, tracked);
		return tracked;
	}

	loadYNoteOnce(notePath: string) {
		const cached = this.loadedYNoteCache.get(notePath);
		if (cached) return Promise.resolve(cached);

		const inFlight = this.yNoteInFlight.get(notePath);
		if (inFlight) return inFlight;

		const tracked = loadYNote(notePath).finally(() => {
			this.yNoteInFlight.delete(notePath);
		});
		this.yNoteInFlight.set(notePath, tracked);
		return tracked;
	}

	enqueueNoteWrite(notePath: string, content: NoteContent) {
		if (!this.notesApi) return Promise.resolve();

		const previousWrite = this.noteWriteQueue.get(notePath) ?? Promise.resolve();
		const queuedWrite = previousWrite
			.catch(() => undefined)
			.then(() => this.notesApi?.writeNote(notePath, content).then(() => undefined));
		const trackedWrite = queuedWrite
			.catch(() => undefined)
			.finally(() => {
				if (this.noteWriteQueue.get(notePath) === trackedWrite) {
					this.noteWriteQueue.delete(notePath);
				}
			});

		this.noteWriteQueue.set(notePath, trackedWrite);
		return queuedWrite;
	}
}
