import type { NotesEngine } from "@/lib/notes-engine";
import type { NoteContent } from "@/lib/storage/types";
import { type LoadedYNote, loadYNote } from "@/lib/y-note-store";

/** Canonicalize a note path so electron / serve / popout key one entry. */
export function canonicalNotePath(notePath: string): string {
	return notePath
		.replaceAll("\\", "/")
		.replace(/^\/+/, "")
		.replaceAll(/\/+/g, "/")
		.replace(/\/$/, "");
}

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

	// Rename convergence lives in one place: moveNoteRuntimeState
	// (use-note-autosave) rekeys every cache + the live Y maps. This
	// resolver is pure canonicalization.
	resolveNotePath(notePath: string): string {
		return canonicalNotePath(notePath);
	}

	clearNoteState(notePath: string) {
		const key = this.resolveNotePath(notePath);
		this.noteContentCache.delete(key);
		this.noteLiveContentGetters.delete(key);
		this.loadedYNoteCache.get(key)?.destroy();
		this.loadedYNoteCache.delete(key);
		this.notePersistedCache.delete(key);
		this.noteWriteQueue.delete(key);
		this.noteContentInFlight.delete(key);
		this.yNoteInFlight.delete(key);
	}

	readNoteOnce(notePath: string) {
		const key = this.resolveNotePath(notePath);
		const cached = this.noteContentCache.get(key);
		if (cached) return Promise.resolve(cached);

		const inFlight = this.noteContentInFlight.get(key);
		if (inFlight) return inFlight;

		const request = this.notesApi?.readNote(key);
		if (!request) return Promise.reject(new Error("Storage unavailable"));

		const tracked = request.finally(() => {
			this.noteContentInFlight.delete(key);
		});
		this.noteContentInFlight.set(key, tracked);
		return tracked;
	}

	loadYNoteOnce(notePath: string) {
		const key = this.resolveNotePath(notePath);
		const cached = this.loadedYNoteCache.get(key);
		if (cached) return Promise.resolve(cached);

		const inFlight = this.yNoteInFlight.get(key);
		if (inFlight) return inFlight;

		const tracked = loadYNote(key).finally(() => {
			this.yNoteInFlight.delete(key);
		});
		this.yNoteInFlight.set(key, tracked);
		return tracked;
	}

	enqueueNoteWrite(notePath: string, content: NoteContent) {
		if (!this.notesApi) return Promise.resolve();
		const key = this.resolveNotePath(notePath);

		const previousWrite = this.noteWriteQueue.get(key) ?? Promise.resolve();
		// The queue serializes per-note writes so keystroke bursts cannot
		// interleave; failures propagate to the caller (autosave shows
		// "error" and retries) while the queue itself continues.
		const queuedWrite = previousWrite
			.catch(() => undefined)
			.then(() => this.notesApi?.writeNote(key, content).then(() => undefined));
		const trackedWrite = queuedWrite
			.catch(() => undefined)
			.finally(() => {
				if (this.noteWriteQueue.get(key) === trackedWrite) {
					this.noteWriteQueue.delete(key);
				}
			});

		this.noteWriteQueue.set(key, trackedWrite);
		return queuedWrite;
	}
}
