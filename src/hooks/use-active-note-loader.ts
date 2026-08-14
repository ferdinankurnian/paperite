import { useEffect, useRef, type MutableRefObject, type Dispatch, type SetStateAction } from "react";
import type { NotesEngine } from "@/lib/notes-engine";
import {
	createEmptyNoteContent,
	serializeNoteContent,
	serializeNoteContentBody,
} from "@/lib/note-content";
import type { NoteContent } from "@/lib/storage/types";
import { useAppStore } from "@/lib/stores/app-store";
import { useEditorUiStore, type SaveStatus } from "@/lib/stores/editor-ui-store";
import type { LoadedYNote } from "@/lib/y-note-store";

type RefMap<T> = MutableRefObject<Map<string, T>>;

type Options = {
	notesApi: NotesEngine | null;
	activeNotePathRef: MutableRefObject<string | null>;
	lastLoadedNote: MutableRefObject<string | null>;
	lastPersistedContent: MutableRefObject<string>;
	noteContentRef: MutableRefObject<NoteContent>;
	noteContentCache: RefMap<NoteContent>;
	notePersistedCache: RefMap<NoteContent>;
	noteWriteQueue: RefMap<Promise<void>>;
	loadedYNoteCache: RefMap<LoadedYNote>;
	readNoteOnce: (path: string) => Promise<NoteContent>;
	syncOpenTabTitle: (path: string, content: NoteContent) => void;
	/** Guard: content + yDoc must exist before calling store markEditorReady. */
	tryMarkEditorReady: (path: string) => void;
	setNotePreviews: Dispatch<SetStateAction<Record<string, string>>>;
	setSaveStatus: (status: SaveStatus) => void;
	omitExact: <T,>(record: Record<string, T>, path: string) => Record<string, T>;
};

/** Write active-note content into refs/caches without Index setState. */
function commitActiveContent(
	current: Options,
	notePath: string | null,
	content: NoteContent,
) {
	current.noteContentRef.current = content;
	if (notePath) {
		current.noteContentCache.current.set(notePath, content);
	}
}

/**
 * Owns the activeNotePath subscription + load pipeline so Index does not
 * re-render on every tab switch (plan 017). Warm switches that already have
 * content + yDoc ready perform zero setState. Cold loads only setState via
 * markEditorReady / saveStatus / notePreviews — never via noteContent React state.
 */
export function useActiveNoteLoader(options: Options) {
	const optionsRef = useRef(options);
	optionsRef.current = options;

	const activeNotePath = useAppStore((s) => s.activeNotePath);

	// Keep ref in sync for non-React call sites (autosave, keyboard, etc.).
	useEffect(() => {
		optionsRef.current.activeNotePathRef.current = activeNotePath;
	}, [activeNotePath]);

	// Window / document title — local to this boundary.
	useEffect(() => {
		if (!activeNotePath) {
			document.title = "Paperite";
			window.dispatchEvent(new Event("paperite:title-change"));
			window.electron?.app.setTitle("Paperite");
			return;
		}
		const tab = useAppStore.getState().openTabs.find((t) => t.path === activeNotePath);
		const title = `${(tab?.title || "Untitled").trim() || "Untitled"} - Paperite`;
		document.title = title;
		window.dispatchEvent(new Event("paperite:title-change"));
		window.electron?.app.setTitle(title);
	}, [activeNotePath]);

	useEffect(() => {
		const current = optionsRef.current;
		if (!current.notesApi || !activeNotePath) {
			current.lastLoadedNote.current = null;
			return;
		}

		const notePath = activeNotePath;

		// Warm path: already mounted — zero Index setState so shell stays cold.
		if (
			useEditorUiStore.getState().readyEditorPaths.has(notePath) &&
			current.noteContentCache.current.has(notePath)
		) {
			const cached = current.noteContentCache.current.get(notePath)!;
			const persisted = current.notePersistedCache.current.get(notePath);
			current.lastLoadedNote.current = notePath;
			current.noteContentRef.current = cached;
			current.lastPersistedContent.current = persisted
				? serializeNoteContentBody(persisted)
				: serializeNoteContentBody(cached);
			return;
		}

		let cancelled = false;

		const loadNote = async () => {
			const cachedContent = current.noteContentCache.current.get(notePath);
			const persistedContent = current.notePersistedCache.current.get(notePath);
			current.setNotePreviews((prev) => current.omitExact(prev, notePath));

			if (cachedContent !== undefined) {
				const cachedSerialized = serializeNoteContent(cachedContent);
				const persistedSerialized = persistedContent
					? serializeNoteContent(persistedContent)
					: "";
				const isDirty =
					persistedContent !== undefined &&
					cachedSerialized !== persistedSerialized;

				current.lastLoadedNote.current = notePath;
				current.lastPersistedContent.current = persistedContent
					? serializeNoteContentBody(persistedContent)
					: serializeNoteContentBody(cachedContent);
				commitActiveContent(current, notePath, cachedContent);
				current.setSaveStatus(
					persistedContent ? (isDirty ? "saving" : "saved") : "idle",
				);

				if (persistedContent !== undefined) {
					current.tryMarkEditorReady(notePath);
					return;
				}
			} else {
				current.setSaveStatus("idle");
				current.lastLoadedNote.current = null;
				current.lastPersistedContent.current = "";
				commitActiveContent(current, null, createEmptyNoteContent());
			}

			const readStart = performance.now();
			const content = await current.readNoteOnce(notePath);
			current.syncOpenTabTitle(notePath, content);
			const readDuration = performance.now() - readStart;

			if (cancelled) return;

			const currentCachedContent = current.noteContentCache.current.get(notePath);
			const currentPersistedContent =
				current.notePersistedCache.current.get(notePath);
			const readSerialized = serializeNoteContent(content);
			const readSerializedBody = serializeNoteContentBody(content);
			const currentCachedSerialized = currentCachedContent
				? serializeNoteContent(currentCachedContent)
				: undefined;
			const currentPersistedSerialized = currentPersistedContent
				? serializeNoteContent(currentPersistedContent)
				: undefined;
			const currentPersistedSerializedBody = currentPersistedContent
				? serializeNoteContentBody(currentPersistedContent)
				: undefined;
			const hasDirtyCachedContent =
				currentCachedSerialized !== undefined &&
				currentCachedSerialized !== readSerialized &&
				(current.noteWriteQueue.current.has(notePath) ||
					currentPersistedSerialized === undefined ||
					currentCachedSerialized !== currentPersistedSerialized);

			if (hasDirtyCachedContent) {
				current.lastLoadedNote.current = notePath;
				current.lastPersistedContent.current =
					currentPersistedSerializedBody ?? readSerializedBody;
				if (!currentPersistedContent) {
					current.notePersistedCache.current.set(notePath, content);
				}
				// Keep dirty cache as the live content; disk read is stale.
				commitActiveContent(current, notePath, currentCachedContent!);
				current.setSaveStatus("saving");
				current.tryMarkEditorReady(notePath);
				return;
			}

			current.lastLoadedNote.current = notePath;
			current.lastPersistedContent.current = readSerializedBody;
			current.notePersistedCache.current.set(notePath, content);
			commitActiveContent(current, notePath, content);
			current.setSaveStatus("saved");
			current.tryMarkEditorReady(notePath);
			void current.notesApi?.pruneAssets?.(notePath).catch(() => undefined);

			if (readDuration > 16) {
				console.info(
					`[paperite perf] readNote ${readDuration.toFixed(1)}ms ${notePath}`,
				);
			}
		};

		loadNote().catch(() => current.setSaveStatus("error"));

		return () => {
			cancelled = true;
		};
	}, [activeNotePath]);

	return activeNotePath;
}
