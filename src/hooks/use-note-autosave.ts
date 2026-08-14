import { startTransition, useCallback, useEffect, useRef } from "react";
import type { NotesEngine } from "@/lib/notes-engine";
import type { NoteContent, WorkspaceSnapshot } from "@/lib/storage/types";
import { noteContentPreview, serializeNoteContentBody } from "@/lib/note-content";
import { getSyncEngine } from "@/lib/sync-engine";
import type { LoadedYNote } from "@/lib/y-note-store";
import { type SaveStatus, useEditorUiStore } from "@/lib/stores/editor-ui-store";

type Ref<T> = { current: T };
type Options = {
  notesApi: NotesEngine | null;
  activeNotePathRef: Ref<string | null>;
  lastPersistedContent: Ref<string>;
  noteContentCache: Ref<Map<string, NoteContent>>;
  noteLiveContentGetters: Ref<Map<string, () => NoteContent>>;
  loadedYNoteCache: Ref<Map<string, LoadedYNote>>;
  notePersistedCache: Ref<Map<string, NoteContent>>;
  enqueueNoteWrite: (path: string, content: NoteContent) => Promise<unknown>;
  setSaveStatus: (next: SaveStatus | ((current: SaveStatus) => SaveStatus)) => void;
  setWorkspace: React.Dispatch<React.SetStateAction<WorkspaceSnapshot | null>>;
  updateWorkspaceNote: (workspace: WorkspaceSnapshot, notePath: string, patch: { preview: string; updatedAt: number }) => WorkspaceSnapshot;
};
export function useNoteAutosave(options: Options) {
  const { notesApi, activeNotePathRef, lastPersistedContent, noteContentCache, noteLiveContentGetters, loadedYNoteCache, notePersistedCache, enqueueNoteWrite, setSaveStatus, setWorkspace, updateWorkspaceNote } = options;
  const noteAutosaveTimers = useRef(new Map<string, number>());
  const yjsDerivedAutosaveTimers = useRef(new Map<string, number>());
  	const clearNoteAutosaveTimer = useCallback((notePath: string) => {
  		const timer = noteAutosaveTimers.current.get(notePath);
  		if (timer === undefined) return;

  		window.clearTimeout(timer);
  		noteAutosaveTimers.current.delete(notePath);
  	}, []);

  	const clearAutosavesForPath = useCallback((pathToClear: string) => {
  		for (const [notePath, timer] of noteAutosaveTimers.current) {
  			if (!isSameOrChildPath(pathToClear, notePath)) continue;

  			window.clearTimeout(timer);
  			noteAutosaveTimers.current.delete(notePath);
  		}

  		for (const [notePath, timer] of yjsDerivedAutosaveTimers.current) {
  			if (!isSameOrChildPath(pathToClear, notePath)) continue;

  			window.clearTimeout(timer);
  			yjsDerivedAutosaveTimers.current.delete(notePath);
  		}
  	}, []);

  	const scheduleNoteAutosave = useCallback(
  		(notePath: string, content: NoteContent) => {
  			clearNoteAutosaveTimer(notePath);

  			// Only flip to "saving" when status actually changes — same-value
  			// setState is a no-op in React, so rapid keystrokes stay cheap.
  			if (activeNotePathRef.current === notePath) {
  				setSaveStatus((current) => (current === "saving" ? current : "saving"));
  			}

  			const timer = window.setTimeout(() => {
  				noteAutosaveTimers.current.delete(notePath);

  				const latestContent = noteContentCache.current.get(notePath) ?? content;
  				const latestBody = serializeNoteContentBody(latestContent);
  				const persistedContent = notePersistedCache.current.get(notePath);
  				const persistedBody = persistedContent
  					? serializeNoteContentBody(persistedContent)
  					: "";

  				if (latestBody === persistedBody) {
  					if (activeNotePathRef.current === notePath) {
  						lastPersistedContent.current = latestBody;
  						setSaveStatus((current) =>
  							current === "saved" ? current : "saved",
  						);
  					}
  					return;
  				}

  				enqueueNoteWrite(notePath, latestContent)
  					.then(() => {
  						const currentContent =
  							noteContentCache.current.get(notePath) ?? latestContent;
  						const currentBody = serializeNoteContentBody(currentContent);

  						notePersistedCache.current.set(notePath, latestContent);

  						if (activeNotePathRef.current === notePath) {
  							lastPersistedContent.current = latestBody;
  							const nextStatus =
  								currentBody === latestBody ? "saved" : "saving";
  							setSaveStatus((current) =>
  								current === nextStatus ? current : nextStatus,
  							);
  						}

  						// Preview text is non-urgent; don't block the editor paint.
  						startTransition(() => {
  							setWorkspace((current) =>
  								current
  									? updateWorkspaceNote(current, notePath, {
  											preview: noteContentPreview(latestContent),
  											updatedAt: Date.now(),
  										})
  									: current,
  							);
  						});
  					})
  					.catch(() => {
  						if (activeNotePathRef.current === notePath) setSaveStatus("error");
  					});
  			}, 700);

  			noteAutosaveTimers.current.set(notePath, timer);
  		},
  		[clearNoteAutosaveTimer, enqueueNoteWrite],
  	);

  	const scheduleYjsDerivedAutosave = useCallback(
  		(notePath: string, content: NoteContent) => {
  			const existingTimer = yjsDerivedAutosaveTimers.current.get(notePath);
  			if (existingTimer !== undefined) window.clearTimeout(existingTimer);

  			if (activeNotePathRef.current === notePath) {
  				setSaveStatus((current) => (current === "saving" ? current : "saving"));
  			}

  			const timer = window.setTimeout(() => {
  				yjsDerivedAutosaveTimers.current.delete(notePath);
  				const latestContent = noteContentCache.current.get(notePath) ?? content;
  				const latestBody = serializeNoteContentBody(latestContent);
  				const persistedContent = notePersistedCache.current.get(notePath);
  				const persistedBody = persistedContent
  					? serializeNoteContentBody(persistedContent)
  					: "";

  				if (latestBody === persistedBody) {
  					if (activeNotePathRef.current === notePath) {
  						lastPersistedContent.current = latestBody;
  						setSaveStatus((current) =>
  							current === "saved" ? current : "saved",
  						);
  					}
  					return;
  				}

  				notesApi
  					?.writeDerivedNote(notePath, latestContent)
  					.then(() => {
  						noteContentCache.current.set(notePath, latestContent);
  						notePersistedCache.current.set(notePath, latestContent);

  						if (activeNotePathRef.current === notePath) {
  							lastPersistedContent.current = latestBody;
  							setSaveStatus((current) =>
  								current === "saved" ? current : "saved",
  							);
  						}

  						startTransition(() => {
  							setWorkspace((current) =>
  								current
  									? updateWorkspaceNote(current, notePath, {
  											preview: noteContentPreview(latestContent),
  											updatedAt: Date.now(),
  										})
  									: current,
  							);
  						});
  					})
  					.catch(() => {
  						if (activeNotePathRef.current === notePath) setSaveStatus("error");
  					});
  			}, 700);

  			yjsDerivedAutosaveTimers.current.set(notePath, timer);
  		},
  		[notesApi],
  	);

  	const registerNoteContentSnapshot = useCallback(
  		(notePath: string | null, getContent: (() => NoteContent) | null) => {
  			if (!notePath) return;
  			if (getContent) noteLiveContentGetters.current.set(notePath, getContent);
  			else noteLiveContentGetters.current.delete(notePath);
  		},
  		[],
  	);

  	const flushSaveAndSync = useCallback(async () => {
  		const notePath = activeNotePathRef.current;
  		if (!notePath) return;

  		// Prefer live TipTap state so a keystroke between cache update and save is not lost.
  		const liveGetter = noteLiveContentGetters.current.get(notePath);
  		let latestContent = noteContentCache.current.get(notePath);
  		if (liveGetter) {
  			try {
  				const live = liveGetter();
  				noteContentCache.current.set(notePath, live);
  				latestContent = live;
  			} catch {
  				// fall back to cache
  			}
  		}
  		const latestBody = latestContent
  			? serializeNoteContentBody(latestContent)
  			: null;
  		const persistedContent = notePersistedCache.current.get(notePath);
  		const persistedBody = persistedContent
  			? serializeNoteContentBody(persistedContent)
  			: null;

  		const isDirty = Boolean(
  			latestBody && latestBody !== persistedBody && latestContent,
  		);

  		if (isDirty && latestContent && latestBody) {
  			setSaveStatus("saving");
  			clearNoteAutosaveTimer(notePath);
  			clearAutosavesForPath(notePath);

  			try {
  				if (loadedYNoteCache.current.has(notePath)) {
  					await notesApi?.writeDerivedNote(notePath, latestContent);
  				} else {
  					await enqueueNoteWrite(notePath, latestContent);
  				}
  				notePersistedCache.current.set(notePath, latestContent);
  				lastPersistedContent.current = latestBody;
  				useEditorUiStore.getState().markSaved();

  				setWorkspace((current) =>
  					current
  						? updateWorkspaceNote(current, notePath, {
  								preview: noteContentPreview(latestContent),
  								updatedAt: Date.now(),
  							})
  						: current,
  				);
  			} catch {
  				setSaveStatus("error");
  				return;
  			}
  		} else {
  			// Already clean — still give Ctrl+S feedback + refresh timestamp.
  			useEditorUiStore.getState().markSaved();
  		}

  		const syncEngine = getSyncEngine();
  		if (syncEngine) {
  			syncEngine.runGoogleDrive().catch(() => undefined);
  		}
  	}, [
  		clearAutosavesForPath,
  		clearNoteAutosaveTimer,
  		enqueueNoteWrite,
  		notesApi,
  	]);

  	const verifyNoteSave = useCallback(async (): Promise<{
  		ok: boolean;
  		message: string;
  		detail?: string;
  	}> => {
  		const notePath = activeNotePathRef.current;
  		if (!notePath) {
  			return { ok: false, message: "No note open" };
  		}
  		if (!notesApi) {
  			return { ok: false, message: "Storage unavailable" };
  		}

  		const liveGetter = noteLiveContentGetters.current.get(notePath);
  		let liveContent = noteContentCache.current.get(notePath);
  		if (liveGetter) {
  			try {
  				liveContent = liveGetter();
  				noteContentCache.current.set(notePath, liveContent);
  			} catch {
  				// keep cache
  			}
  		}
  		if (!liveContent) {
  			return { ok: false, message: "No editor content to verify" };
  		}

  		try {
  			const diskContent = await notesApi.readNote(notePath);
  			const liveBody = serializeNoteContentBody(liveContent);
  			const diskBody = serializeNoteContentBody(diskContent);

  			if (liveBody === diskBody) {
  				notePersistedCache.current.set(notePath, liveContent);
  				lastPersistedContent.current = liveBody;
  				useEditorUiStore.getState().markSaved();
  				return {
  					ok: true,
  					message: "Verified — matches disk",
  					detail: "Editor and saved file are identical.",
  				};
  			}

  			return {
  				ok: false,
  				message: "Mismatch — not fully saved",
  				detail:
  					"Editor content differs from the file on disk. Press Ctrl+S to force save.",
  			};
  		} catch {
  			return {
  				ok: false,
  				message: "Could not read note from disk",
  				detail: "File may be missing or unreadable.",
  			};
  		}
  	}, [notesApi]);

  	const moveNoteRuntimeState = useCallback(
  		(fromPath: string, toPath: string) => {
  			const pendingAutosaves: Array<[string, NoteContent]> = [];

  			for (const [notePath, timer] of noteAutosaveTimers.current) {
  				if (!isSameOrChildPath(fromPath, notePath)) continue;

  				window.clearTimeout(timer);
  				noteAutosaveTimers.current.delete(notePath);

  				const content = noteContentCache.current.get(notePath);
  				if (content)
  					pendingAutosaves.push([
  						movePath(notePath, fromPath, toPath),
  						content,
  					]);
  			}

  			const moveCache = (cache: Map<string, NoteContent>) => {
  				for (const [notePath, content] of [...cache]) {
  					if (!isSameOrChildPath(fromPath, notePath)) continue;

  					cache.delete(notePath);
  					cache.set(movePath(notePath, fromPath, toPath), content);
  				}
  			};

  			moveCache(noteContentCache.current);
  			moveCache(notePersistedCache.current);

  			for (const [notePath, content] of pendingAutosaves) {
  				noteContentCache.current.set(notePath, content);
  				scheduleNoteAutosave(notePath, content);
  			}
  		},
  		[scheduleNoteAutosave],
  	);

  useEffect(() => () => {
    for (const timer of noteAutosaveTimers.current.values()) window.clearTimeout(timer);
    for (const timer of yjsDerivedAutosaveTimers.current.values()) window.clearTimeout(timer);
    noteAutosaveTimers.current.clear();
    yjsDerivedAutosaveTimers.current.clear();
  }, []);
  return { noteAutosaveTimers, yjsDerivedAutosaveTimers, clearNoteAutosaveTimer, clearAutosavesForPath, scheduleNoteAutosave, scheduleYjsDerivedAutosave, registerNoteContentSnapshot, flushSaveAndSync, verifyNoteSave, moveNoteRuntimeState };
}
function isSameOrChildPath(parentPath: string, childPath: string) { return childPath === parentPath || childPath.startsWith(`${parentPath}/`); }
function movePath(path: string, fromPath: string, toPath: string) { return path === fromPath ? toPath : `${toPath}/${path.slice(fromPath.length + 1)}`; }
