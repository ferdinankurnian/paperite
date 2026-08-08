import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	BookOpenIcon,
	CheckIcon,
	Loader2Icon,
	ShieldCheckIcon,
	ExternalLinkIcon,
	InfoIcon,
	MoreVerticalIcon,
	PencilIcon,
	SearchIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import {
	type CSSProperties,
	memo,
	type MouseEvent,
	type ReactNode,
	startTransition,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { NoteWorkspace } from "@/components/note-workspace";
import { PersistedSidebarProvider } from "@/components/persisted-sidebar-provider";
import { TabBar } from "@/components/tab-bar";
import { useKeyboardShortcuts } from "@/components/keyboard-shortcuts-provider";
import {
	getNoteReadOnlyController,
	NoteEditor,
	subscribeNoteReadOnlyRegistry,
	type PageFormat,
} from "@/components/note-editor";

const MemoNoteEditor = memo(NoteEditor, (prev, next) => {
	// Tab switch only toggles visibility in the parent — keep TipTap mounted
	// and skip re-render unless something the editor actually uses changed.
	// view/edit is local state inside NoteEditor — toggle must not hit Index.
	return (
		prev.content === next.content &&
		prev.noteTitle === next.noteTitle &&
		prev.notePath === next.notePath &&
		prev.pageFormat === next.pageFormat &&
		prev.yDoc === next.yDoc &&
		prev.searchQuery === next.searchQuery &&
		prev.zenMode === next.zenMode &&
		prev.onChange === next.onChange &&
		prev.onContentRendered === next.onContentRendered &&
		prev.onContentSnapshot === next.onContentSnapshot &&
		prev.onRename === next.onRename &&
		prev.onTitleChange === next.onTitleChange
	);
});

const ReadOnlyToggleButton = memo(function ReadOnlyToggleButton() {
	const activeNotePath = useAppStore((s) => s.activeNotePath);
	const [isReadOnly, setIsReadOnly] = useState(false);

	useEffect(() => {
		let unsubController: (() => void) | undefined;
		const attach = () => {
			unsubController?.();
			unsubController = undefined;
			const controller = getNoteReadOnlyController(activeNotePath);
			if (!controller) {
				setIsReadOnly(false);
				return;
			}
			setIsReadOnly(controller.get());
			unsubController = controller.subscribe(setIsReadOnly);
		};
		attach();
		const unsubRegistry = subscribeNoteReadOnlyRegistry(attach);
		return () => {
			unsubRegistry();
			unsubController?.();
		};
	}, [activeNotePath]);

	const toggle = useCallback(() => {
		getNoteReadOnlyController(
			useAppStore.getState().activeNotePath,
		)?.toggle();
	}, []);

	if (!activeNotePath) return null;

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			className="text-muted-foreground"
			aria-label={isReadOnly ? "Edit note" : "Reading view"}
			onClick={toggle}
		>
			{isReadOnly ? <PencilIcon /> : <BookOpenIcon />}
		</Button>
	);
});

import { SidebarHotkeys } from "@/components/sidebar-hotkeys";
import { Button } from "@/components/ui/button";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { clerk, loadClerk } from "@/lib/clerk";
import { addExport, updateExport } from "@/lib/export-queue";
import {
	createEmptyNoteContent,
	noteContentPreview,
	noteContentText,
	noteContentToMarkdown,
	replaceInNoteContent,
	serializeNoteContent,
	serializeNoteContentBody,
} from "@/lib/note-content";
import { getNotesEngine } from "@/lib/notes-engine";
import { isShortcutEditableInput, shortcutMatchesEvent } from "@/lib/shortcuts";
import { getSyncEngine } from "@/lib/sync-engine";
import { getTrashEngine } from "@/lib/trash-engine";
import { type LoadedYNote, loadYNote } from "@/lib/y-note-store";
import {
	defaultAppState,
	getAppStateSnapshot,
	useAppStore,
} from "@/lib/stores/app-store";
import { useStoreWithEqualityFn } from "zustand/traditional";
import {
	formatSavedAt,
	formatSavedAtAbsolute,
	saveStatusLabel,
	useEditorUiStore,
} from "@/lib/stores/editor-ui-store";

export const Route = createFileRoute("/_main/")({
	beforeLoad: async () => {
		if (!import.meta.env.BETA_PAPERITE) return;

		await loadClerk();

		if (!clerk.isSignedIn) {
			throw redirect({ to: "/login" });
		}
	},
	component: Index,
});

type FloatingPanelMode = "find" | "format" | "info" | "replace" | null;

type NoteInfoTarget = {
	path: string;
	title: string;
};

const FALLBACK_PAGE_FORMAT: PageFormat = {
	firstLineIndent: false,
	lineHeight: "normal",
	paragraphSpacing: "default",
};

/** True if same tabs (path + fields); order does not matter. */
function openTabsEqualIgnoringOrder(a: OpenNoteTab[], b: OpenNoteTab[]) {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	const map = new Map(b.map((tab) => [tab.path, tab]));
	for (const tab of a) {
		const other = map.get(tab.path);
		if (
			!other ||
			other.title !== tab.title ||
			other.preview !== tab.preview ||
			other.pinned !== tab.pinned
		) {
			return false;
		}
	}
	return true;
}


function Index() {
	const notesApi = getNotesEngine();
	const { getShortcut } = useKeyboardShortcuts();
	const workspaceRef = useRef<WorkspaceSnapshot | null>(null);
	const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
	// Do NOT subscribe to activeSpacePath here — space switch must re-render
	// sidebar only (AppSidebar already reads it from the store). See plan 015.
	const appState = useStoreWithEqualityFn(
		useAppStore,
		(s) => ({
			openTabs: s.openTabs,
			activeNotePath: s.activeNotePath,
			spaceColors: s.spaceColors,
			spaceIcons: s.spaceIcons,
			spaceOrder: s.spaceOrder,
			closeButtonOnly: s.closeButtonOnly,
			defaultPageFormat: s.defaultPageFormat,
		}),
		// Reorder-only openTabs changes must not re-render Index (sidebar/editors).
		// sidebarOpen lives in PersistedSidebarProvider — toggle must not hit Index.
		// view/edit mode is local to each NoteEditor instance — never hits Index.
		(a, b) =>
			a.activeNotePath === b.activeNotePath &&
			a.spaceColors === b.spaceColors &&
			a.spaceIcons === b.spaceIcons &&
			a.spaceOrder === b.spaceOrder &&
			a.closeButtonOnly === b.closeButtonOnly &&
			a.defaultPageFormat === b.defaultPageFormat &&
			openTabsEqualIgnoringOrder(a.openTabs, b.openTabs),
	);
	const setAppState = useCallback(
		(
			updater:
				| PaperiteAppState
				| ((prev: PaperiteAppState) => PaperiteAppState),
		) => {
			if (typeof updater === "function") {
				useAppStore.getState().update(updater);
			} else {
				useAppStore.getState().replace(updater);
			}
		},
		[],
	);
	const [noteContent, setNoteContent] = useState<NoteContent>(() =>
		createEmptyNoteContent(),
	);
	// Write-only: retained for symmetry with setLoadedNotePath call sites;
	const [, setLoadedNotePath] = useState<string | null>(null);
	const [notePreviews, setNotePreviews] = useState<Record<string, string>>({});
	const [noteTitleDrafts, setNoteTitleDrafts] = useState<
		Record<string, string>
	>({});
	const [floatingPanelMode, setFloatingPanelMode] =
		useState<FloatingPanelMode>(null);
	const [floatingPanelVisible, setFloatingPanelVisible] = useState(false);
	const floatingPanelLastMode = useRef<FloatingPanelMode>(null);
	const [noteInfoTarget, setNoteInfoTarget] = useState<NoteInfoTarget | null>(
		null,
	);
	const [zenMode, setZenMode] = useState(false);
	const [findText, setFindText] = useState("");
	const [replaceText, setReplaceText] = useState("");
	const [pageFormats, setPageFormats] = useState<Record<string, PageFormat>>(
		{},
	);
	const setSaveStatus = useEditorUiStore((s) => s.setSaveStatus);
	const didHydrate = useRef(false);
	const findInputRef = useRef<HTMLInputElement>(null);
	const lastLoadedNote = useRef<string | null>(null);
	const lastPersistedContent = useRef("");
	const activeNotePathRef = useRef<string | null>(null);
	const noteContentRef = useRef<NoteContent>(createEmptyNoteContent());
	const [newlyCreatedFolderPath, setNewlyCreatedFolderPath] = useState<
		string | null
	>(null);
	const noteContentCache = useRef(new Map<string, NoteContent>());
	/** Live TipTap getters so force-save never misses in-flight keystrokes. */
	const noteLiveContentGetters = useRef(
		new Map<string, () => NoteContent>(),
	);
	const loadedYNoteCache = useRef(new Map<string, LoadedYNote>());
	/** LRU order for non-open-tab warm entries (most-recent last). */
	const warmOrderRef = useRef<string[]>([]);
	const prefetchInFlightRef = useRef(new Set<string>());
	const MAX_WARM_EXTRA = 16;
	const notePersistedCache = useRef(new Map<string, NoteContent>());
	const noteWriteQueue = useRef(new Map<string, Promise<void>>());
	const noteAutosaveTimers = useRef(new Map<string, number>());
	const yjsDerivedAutosaveTimers = useRef(new Map<string, number>());
	const pendingSwitchBenchmark = useRef<{
		direction: 1 | -1;
		notePath: string;
		source: "benchmark" | "tabs";
		start: number;
	} | null>(null);
	const [lockedNotePaths, setLockedNotePaths] = useState<Set<string>>(
		() => new Set(),
	);
	// Paths whose content + yDoc are ready so we can keep a live TipTap instance.
	const [readyEditorPaths, setReadyEditorPaths] = useState<Set<string>>(
		() => new Set(),
	);
	const [trashNotes, setTrashNotes] = useState<TrashNote[]>([]);

	const refreshTrash = useCallback(async () => {
		const trashApi = getTrashEngine();
		if (!trashApi) return;
		try {
			const notes = await trashApi.getContents();
			setTrashNotes(notes);
		} catch {
			// Ignore trash read errors
		}
	}, []);

	const enqueueNoteWrite = useCallback(
		(notePath: string, content: NoteContent) => {
			if (!notesApi) return Promise.resolve();

			const previousWrite =
				noteWriteQueue.current.get(notePath) ?? Promise.resolve();
			const queuedWrite = previousWrite
				.catch(() => undefined)
				.then(() =>
					notesApi.writeNote(notePath, content).then(() => undefined),
				);
			const trackedWrite = queuedWrite
				.catch(() => undefined)
				.finally(() => {
					if (noteWriteQueue.current.get(notePath) === trackedWrite) {
						noteWriteQueue.current.delete(notePath);
					}
				});

			noteWriteQueue.current.set(notePath, trackedWrite);

			return queuedWrite;
		},
		[notesApi],
	);

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

		const isDirty =
			Boolean(latestBody && latestBody !== persistedBody && latestContent);

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

	const activeTab = appState.openTabs.find(
		(tab) => tab.path === appState.activeNotePath,
	);

	const activeNoteTitle =
		(appState.activeNotePath &&
		noteTitleDrafts[appState.activeNotePath] !== undefined
			? noteTitleDrafts[appState.activeNotePath]
			: undefined) ??
		(activeTab?.title || "Untitled");

	const resolvedDefaultPageFormat =
		appState.defaultPageFormat ?? FALLBACK_PAGE_FORMAT;
	const activePageFormat = appState.activeNotePath
		? (pageFormats[appState.activeNotePath] ?? resolvedDefaultPageFormat)
		: resolvedDefaultPageFormat;

	activeNotePathRef.current = appState.activeNotePath;

	// Path set only — reorder must not re-warm yDocs / re-read notes (that caused ~1s drop lag).
	const openTabPathsSignature = useMemo(() => {
		return appState.openTabs
			.map((t) => t.path)
			.slice()
			.sort()
			.join("\0");
	}, [appState.openTabs]);

	useEffect(() => {
		noteContentRef.current = noteContent;

		if (
			appState.activeNotePath &&
			lastLoadedNote.current === appState.activeNotePath
		) {
			noteContentCache.current.set(appState.activeNotePath, noteContent);
		}
	}, [appState.activeNotePath, noteContent]);

	const markEditorReady = useCallback((notePath: string) => {
		if (!noteContentCache.current.has(notePath)) return;
		if (!loadedYNoteCache.current.has(notePath)) return;
		setReadyEditorPaths((current) => {
			if (current.has(notePath)) return current;
			const next = new Set(current);
			next.add(notePath);
			return next;
		});
	}, []);

	const touchWarm = useCallback((notePath: string) => {
		const order = warmOrderRef.current.filter((p) => p !== notePath);
		order.push(notePath);
		warmOrderRef.current = order;
	}, []);

	/** Keep all open-tab docs; LRU-evict other warm yDocs beyond MAX_WARM_EXTRA. */
	const pruneWarmCaches = useCallback((openPaths: Set<string>) => {
		const order = warmOrderRef.current.filter(
			(p) => loadedYNoteCache.current.has(p) || noteContentCache.current.has(p),
		);
		const extras = order.filter((p) => !openPaths.has(p));
		const drop = extras.slice(0, Math.max(0, extras.length - MAX_WARM_EXTRA));
		for (const path of drop) {
			const y = loadedYNoteCache.current.get(path);
			if (y) {
				y.destroy();
				loadedYNoteCache.current.delete(path);
			}
			// Keep plain content cache longer — cheap vs Y.Doc; still bound extras.
			if (!openPaths.has(path) && drop.includes(path)) {
				// content can stay; only yDoc is heavy
			}
		}
		warmOrderRef.current = order.filter((p) => !drop.includes(p));
	}, []);

	const prefetchNote = useCallback(
		(notePath: string) => {
			if (!notePath || !notesApi) return;
			touchWarm(notePath);

			const needContent = !noteContentCache.current.has(notePath);
			const needY = !loadedYNoteCache.current.has(notePath);
			if (!needContent && !needY) {
				const openPaths = new Set(
					useAppStore.getState().openTabs.map((tab) => tab.path),
				);
				pruneWarmCaches(openPaths);
				return;
			}
			if (prefetchInFlightRef.current.has(notePath)) return;
			prefetchInFlightRef.current.add(notePath);

			void (async () => {
				try {
					if (needContent) {
						const content = await notesApi.readNote(notePath);
						if (!noteContentCache.current.has(notePath)) {
							noteContentCache.current.set(notePath, content);
						}
						if (!notePersistedCache.current.has(notePath)) {
							notePersistedCache.current.set(notePath, content);
						}
					}
					if (needY) {
						const note = await loadYNote(notePath);
						if (note && !loadedYNoteCache.current.has(notePath)) {
							loadedYNoteCache.current.set(notePath, note);
						} else if (note) {
							note.destroy();
						}
					}
					touchWarm(notePath);
					const openPaths = new Set(
						useAppStore.getState().openTabs.map((tab) => tab.path),
					);
					// Only mark ready when it's an open tab (live editor).
					if (openPaths.has(notePath)) markEditorReady(notePath);
					pruneWarmCaches(openPaths);
				} catch {
					// Prefetch is best-effort.
				} finally {
					prefetchInFlightRef.current.delete(notePath);
				}
			})();
		},
		[markEditorReady, notesApi, pruneWarmCaches, touchWarm],
	);

	// Keep yDocs warm for every open tab so switching is hide/show, not remount.
	useEffect(() => {
		const openPaths = new Set(appState.openTabs.map((tab) => tab.path));

		// Drop readiness for closed tabs (yDoc destroy happens in closeTab).
		setReadyEditorPaths((current) => {
			let changed = false;
			const next = new Set<string>();
			for (const path of current) {
				if (openPaths.has(path)) next.add(path);
				else changed = true;
			}
			return changed ? next : current;
		});

		let cancelled = false;

		for (const notePath of openPaths) {
			const cached = loadedYNoteCache.current.get(notePath);
			if (cached) {
				markEditorReady(notePath);
				continue;
			}

			loadYNote(notePath)
				.then((note) => {
					if (!note) return;
					if (cancelled) {
						note.destroy();
						return;
					}
					loadedYNoteCache.current.set(notePath, note);
					touchWarm(notePath);
					markEditorReady(notePath);
				})
				.catch(() => {
					if (notePath === activeNotePathRef.current) setSaveStatus("error");
				});
		}

		if (!appState.activeNotePath) {
		}

		return () => {
			cancelled = true;
		};
	}, [appState.activeNotePath, openTabPathsSignature, markEditorReady]);

	// Warm content cache for open tabs so first switch after restore is instant.
	useEffect(() => {
		if (!notesApi) return;
		let cancelled = false;

		for (const tab of appState.openTabs) {
			if (noteContentCache.current.has(tab.path)) {
				markEditorReady(tab.path);
				continue;
			}

			notesApi
				.readNote(tab.path)
				.then((content) => {
					if (cancelled) return;
					if (!noteContentCache.current.has(tab.path)) {
						noteContentCache.current.set(tab.path, content);
					}
					if (!notePersistedCache.current.has(tab.path)) {
						notePersistedCache.current.set(tab.path, content);
					}
					markEditorReady(tab.path);
				})
				.catch(() => undefined);
		}

		return () => {
			cancelled = true;
		};
	}, [openTabPathsSignature, notesApi, markEditorReady]);

	// Keep workspaceRef in sync for non-React space lookups (plan 015).
	useEffect(() => {
		workspaceRef.current = workspace;
	}, [workspace]);

	// Idle-prefetch + active-space event without subscribing Index to
	// activeSpacePath (space switch must not re-render the editor tree).
	useEffect(() => {
		let idleId: number | undefined;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		let cancelled = false;
		let lastSpacePath: string | null = null;

		const clearScheduled = () => {
			if (idleId !== undefined && typeof cancelIdleCallback === "function") {
				cancelIdleCallback(idleId);
				idleId = undefined;
			}
			if (timeoutId !== undefined) {
				clearTimeout(timeoutId);
				timeoutId = undefined;
			}
		};

		const runForSpace = (activeSpacePath: string) => {
			clearScheduled();
			cancelled = false;

			const resolved = resolveSpacePath(
				activeSpacePath,
				workspaceRef.current,
			);
			window.dispatchEvent(
				new CustomEvent("paperite:active-space-change", {
					detail: { path: resolved },
				}),
			);

			if (resolved === "Trash") return;
			const snap = workspaceRef.current;
			if (!snap) return;
			const space = snap.spaces.find((entry) => entry.path === resolved);
			if (!space) return;

			const paths: string[] = [];
			const walk = (items: WorkspaceItem[]) => {
				for (const item of items) {
					if (paths.length >= 8) return;
					if (item.type === "note") paths.push(item.path);
					else walk(item.children);
				}
			};
			walk(space.children);

			let index = 0;
			const schedule = (fn: () => void) => {
				if (typeof requestIdleCallback === "function") {
					idleId = requestIdleCallback(fn, { timeout: 800 });
				} else {
					timeoutId = setTimeout(fn, 32);
				}
			};
			const tick = () => {
				if (cancelled) return;
				while (index < paths.length) {
					const path = paths[index++];
					if (!path) continue;
					if (
						loadedYNoteCache.current.has(path) &&
						noteContentCache.current.has(path)
					) {
						continue;
					}
					prefetchNote(path);
					break;
				}
				if (index < paths.length) schedule(tick);
			};
			schedule(tick);
		};

		lastSpacePath = useAppStore.getState().activeSpacePath;
		runForSpace(lastSpacePath);

		const unsub = useAppStore.subscribe((state) => {
			if (state.activeSpacePath === lastSpacePath) return;
			lastSpacePath = state.activeSpacePath;
			runForSpace(state.activeSpacePath);
		});

		return () => {
			cancelled = true;
			clearScheduled();
			unsub();
		};
	}, [workspace, prefetchNote]);

	useEffect(() => {
		const title = appState.activeNotePath
			? `${displayNoteTitle(activeNoteTitle)} - Paperite`
			: "Paperite";

		document.title = title;
		window.dispatchEvent(new Event("paperite:title-change"));
		window.electron?.app.setTitle(title);
	}, [activeNoteTitle, appState.activeNotePath]);

	const refreshWorkspace = useCallback(async () => {
		if (!notesApi) return;
		const nextWorkspace = await notesApi.getWorkspace();
		setWorkspace(nextWorkspace);
		await refreshTrash();
	}, [notesApi, refreshTrash]);

	const syncExternalWorkspace = useCallback(async () => {
		if (!notesApi) return;

		const nextWorkspace = await notesApi.getWorkspace();
		const notePaths = collectNotePaths(nextWorkspace.spaces);

		workspaceRef.current = nextWorkspace;
		setWorkspace(nextWorkspace);
		setNotePreviews((current) => pickByPaths(current, notePaths));
		setNoteTitleDrafts((current) => pickByPaths(current, notePaths));
		setAppState((current) => reconcileAppState(current, nextWorkspace));

		const activeNotePath = appState.activeNotePath;
		if (!activeNotePath || !notePaths.has(activeNotePath)) return;
		if (
			serializeNoteContentBody(noteContent) !== lastPersistedContent.current
		) {
			return;
		}

		try {
			const content = await notesApi.readNote(activeNotePath);
			if (activeNotePathRef.current !== activeNotePath) return;
			if (
				serializeNoteContentBody(noteContentRef.current) !==
				lastPersistedContent.current
			) {
				return;
			}

			lastLoadedNote.current = activeNotePath;
			lastPersistedContent.current = serializeNoteContentBody(content);
			noteContentCache.current.set(activeNotePath, content);
			notePersistedCache.current.set(activeNotePath, content);
			setNoteContent(content);
			setSaveStatus("saved");
		} catch {
			setSaveStatus("error");
		}
	}, [appState.activeNotePath, noteContent, notesApi]);

	useEffect(() => {
		if (!notesApi) return;

		let cancelled = false;

		const hydrate = async () => {
			const [nextWorkspace, savedState] = await Promise.all([
				notesApi.getWorkspace(),
				notesApi.readAppState(),
			]);

			if (cancelled) return;

			setWorkspace(nextWorkspace);
			setAppState(
				reconcileAppState(
					normalizeAppState({ ...defaultAppState, ...savedState }),
					nextWorkspace,
				),
			);
			didHydrate.current = true;
			// Trash is non-critical for first paint — don't block editor path.
			void refreshTrash();
		};

		hydrate().catch((error) => {
			console.error("[paperite] failed to hydrate workspace", error);
			setSaveStatus("error");
		});

		return () => {
			cancelled = true;
		};
	}, [notesApi, refreshTrash]);

	useEffect(() => {
		if (!notesApi) return;

		return window.electron?.onWorkspaceChanged(() => {
			syncExternalWorkspace();
		});
	}, [notesApi, syncExternalWorkspace]);

	// Persist any app-state change (including tab reorder) without requiring Index to re-render.
	useEffect(() => {
		if (!notesApi) return;

		let timer: ReturnType<typeof setTimeout> | undefined;
		const unsub = useAppStore.subscribe(() => {
			if (!didHydrate.current) return;
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				notesApi.writeAppState(getAppStateSnapshot());
			}, 300);
		});

		return () => {
			unsub();
			if (timer) clearTimeout(timer);
		};
	}, [notesApi]);

	useEffect(() => {
		window.dispatchEvent(
			new CustomEvent("paperite:window-controls-change", {
				detail: { closeButtonOnly: appState.closeButtonOnly },
			}),
		);
	}, [appState.closeButtonOnly]);

	useEffect(() => {
		if (!floatingPanelMode) return;

		findInputRef.current?.focus();
	}, [floatingPanelMode]);

	useEffect(() => {
		if (floatingPanelMode) {
			// Single shared panel: switching modes replaces content in-place
			// (no close animation between info/find/setup/replace).
			floatingPanelLastMode.current = floatingPanelMode;
			setFloatingPanelVisible(true);
		}
	}, [floatingPanelMode]);

	useEffect(() => {
		if (zenMode) {
			setFloatingPanelMode(null);
		}
	}, [zenMode]);

	useEffect(() => {
		const handleToggleZenMode = (event: CustomEvent<{ enabled?: boolean }>) => {
			if (event.detail?.enabled !== undefined) {
				setZenMode(event.detail.enabled);
			} else {
				setZenMode((current) => !current);
			}
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				window.dispatchEvent(
					new CustomEvent("paperite:toggle-zen-mode", {
						detail: { enabled: false },
					}),
				);
			}
		};

		window.addEventListener(
			"paperite:toggle-zen-mode",
			handleToggleZenMode as EventListener,
		);
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener(
				"paperite:toggle-zen-mode",
				handleToggleZenMode as EventListener,
			);
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, []);

	useEffect(() => {
		if (!window.electron) return;

		const cleanup = window.electron.onPopoutClosed((notePath) => {
			setLockedNotePaths((prev) => {
				const next = new Set(prev);
				next.delete(notePath);
				return next;
			});
		});

		return cleanup;
	}, []);

	useEffect(() => {
		if (!notesApi || !appState.activeNotePath) {
			lastLoadedNote.current = null;
			setLoadedNotePath(null);
			return;
		}

		const notePath = appState.activeNotePath;

		// Editor already mounted for this tab — just point refs at the cache.
		// Zero setState: switching tabs must not re-render TipTap instances.
		if (
			readyEditorPaths.has(notePath) &&
			noteContentCache.current.has(notePath)
		) {
			const cached = noteContentCache.current.get(notePath)!;
			const persisted = notePersistedCache.current.get(notePath);
			lastLoadedNote.current = notePath;
			noteContentRef.current = cached;
			lastPersistedContent.current = persisted
				? serializeNoteContentBody(persisted)
				: serializeNoteContentBody(cached);
			return;
		}

		let cancelled = false;

		const loadNote = async () => {
			const cachedContent = noteContentCache.current.get(notePath);
			const persistedContent = notePersistedCache.current.get(notePath);
			setNotePreviews((current) => omitExact(current, notePath));

			// Fast path: trust in-memory cache on tab switch. Skip the IPC
			// round-trip so the editor paints immediately.
			if (cachedContent !== undefined) {
				const cachedSerialized = serializeNoteContent(cachedContent);
				const persistedSerialized = persistedContent
					? serializeNoteContent(persistedContent)
					: "";
				const isDirty =
					persistedContent !== undefined &&
					cachedSerialized !== persistedSerialized;

				lastLoadedNote.current = notePath;
				lastPersistedContent.current = persistedContent
					? serializeNoteContentBody(persistedContent)
					: serializeNoteContentBody(cachedContent);
				setNoteContent(cachedContent);
				setLoadedNotePath(notePath);
				setSaveStatus(
					persistedContent ? (isDirty ? "saving" : "saved") : "idle",
				);

				// Already in cache + we know the persisted snapshot → done.
				if (persistedContent !== undefined) {
					markEditorReady(notePath);
					return;
				}
			} else {
				setSaveStatus("idle");
				lastLoadedNote.current = null;
				lastPersistedContent.current = "";
				setLoadedNotePath(null);
				setNoteContent(createEmptyNoteContent());
			}

			const readStart = performance.now();
			const content = await notesApi.readNote(notePath);
			const readDuration = performance.now() - readStart;

			if (cancelled) return;

			const currentCachedContent = noteContentCache.current.get(notePath);
			const currentPersistedContent = notePersistedCache.current.get(notePath);
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
				(noteWriteQueue.current.has(notePath) ||
					currentPersistedSerialized === undefined ||
					currentCachedSerialized !== currentPersistedSerialized);

			if (hasDirtyCachedContent) {
				lastLoadedNote.current = notePath;
				lastPersistedContent.current =
					currentPersistedSerializedBody ?? readSerializedBody;
				if (!currentPersistedContent) {
					notePersistedCache.current.set(notePath, content);
				}
				setLoadedNotePath(notePath);
				setSaveStatus("saving");
				markEditorReady(notePath);
				return;
			}

			lastLoadedNote.current = notePath;
			lastPersistedContent.current = readSerializedBody;
			noteContentCache.current.set(notePath, content);
			notePersistedCache.current.set(notePath, content);
			setNoteContent(content);
			setLoadedNotePath(notePath);
			setSaveStatus("saved");
			markEditorReady(notePath);
			// Safety net: drop assets not referenced on disk (crash / force-quit orphans).
			void notesApi.pruneAssets?.(notePath).catch(() => undefined);

			if (readDuration > 16) {
				console.info(
					`[paperite perf] readNote ${readDuration.toFixed(1)}ms ${notePath}`,
				);
			}
		};

		loadNote().catch(() => setSaveStatus("error"));

		return () => {
			cancelled = true;
		};
	}, [appState.activeNotePath, notesApi, markEditorReady, readyEditorPaths]);

	useEffect(
		() => () => {
			for (const timer of noteAutosaveTimers.current.values()) {
				window.clearTimeout(timer);
			}
			for (const timer of yjsDerivedAutosaveTimers.current.values()) {
				window.clearTimeout(timer);
			}
			noteAutosaveTimers.current.clear();
			yjsDerivedAutosaveTimers.current.clear();
		},
		[],
	);

	useEffect(
		() => () => {
			for (const note of loadedYNoteCache.current.values()) {
				note.destroy();
			}
			loadedYNoteCache.current.clear();
		},
		[],
	);

	// debug: log workspace note order changes
	useEffect(() => {
		if (!workspace) return;
		const notes: { path: string; updatedAt: number }[] = [];
		for (const space of workspace.spaces) {
			const collect = (items: WorkspaceItem[]) => {
				for (const item of items) {
					if (item.type === "note") notes.push(item);
					if (item.type === "folder") collect(item.children);
				}
			};
			collect(space.children);
		}
	}, [workspace]);

	const visibleSpaces = useMemo(() => {
		const decoratedSpaces = applyNoteDecorations(
			workspace?.spaces ?? [],
			notePreviews,
			noteTitleDrafts,
		);

		return orderSpaces(decoratedSpaces, appState.spaceOrder);
	}, [appState.spaceOrder, workspace, notePreviews, noteTitleDrafts]);

	const setActiveSpacePath = useCallback((path: string) => {
		setAppState((current) =>
			current.activeSpacePath === path
				? current
				: { ...current, activeSpacePath: path },
		);
	}, []);

	const reorderSpaces = useCallback((spaceOrder: string[]) => {
		setAppState((current) => ({ ...current, spaceOrder }));
	}, []);

	const reorderItems = useCallback(
		(parentPath: string, itemOrder: string[]) => {
			if (topLevelPath(parentPath) === "Inbox") return;

			setAppState((current) => ({
				...current,
				customItemOrders: {
					...current.customItemOrders,
					[parentPath]: unique(itemOrder),
				},
			}));
		},
		[],
	);

	const openNote = useCallback(
		(note: WorkspaceNote, mode: "preview" | "fixed") => {
			setAppState((current) => {
				const existing = current.openTabs.find((tab) => tab.path === note.path);
				const previewIndex = current.openTabs.findIndex((tab) => tab.preview);
				const nextTab: OpenNoteTab = {
					path: note.path,
					title: note.title,
					preview: mode === "preview" && !existing,
					pinned: false,
				};

				const noopClick =
					existing !== undefined &&
					current.activeNotePath === note.path &&
					(mode !== "fixed" || existing.preview === false);
				if (noopClick) return current;

				const openTabs = existing
					? mode === "fixed" && existing.preview
						? current.openTabs.map((tab) =>
								tab.path === note.path ? { ...tab, preview: false } : tab,
							)
						: current.openTabs
					: replaceOrAppendPreviewTab(current.openTabs, nextTab, previewIndex);

				return {
					...current,
					activeNotePath: note.path,
					activeSpacePath: topLevelPath(note.path),
					openTabs,
				};
			});
		},
		[],
	);

	const closeTab = useCallback(
		(path: string, _options: { flush?: boolean } = {}) => {
			// Soft-close: keep yDoc warm for fast reopen; LRU prunes later.
			touchWarm(path);
			setReadyEditorPaths((current) => {
				if (!current.has(path)) return current;
				const next = new Set(current);
				next.delete(path);
				return next;
			});

			setAppState((current) => {
				const tabIndex = current.openTabs.findIndex((tab) => tab.path === path);
				const openTabs = current.openTabs.filter((tab) => tab.path !== path);
				const fallbackTab = openTabs[Math.max(0, tabIndex - 1)] ?? openTabs[0];

				return {
					...current,
					activeNotePath:
						current.activeNotePath === path
							? (fallbackTab?.path ?? null)
							: current.activeNotePath,
					openTabs,
				};
			});
			const openPaths = new Set(
				useAppStore.getState().openTabs.map((tab) => tab.path),
			);
			openPaths.delete(path);
			pruneWarmCaches(openPaths);
			// Drop orphan assets once the tab session ends (undo stack is gone).
			void notesApi?.pruneAssets?.(path).catch(() => undefined);
		},
		[notesApi, pruneWarmCaches, touchWarm],
	);

	const switchTab = useCallback(
		(direction: 1 | -1, source: "benchmark" | "tabs" = "tabs") => {
			setAppState((current) => {
				if (current.openTabs.length < 2) return current;

				const activeIndex = current.openTabs.findIndex(
					(tab) => tab.path === current.activeNotePath,
				);
				const currentIndex = activeIndex === -1 ? 0 : activeIndex;
				const nextIndex =
					(currentIndex + direction + current.openTabs.length) %
					current.openTabs.length;
				const nextTab = current.openTabs[nextIndex];

				pendingSwitchBenchmark.current = {
					direction,
					notePath: nextTab.path,
					source,
					start: performance.now(),
				};

				return {
					...current,
					activeNotePath: nextTab.path,
					activeSpacePath: topLevelPath(nextTab.path),
				};
			});
		},
		[],
	);

	const createNote = useCallback(
		async (parentPath: string) => {
			if (!notesApi) return;

			try {
				const note = await notesApi.createNote(parentPath, "Untitled");
				await refreshWorkspace();
				setNoteTitleDrafts((current) => ({ ...current, [note.path]: "" }));
				openNote(
					{
						type: "note",
						preview: "",
						updatedAt: Date.now(),
						pinned: false,
						...note,
						title: "",
					},
					"fixed",
				);
			} catch {
				setSaveStatus("error");
			}
		},
		[notesApi, openNote, refreshWorkspace],
	);

	const createFolder = useCallback(
		async (parentPath: string) => {
			if (!notesApi) return;

			try {
				const folder = await notesApi.createFolder(parentPath, "Untitled");
				setAppState((current) => ({
					...current,
					expandedFolders: unique([
						...current.expandedFolders,
						parentPath,
						folder.path,
					]),
				}));
				await refreshWorkspace();
				setNewlyCreatedFolderPath(folder.path);
			} catch {
				setSaveStatus("error");
			}
		},
		[notesApi, refreshWorkspace],
	);

	const handleRenameComplete = useCallback(
		() => setNewlyCreatedFolderPath(null),
		[],
	);

	const openNoteInfo = useCallback((target: NoteInfoTarget) => {
		setNoteInfoTarget(target);
		setFloatingPanelMode("info");
	}, []);

	useEffect(() => {
		const spaceAtEvent = () =>
			resolveSpacePath(
				useAppStore.getState().activeSpacePath,
				workspaceRef.current,
			);
		const createNoteFromMenu = () => createNote(spaceAtEvent());
		const createFolderFromMenu = () => {
			const space = spaceAtEvent();
			if (space !== "Inbox") createFolder(space);
		};
		const openNoteSetup = () => setFloatingPanelMode("format");
		const openNoteInfoFromEvent = (event: CustomEvent<NoteInfoTarget>) => {
			if (!event.detail?.path) return;
			openNoteInfo({
				path: event.detail.path,
				title: event.detail.title || "Untitled",
			});
		};

		const refreshFromEvent = () => {
			void refreshWorkspace();
		};
		window.addEventListener("paperite:create-note", createNoteFromMenu);
		window.addEventListener("paperite:create-folder", createFolderFromMenu);
		window.addEventListener("paperite:note-setup", openNoteSetup);
		window.addEventListener("paperite:refresh-workspace", refreshFromEvent);
		window.addEventListener(
			"paperite:note-info",
			openNoteInfoFromEvent as EventListener,
		);

		return () => {
			window.removeEventListener("paperite:create-note", createNoteFromMenu);
			window.removeEventListener(
				"paperite:refresh-workspace",
				refreshFromEvent,
			);
			window.removeEventListener(
				"paperite:create-folder",
				createFolderFromMenu,
			);
			window.removeEventListener("paperite:note-setup", openNoteSetup);
			window.removeEventListener(
				"paperite:note-info",
				openNoteInfoFromEvent as EventListener,
			);
		};
	}, [createNote, createFolder, openNoteInfo, refreshWorkspace]);

	const createSpace = async (title: string, color: string, icon: string) => {
		if (!notesApi) return;

		try {
			const space = await notesApi.createSpace(title);
			setAppState((current) => ({
				...current,
				activeSpacePath: space.path,
				spaceColors: { ...current.spaceColors, [space.path]: color },
				spaceIcons: { ...current.spaceIcons, [space.path]: icon },
			}));
			await refreshWorkspace();
		} catch {
			setSaveStatus("error");
		}
	};

	const editSpace = async (
		path: string,
		title: string,
		color: string,
		icon: string,
	) => {
		if (!notesApi) return;
		if (!title.trim()) return;

		try {
			const renamed =
				title.trim() === fileName(path)
					? { path }
					: await notesApi.renameItem(path, title);
			if (renamed.path !== path) moveNoteRuntimeState(path, renamed.path);
			setAppState((current) => ({
				...current,
				activeNotePath:
					current.activeNotePath &&
					isSameOrChildPath(path, current.activeNotePath)
						? movePath(current.activeNotePath, path, renamed.path)
						: current.activeNotePath,
				activeSpacePath:
					current.activeSpacePath === path
						? renamed.path
						: current.activeSpacePath,
				expandedFolders: current.expandedFolders.map((folderPath) =>
					isSameOrChildPath(path, folderPath)
						? movePath(folderPath, path, renamed.path)
						: folderPath,
				),
				openTabs: current.openTabs.map((tab) =>
					isSameOrChildPath(path, tab.path)
						? { ...tab, path: movePath(tab.path, path, renamed.path) }
						: tab,
				),
				spaceColors: {
					...moveDecorations(current.spaceColors, path, renamed.path),
					[renamed.path]: color,
				},
				spaceIcons: {
					...moveDecorations(current.spaceIcons, path, renamed.path),
					[renamed.path]: icon,
				},
				spaceSortOrders: moveDecorations(
					current.spaceSortOrders,
					path,
					renamed.path,
				),
				spaceFolderFirst: moveDecorations(
					current.spaceFolderFirst,
					path,
					renamed.path,
				),
				spacePreviewModes: moveDecorations(
					current.spacePreviewModes,
					path,
					renamed.path,
				),
				customItemOrders: moveCustomItemOrders(
					current.customItemOrders,
					path,
					renamed.path,
				),
			}));
			setNotePreviews((current) =>
				moveDecorations(current, path, renamed.path),
			);
			setNoteTitleDrafts((current) =>
				moveDecorations(current, path, renamed.path),
			);
			setPageFormats((current) => moveDecorations(current, path, renamed.path));
			await refreshWorkspace();
		} catch {
			setSaveStatus("error");
		}
	};

	const deleteSpace = async (path: string) => {
		if (!notesApi || path === "Inbox") return;

		try {
			clearAutosavesForPath(path);
			await notesApi.deleteItem(path);
			setAppState((current) => ({
				...current,
				activeNotePath:
					current.activeNotePath &&
					isSameOrChildPath(path, current.activeNotePath)
						? null
						: current.activeNotePath,
				activeSpacePath:
					current.activeSpacePath === path ? "Inbox" : current.activeSpacePath,
				expandedFolders: current.expandedFolders.filter(
					(folderPath) => !isSameOrChildPath(path, folderPath),
				),
				openTabs: current.openTabs.filter(
					(tab) => !isSameOrChildPath(path, tab.path),
				),
				spaceColors: omitDecoration(current.spaceColors, path),
				spaceIcons: omitDecoration(current.spaceIcons, path),
				spaceSortOrders: omitDecoration(current.spaceSortOrders, path),
				spaceFolderFirst: omitDecoration(current.spaceFolderFirst, path),
				spacePreviewModes: omitDecoration(current.spacePreviewModes, path),
				customItemOrders: omitCustomItemOrders(current.customItemOrders, path),
			}));
			setNotePreviews((current) => omitDecoration(current, path));
			setNoteTitleDrafts((current) => omitDecoration(current, path));
			setPageFormats((current) => omitDecoration(current, path));
			await refreshWorkspace();
		} catch {
			setSaveStatus("error");
		}
	};

	const toggleFolder = useCallback((path: string, isOpen: boolean) => {
		// Low-priority update: sidebar already painted via local expand state.
		// Avoid blocking the main thread with a full Index + TipTap re-render.
		startTransition(() => {
			setAppState((current) => ({
				...current,
				expandedFolders: isOpen
					? unique([...current.expandedFolders, path])
					: current.expandedFolders.filter((folderPath) => folderPath !== path),
			}));
		});
	}, []);

	const moveItem = async (itemPath: string, nextParentPath: string) => {
		if (!notesApi) return;

		try {
			const moved = await notesApi.moveItem(itemPath, nextParentPath);
			if (moved.path !== itemPath) moveNoteRuntimeState(itemPath, moved.path);
			setAppState((current) => ({
				...current,
				activeNotePath:
					current.activeNotePath &&
					isSameOrChildPath(itemPath, current.activeNotePath)
						? movePath(current.activeNotePath, itemPath, moved.path)
						: current.activeNotePath,
				activeSpacePath:
					current.activeNotePath &&
					isSameOrChildPath(itemPath, current.activeNotePath)
						? topLevelPath(moved.path)
						: current.activeSpacePath,
				expandedFolders: unique([...current.expandedFolders, nextParentPath]),
				openTabs: current.openTabs.map((tab) =>
					isSameOrChildPath(itemPath, tab.path)
						? {
								...tab,
								path: movePath(tab.path, itemPath, moved.path),
								title: tab.title,
							}
						: tab,
				),
				customItemOrders: moveCustomItemOrders(
					current.customItemOrders,
					itemPath,
					moved.path,
				),
			}));
			setNotePreviews((current) =>
				moveDecorations(current, itemPath, moved.path),
			);
			setNoteTitleDrafts((current) =>
				moveDecorations(current, itemPath, moved.path),
			);
			setPageFormats((current) =>
				moveDecorations(current, itemPath, moved.path),
			);
			await refreshWorkspace();
		} catch {
			setSaveStatus("error");
		}
	};

	const renameActiveNote = useCallback(
		async (title: string) => {
			if (!notesApi || !activeNotePathRef.current) return;

			try {
				const previousPath = activeNotePathRef.current;
				const renamed = await notesApi.renameItem(previousPath, title);
				const nextTitle =
					renamed.path === previousPath
						? title
						: stripNoteExtension(fileName(renamed.path));

				const cachedContent = noteContentCache.current.get(previousPath);
				if (cachedContent !== undefined) {
					noteContentCache.current.set(renamed.path, cachedContent);
					noteContentCache.current.delete(previousPath);
					const persistedContent = notePersistedCache.current.get(previousPath);
					if (persistedContent !== undefined) {
						notePersistedCache.current.set(renamed.path, persistedContent);
						notePersistedCache.current.delete(previousPath);
					}
					lastLoadedNote.current = renamed.path;
					lastPersistedContent.current =
						serializeNoteContentBody(cachedContent);
					if (renamed.path === previousPath) {
						const updated = { ...cachedContent, title: nextTitle };
						noteContentCache.current.set(renamed.path, updated);
						setNoteContent(updated);
					} else {
						setNoteContent(cachedContent);
					}
					setLoadedNotePath(renamed.path);
				}

				setAppState((current) => ({
					...current,
					activeNotePath: renamed.path,
					activeSpacePath: topLevelPath(renamed.path),
					openTabs: current.openTabs.map((tab) =>
						tab.path === previousPath
							? { ...tab, path: renamed.path, title: nextTitle }
							: tab,
					),
					customItemOrders: moveCustomItemOrders(
						current.customItemOrders,
						previousPath,
						renamed.path,
					),
				}));
				setNotePreviews((current) => {
					const { [previousPath]: preview, ...rest } = current;
					return preview ? { ...rest, [renamed.path]: preview } : rest;
				});
				setNoteTitleDrafts((current) => {
					const { [previousPath]: _previousTitle, ...rest } = current;
					return { ...rest, [renamed.path]: nextTitle };
				});
				setPageFormats((current) =>
					moveDecorations(current, previousPath, renamed.path),
				);
				await refreshWorkspace();
			} catch {
				setSaveStatus("error");
			}
		},
		[notesApi, refreshWorkspace],
	);

	const deleteActiveNote = async () => {
		if (!notesApi || !appState.activeNotePath) return;

		const notePath = appState.activeNotePath;

		try {
			clearAutosavesForPath(notePath);
			await notesApi.deleteItem(notePath);
			closeTab(notePath, { flush: false });
			setAppState((current) => ({
				...current,
				customItemOrders: omitCustomItemOrders(
					current.customItemOrders,
					notePath,
				),
			}));
			setNotePreviews((current) => {
				const { [notePath]: _preview, ...rest } = current;
				return rest;
			});
			setNoteTitleDrafts((current) => {
				const { [notePath]: _title, ...rest } = current;
				return rest;
			});
			setPageFormats((current) => omitExact(current, notePath));
			await refreshWorkspace();
		} catch {
			setSaveStatus("error");
		}
	};

	const renameItem = async (path: string, title: string) => {
		if (!notesApi || !title.trim()) return;

		try {
			const renamed = await notesApi.renameItem(path, title);
			const nextTitle =
				renamed.path === path
					? title
					: stripNoteExtension(fileName(renamed.path));
			if (renamed.path !== path) moveNoteRuntimeState(path, renamed.path);

			setAppState((current) => ({
				...current,
				activeNotePath:
					current.activeNotePath &&
					isSameOrChildPath(path, current.activeNotePath)
						? movePath(current.activeNotePath, path, renamed.path)
						: current.activeNotePath,
				activeSpacePath:
					current.activeSpacePath === path
						? renamed.path
						: current.activeSpacePath,
				expandedFolders: current.expandedFolders.map((folderPath) =>
					isSameOrChildPath(path, folderPath)
						? movePath(folderPath, path, renamed.path)
						: folderPath,
				),
				openTabs: current.openTabs.map((tab) =>
					isSameOrChildPath(path, tab.path)
						? {
								...tab,
								path: movePath(tab.path, path, renamed.path),
								title: tab.path === path ? nextTitle : tab.title,
							}
						: tab,
				),
				customItemOrders: moveCustomItemOrders(
					current.customItemOrders,
					path,
					renamed.path,
				),
			}));
			setNotePreviews((current) =>
				moveDecorations(current, path, renamed.path),
			);
			setNoteTitleDrafts((current) =>
				moveDecorations(current, path, renamed.path),
			);
			setPageFormats((current) => moveDecorations(current, path, renamed.path));
			await refreshWorkspace();
		} catch {
			setSaveStatus("error");
		}
	};

	const deleteItem = async (path: string) => {
		if (!notesApi) return;

		try {
			clearAutosavesForPath(path);
			await notesApi.deleteItem(path);
			setAppState((current) => ({
				...current,
				activeNotePath:
					current.activeNotePath &&
					isSameOrChildPath(path, current.activeNotePath)
						? null
						: current.activeNotePath,
				expandedFolders: current.expandedFolders.filter(
					(folderPath) => !isSameOrChildPath(path, folderPath),
				),
				openTabs: current.openTabs.filter(
					(tab) => !isSameOrChildPath(path, tab.path),
				),
				customItemOrders: omitCustomItemOrders(current.customItemOrders, path),
			}));
			setNotePreviews((current) => omitDecoration(current, path));
			setNoteTitleDrafts((current) => omitDecoration(current, path));
			setPageFormats((current) => omitDecoration(current, path));
			await refreshWorkspace();
		} catch {
			setSaveStatus("error");
		}
	};

	const restoreTrashItem = async (trashNoteName: string) => {
		const trashApi = getTrashEngine();
		if (!trashApi) return;

		try {
			await trashApi.restoreItem(trashNoteName);
			await refreshTrash();
			await refreshWorkspace();
		} catch {
			setSaveStatus("error");
		}
	};

	const permanentDeleteItem = async (trashNoteName: string) => {
		const trashApi = getTrashEngine();
		if (!trashApi) return;

		try {
			await trashApi.permanentDeleteItem(trashNoteName);
			await refreshTrash();
		} catch {
			setSaveStatus("error");
		}
	};

	const emptyTrash = async () => {
		const trashApi = getTrashEngine();
		if (!trashApi) return;

		try {
			await trashApi.emptyTrash();
			await refreshTrash();
		} catch {
			setSaveStatus("error");
		}
	};

	const replaceInNote = () => {
		if (!findText) return;
		setNoteContent((current) =>
			replaceInNoteContent(current, findText, replaceText, false),
		);
	};

	const replaceAllInNote = () => {
		if (!findText) return;
		setNoteContent((current) =>
			replaceInNoteContent(current, findText, replaceText, true),
		);
	};

	const updateActiveTitleDraft = useCallback((title: string) => {
		const notePath = activeNotePathRef.current;
		if (!notePath) return;
		// Live labels only — do not touch Index state / openTabs / spaces tree.
		useEditorUiStore.getState().setTitleDraft(notePath, title);
	}, []);

	const updateActivePageFormat = useCallback(
		(patch: Partial<PageFormat>) => {
			if (!appState.activeNotePath) return;

			setPageFormats((current) => ({
				...current,
				[appState.activeNotePath as string]: {
					...(current[appState.activeNotePath as string] ?? resolvedDefaultPageFormat),
					...patch,
				},
			}));
		},
		[appState.activeNotePath, resolvedDefaultPageFormat],
	);

	const updateNoteContent = useCallback(
		(
			nextContent: NoteContent,
			sourceNotePath: string | null,
			isUserEdit: boolean,
		) => {
			if (!sourceNotePath) return;

			// TipTap owns the live doc per mounted tab. Cache drives autosave.
			// Only mirror into the active noteContentRef (exports / find-replace).
			noteContentCache.current.set(sourceNotePath, nextContent);
			if (sourceNotePath === activeNotePathRef.current) {
				noteContentRef.current = nextContent;
			}

			if (isUserEdit) {
				// Promote preview tab once — avoid setState when already pinned.
				setAppState((current) => {
					const tab = current.openTabs.find((t) => t.path === sourceNotePath);
					if (!tab?.preview) return current;
					return {
						...current,
						openTabs: current.openTabs.map((t) =>
							t.path === sourceNotePath ? { ...t, preview: false } : t,
						),
					};
				});
			} else {
				// External / programmatic content (find-replace, sync) needs React state.
				setNoteContent(nextContent);
			}

			// Prefer yjs-derived write when this note has a live yDoc.
			if (loadedYNoteCache.current.has(sourceNotePath)) {
				scheduleYjsDerivedAutosave(sourceNotePath, nextContent);
				return;
			}

			scheduleNoteAutosave(sourceNotePath, nextContent);
		},
		[scheduleNoteAutosave, scheduleYjsDerivedAutosave],
	);

	
	useEffect(() => {
		const handleShortcut = (event: KeyboardEvent) => {
			if (event.repeat) return;

			const zenShortcut = getShortcut("view.toggleZen");
			const sidebarShortcut = getShortcut("view.toggleSidebar");
			const noteSetupShortcut = getShortcut("note.setup");
			const saveShortcut = getShortcut("note.saveAndSync");
			const isGlobalViewShortcut =
				shortcutMatchesEvent(zenShortcut, event) ||
				shortcutMatchesEvent(sidebarShortcut, event) ||
				shortcutMatchesEvent(noteSetupShortcut, event);
			const isSaveShortcut = shortcutMatchesEvent(saveShortcut, event);

			// Force-save must work while typing in the editor / title.
			if (isShortcutEditableInput(event.target) && !isGlobalViewShortcut && !isSaveShortcut)
				return;

			if (isSaveShortcut) {
				event.preventDefault();
				void flushSaveAndSync();
				return;
			}

			if (shortcutMatchesEvent(getShortcut("note.create"), event)) {
				event.preventDefault();
				createNote(
					resolveSpacePath(
						useAppStore.getState().activeSpacePath,
						workspaceRef.current,
					),
				);
				return;
			}

			if (shortcutMatchesEvent(getShortcut("folder.create"), event)) {
				event.preventDefault();
				const space = resolveSpacePath(
					useAppStore.getState().activeSpacePath,
					workspaceRef.current,
				);
				if (space !== "Inbox") createFolder(space);
				return;
			}

			if (shortcutMatchesEvent(getShortcut("note.setup"), event)) {
				event.preventDefault();
				setFloatingPanelMode("format");
				return;
			}

			if (shortcutMatchesEvent(getShortcut("note.find"), event)) {
				event.preventDefault();
				setFloatingPanelMode("find");
				return;
			}

			if (shortcutMatchesEvent(getShortcut("note.replace"), event)) {
				event.preventDefault();
				setFloatingPanelMode("replace");
				return;
			}

			if (shortcutMatchesEvent(getShortcut("tab.next"), event)) {
				event.preventDefault();
				switchTab(1);
				return;
			}

			if (shortcutMatchesEvent(getShortcut("tab.previous"), event)) {
				event.preventDefault();
				switchTab(-1);
				return;
			}

			if (shortcutMatchesEvent(getShortcut("tab.close"), event)) {
				event.preventDefault();
				if (appState.activeNotePath) closeTab(appState.activeNotePath);
				return;
			}

			if (shortcutMatchesEvent(zenShortcut, event)) {
				event.preventDefault();
				window.dispatchEvent(new Event("paperite:toggle-zen-mode"));
				return;
			}

			if (shortcutMatchesEvent(sidebarShortcut, event)) {
				event.preventDefault();
				window.dispatchEvent(new Event("paperite:toggle-sidebar"));
			}
		};

		window.addEventListener("keydown", handleShortcut);
		return () => window.removeEventListener("keydown", handleShortcut);
	}, [
		appState.activeNotePath,
		closeTab,
		createFolder,
		createNote,
		flushSaveAndSync,
		getShortcut,
		switchTab,
	]);

	const selectTab = useCallback((notePath: string) => {
		// Urgent update — startTransition made switches feel delayed.
		setAppState((current) => {
			if (current.activeNotePath === notePath) return current;
			return {
				...current,
				activeNotePath: notePath,
				activeSpacePath: topLevelPath(notePath),
			};
		});
	}, []);

	const fixTab = useCallback((notePath: string) => {
		setAppState((current) => {
			const tab = current.openTabs.find((t) => t.path === notePath);
			if (!tab?.preview) return current;
			return {
				...current,
				openTabs: current.openTabs.map((t) =>
					t.path === notePath ? { ...t, preview: false } : t,
				),
			};
		});
	}, []);

	const togglePinTab = useCallback((notePath: string) => {
		setAppState((current) => {
			const tab = current.openTabs.find((t) => t.path === notePath);
			if (!tab) return current;
			return {
				...current,
				openTabs: current.openTabs.map((t) =>
					t.path === notePath ? { ...t, pinned: !t.pinned, preview: false } : t,
				),
			};
		});
	}, []);

	const spaceTitleFor = useCallback(
		(spacePath: string) => {
			if (spacePath === "Inbox") return "Inbox";
			const space = visibleSpaces.find((entry) => entry.path === spacePath);
			return space?.title ?? spacePath;
		},
		[visibleSpaces],
	);

	const sidebarProviderStyle = useMemo(
		() =>
			({
				"--sidebar-width": "14.5rem",
			} as CSSProperties),
		[],
	);

	const completeSwitchBenchmark = useCallback((notePath: string) => {
		const benchmark = pendingSwitchBenchmark.current;

		if (!benchmark || benchmark.notePath !== notePath) return;

		pendingSwitchBenchmark.current = null;
		const duration = performance.now() - benchmark.start;

		console.info(
			`[paperite perf] ${benchmark.source} switch ${benchmark.direction === 1 ? "next" : "previous"} ${duration.toFixed(1)}ms ${notePath}`,
		);
	}, []);

	if (!notesApi) {
		return (
			<div className="grid h-full place-items-center text-sm text-muted-foreground">
				{import.meta.env.PAPERITE_WEB
					? "Connecting to Paperite server..."
					: "Paperite needs the Electron shell to access local notes."}
			</div>
		);
	}

	return (
		<PersistedSidebarProvider
			className="h-full min-h-0"
			style={sidebarProviderStyle}
		>
			{zenMode ? null : (
				<>
					<SidebarHotkeys />
					<AppSidebar
						spaces={visibleSpaces}
						onReorderItems={reorderItems}
						onCreateFolder={createFolder}
						onCreateNote={createNote}
						onCreateSpace={createSpace}
						onDeleteItem={deleteItem}
						onDeleteSpace={deleteSpace}
						onEditSpace={editSpace}
						onMoveItem={moveItem}
						onOpenNote={openNote}
						onPrefetchNote={prefetchNote}
						onRenameItem={renameItem}
						onReorderSpaces={reorderSpaces}
						onSelectSpace={setActiveSpacePath}
						onToggleFolder={toggleFolder}
						trashNotes={trashNotes}
						onRestoreItem={restoreTrashItem}
						onPermanentDeleteItem={permanentDeleteItem}
						onEmptyTrash={emptyTrash}
						newlyCreatedFolderPath={newlyCreatedFolderPath}
						onRenameComplete={handleRenameComplete}
					/>
				</>
			)}
			<NoteWorkspace>
				{zenMode || !appState.activeNotePath ? null : (
					<header className="relative z-10 flex h-12 shrink-0 items-stretch gap-3 px-3 transition-[width,height] ease-linear after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-8 after:bg-linear-to-b after:from-background after:to-transparent after:content-['']">
						<div className="flex shrink-0 items-center min-[56.0625rem]:hidden">
							<SidebarTrigger
								toggleNotesSheet
								className="text-muted-foreground min-[56.0625rem]:hidden"
							/>
						</div>
						<TabBar
							spaceTitleFor={spaceTitleFor}
							onSelect={selectTab}
							onDoubleClick={fixTab}
							onClose={closeTab}
							onTogglePin={togglePinTab}
						/>
						<div className="flex shrink-0 items-center gap-2">
							<SaveStatusBadge onVerify={verifyNoteSave} />
							<ReadOnlyToggleButton />
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="text-muted-foreground"
										aria-label="More note actions"
									>
										<MoreVerticalIcon />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="w-56">
									<DropdownMenuItem
										onSelect={() => {
											if (!appState.activeNotePath) return;
											openNoteInfo({
												path: appState.activeNotePath,
												title: activeNoteTitle,
											});
										}}
									>
										<InfoIcon />
										Note Info
									</DropdownMenuItem>
									<DropdownMenuItem
										onSelect={() => {
											setFloatingPanelMode("format");
										}}
									>
										<span className="size-4" />
										Note setup...
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										disabled={
											!appState.activeNotePath ||
											lockedNotePaths.has(appState.activeNotePath)
										}
										onSelect={() => {
											const activePath = appState.activeNotePath;
											if (activePath && window.electron) {
												window.electron.notes
													.popoutNote(activePath)
													.then(() => {
														setLockedNotePaths((prev) => {
															const next = new Set(prev);
															next.add(activePath);
															return next;
														});
													});
											}
										}}
									>
										<ExternalLinkIcon />
										{appState.activeNotePath &&
										lockedNotePaths.has(appState.activeNotePath)
											? "Already open in window"
											: "Pop out note"}
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuSub>
										<DropdownMenuSubTrigger>
											<span className="size-4" />
											Copy as…
										</DropdownMenuSubTrigger>
										<DropdownMenuPortal>
											<DropdownMenuSubContent>
												<DropdownMenuItem
													onSelect={() => {
														const text = noteContentText(
															noteContentRef.current,
														);
														navigator.clipboard.writeText(text);
													}}
												>
													Plain text
												</DropdownMenuItem>
												<DropdownMenuItem
													onSelect={() => {
														const md = noteContentToMarkdown(
															noteContentRef.current,
														);
														navigator.clipboard.writeText(md);
													}}
												>
													Markdown
												</DropdownMenuItem>
											</DropdownMenuSubContent>
										</DropdownMenuPortal>
									</DropdownMenuSub>
									<DropdownMenuSub>
										<DropdownMenuSubTrigger>
											<span className="size-4" />
											Export as…
										</DropdownMenuSubTrigger>
										<DropdownMenuPortal>
											<DropdownMenuSubContent>
												<DropdownMenuItem
													onSelect={() => {
														const content = noteContentRef.current;
														const md = noteContentToMarkdown(content);
														const id = addExport({
															noteTitle: activeNoteTitle,
															format: "markdown",
															destPath: null,
														});
														updateExport(id, { status: "writing" });
														window.electron?.notes
															.exportFile(md, "markdown", activeNoteTitle)
															.then((result) => {
																if (result.canceled) {
																	updateExport(id, { status: "cancelled" });
																} else {
																	updateExport(id, {
																		status: "done",
																		destPath: result.filePath ?? null,
																	});
																}
															})
															.catch((err) => {
																updateExport(id, {
																	status: "error",
																	error: String(err),
																});
															});
													}}
												>
													Markdown (.md)
												</DropdownMenuItem>
												<DropdownMenuItem
													onSelect={() => {
														const content = noteContentRef.current;
														const txt = noteContentText(content);
														const id = addExport({
															noteTitle: activeNoteTitle,
															format: "txt",
															destPath: null,
														});
														updateExport(id, { status: "writing" });
														window.electron?.notes
															.exportFile(txt, "txt", activeNoteTitle)
															.then((result) => {
																if (result.canceled) {
																	updateExport(id, { status: "cancelled" });
																} else {
																	updateExport(id, {
																		status: "done",
																		destPath: result.filePath ?? null,
																	});
																}
															})
															.catch((err) => {
																updateExport(id, {
																	status: "error",
																	error: String(err),
																});
															});
													}}
												>
													Plain Text (.txt)
												</DropdownMenuItem>
											</DropdownMenuSubContent>
										</DropdownMenuPortal>
									</DropdownMenuSub>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										onSelect={() => {
											setFloatingPanelMode("find");
										}}
									>
										<SearchIcon />
										Find in note…
									</DropdownMenuItem>
									<DropdownMenuItem
										onSelect={() => {
											setFloatingPanelMode("replace");
										}}
									>
										<span className="size-4" />
										Replace in note…
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										variant="destructive"
										onSelect={deleteActiveNote}
										disabled={!appState.activeNotePath}
									>
										<Trash2Icon />
										Delete note
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</header>
				)}
				{floatingPanelVisible ? (
					<div
						data-state={floatingPanelMode ? "open" : "closed"}
						onAnimationEnd={(e) => {
							if (e.target === e.currentTarget && !floatingPanelMode) {
								setFloatingPanelVisible(false);
							}
						}}
						className="absolute top-12 right-4 z-20 flex w-80 flex-col gap-3 rounded-xl bg-popover p-3 text-sm text-popover-foreground shadow-[0_14px_40px_rgb(0_0_0/0.35),0_0_0_1px_rgb(255_255_255/0.08)] duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:[--tw-animation-fill-mode:forwards]"
					>
						{(floatingPanelMode ?? floatingPanelLastMode.current) === "format" ? (
							<>
								<div className="flex items-center justify-between gap-3">
									<div>
										<h2 className="font-medium text-sm">Note setup</h2>
										<p className="text-muted-foreground text-xs">
											Tune the active note layout.
										</p>
									</div>
									<Button
										type="button"
										size="icon-sm"
										variant="ghost"
										aria-label="Close note setup"
										className="shrink-0 text-muted-foreground"
										onClick={() => setFloatingPanelMode(null)}
									>
										<XIcon />
									</Button>
								</div>
								<div className="space-y-3 rounded-lg bg-muted/35 p-2">
									<FormatPanelSection label="Line height">
										<FormatPanelButton
											active={activePageFormat.lineHeight === "normal"}
											label="Normal"
											onClick={() =>
												updateActivePageFormat({ lineHeight: "normal" })
											}
										/>
										<FormatPanelButton
											active={activePageFormat.lineHeight === "1.5"}
											label="1.5"
											onClick={() =>
												updateActivePageFormat({ lineHeight: "1.5" })
											}
										/>
									</FormatPanelSection>
									<FormatPanelSection label="Paragraph spacing">
										<FormatPanelButton
											active={activePageFormat.paragraphSpacing === "default"}
											label="Default"
											onClick={() =>
												updateActivePageFormat({
													paragraphSpacing: "default",
												})
											}
										/>
										<FormatPanelButton
											active={activePageFormat.paragraphSpacing === "compact"}
											label="Compact"
											onClick={() =>
												updateActivePageFormat({
													paragraphSpacing: "compact",
												})
											}
										/>
									</FormatPanelSection>
									<div className="flex rounded-lg bg-background/35 p-1 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)]">
										<FormatPanelButton
											active={activePageFormat.firstLineIndent}
											label="First-line indent"
											onClick={() =>
												updateActivePageFormat({
													firstLineIndent: !activePageFormat.firstLineIndent,
												})
											}
										/>
									</div>
								</div>
							</>
						) : (floatingPanelMode ?? floatingPanelLastMode.current) === "info" ? (
							<>
								<div className="flex items-center justify-between gap-3">
									<div>
										<h2 className="font-medium text-sm">Note Info</h2>
										<p className="text-muted-foreground text-xs">
											Details for this note.
										</p>
									</div>
									<Button
										type="button"
										size="icon-sm"
										variant="ghost"
										aria-label="Close note info"
										className="shrink-0 text-muted-foreground"
										onClick={() => setFloatingPanelMode(null)}
									>
										<XIcon />
									</Button>
								</div>
								<div className="space-y-3 rounded-lg bg-muted/35 p-2">
									<div className="space-y-1 rounded-lg bg-background/35 px-2.5 py-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)]">
										<span className="text-muted-foreground text-xs">Title</span>
										<p className="break-words text-sm">
											{displayNoteTitle(noteInfoTarget?.title ?? "")}
										</p>
									</div>
									<div className="space-y-1 rounded-lg bg-background/35 px-2.5 py-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)]">
										<span className="text-muted-foreground text-xs">Path</span>
										<p className="break-all font-mono text-xs text-muted-foreground">
											{noteInfoTarget?.path ?? "—"}
										</p>
									</div>
								</div>
							</>
						) : (
							<>
								<div className="flex items-center gap-2">
									<Input
										ref={findInputRef}
										value={findText}
										placeholder="Find..."
										className="min-w-0 flex-1"
										onChange={(event) => setFindText(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Escape") setFloatingPanelMode(null);
										}}
									/>
									<Button
										type="button"
										size="icon-sm"
										variant="ghost"
										aria-label="Close find and replace"
										onClick={() => setFloatingPanelMode(null)}
									>
										<XIcon />
									</Button>
								</div>
								{(floatingPanelMode ?? floatingPanelLastMode.current) === "replace" ? (
									<div className="flex items-center gap-2">
										<Input
											value={replaceText}
											placeholder="Replace..."
											className="min-w-0 flex-1"
											onChange={(event) => setReplaceText(event.target.value)}
											onKeyDown={(event) => {
												if (event.key === "Escape") setFloatingPanelMode(null);
											}}
										/>
										<Button
											type="button"
											size="sm"
											variant="outline"
											onClick={replaceInNote}
										>
											One
										</Button>
										<Button type="button" size="sm" onClick={replaceAllInNote}>
											All
										</Button>
									</div>
								) : null}
							</>
						)}
					</div>
				) : null}
				<section
					aria-label="Note editor"
					className="relative flex min-h-0 flex-1 overflow-hidden overscroll-contain"
					onKeyDown={(event) => {
						if (
							event.key.toLowerCase() === "b" &&
							(event.ctrlKey || event.metaKey)
						) {
							event.stopPropagation();
						}
					}}
				>
					{!appState.activeNotePath ? (
						<div className="flex flex-1 items-center justify-center">
							<h1 className="font-brand text-5xl text-muted-foreground/50 select-none">
								Paperite
							</h1>
						</div>
					) : (
						<>
							{appState.openTabs.map((tab) => {
								const isActive = tab.path === appState.activeNotePath;
								const isReady = readyEditorPaths.has(tab.path);
								const yNote = loadedYNoteCache.current.get(tab.path);
								const cachedContent = noteContentCache.current.get(tab.path);

								if (!isReady || !yNote || cachedContent === undefined) {
									if (!isActive) return null;
									return (
										<div
											key={tab.path}
											className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground"
										>
											Loading note...
										</div>
									);
								}

								const tabTitle =
									noteTitleDrafts[tab.path] !== undefined
										? noteTitleDrafts[tab.path]
										: tab.title || "Untitled";
								const tabPageFormat =
									pageFormats[tab.path] ?? resolvedDefaultPageFormat;

								return (
									<div
										key={tab.path}
										className={
											isActive
												? "relative z-10 flex min-h-0 flex-1 overflow-hidden"
												: "pointer-events-none invisible absolute inset-0 z-0 overflow-hidden"
										}
										aria-hidden={!isActive}
										inert={!isActive ? true : undefined}
									>
										<MemoNoteEditor
											content={cachedContent}
											noteTitle={tabTitle}
											notePath={tab.path}
											pageFormat={tabPageFormat}
											yDoc={yNote.doc}
											searchQuery={
												isActive &&
												(floatingPanelMode === "find" ||
													floatingPanelMode === "replace")
													? findText
													: ""
											}
											zenMode={zenMode}
											onChange={updateNoteContent}
											onContentRendered={completeSwitchBenchmark}
											onContentSnapshot={registerNoteContentSnapshot}
											onRename={renameActiveNote}
											onTitleChange={updateActiveTitleDraft}
										/>
									</div>
								);
							})}
						</>
					)}
				</section>
			</NoteWorkspace>
		</PersistedSidebarProvider>
	);
}

function normalizePageFormat(
	format: PageFormat | Partial<PageFormat> | undefined | null,
): PageFormat {
	return {
		firstLineIndent: format?.firstLineIndent === true,
		lineHeight: format?.lineHeight === "1.5" ? "1.5" : "normal",
		paragraphSpacing:
			format?.paragraphSpacing === "compact" ? "compact" : "default",
	};
}

function normalizeAppState(state: PaperiteAppState): PaperiteAppState {
	return {
		activeNotePath: state.activeNotePath ?? null,
		activeSpacePath: state.activeSpacePath || "Inbox",
		expandedFolders: unique(state.expandedFolders ?? []),
		openTabs: (state.openTabs ?? [])
			.filter((tab) => tab.path && tab.title)
			.map((tab) => ({
				...tab,
				pinned: tab.pinned === true,
				preview: tab.preview === true,
			})),
		spaceColors: state.spaceColors ?? {},
		spaceIcons: state.spaceIcons ?? {},
		spaceOrder: unique(state.spaceOrder ?? []),
		spaceSortOrders: normalizeSpaceSortOrders(state.spaceSortOrders ?? {}),
		spaceFolderFirst: state.spaceFolderFirst ?? {},
		spacePreviewModes: state.spacePreviewModes ?? {},
		customItemOrders: normalizeCustomItemOrders(state.customItemOrders ?? {}),
		sidebarOpen: state.sidebarOpen ?? true,
		inboxViewMode: state.inboxViewMode === "grid" ? "grid" : "list",
		showNotePreview: state.showNotePreview !== false,
		closeButtonOnly: state.closeButtonOnly === true,
		defaultPageFormat: normalizePageFormat(state.defaultPageFormat),
	};
}

function reconcileAppState(
	state: PaperiteAppState,
	workspace: WorkspaceSnapshot,
): PaperiteAppState {
	const notePaths = collectNotePaths(workspace.spaces);
	const folderPaths = collectFolderPaths(workspace.spaces);
	const openTabs = state.openTabs.filter((tab) => notePaths.has(tab.path));
	const activeNotePath =
		state.activeNotePath && notePaths.has(state.activeNotePath)
			? state.activeNotePath
			: (openTabs[0]?.path ?? null);
	const activeSpacePath =
		state.activeSpacePath === "Trash"
			? "Trash"
			: state.activeSpacePath &&
					workspace.spaces.some((space) => space.path === state.activeSpacePath)
				? state.activeSpacePath
				: activeNotePath
					? topLevelPath(activeNotePath)
					: (workspace.spaces[0]?.path ?? "Inbox");

	return {
		activeNotePath,
		activeSpacePath,
		expandedFolders: state.expandedFolders.filter((path) =>
			folderPaths.has(path),
		),
		openTabs,
		spaceColors: state.spaceColors,
		spaceIcons: state.spaceIcons,
		spaceOrder: reconcileSpaceOrder(state.spaceOrder, workspace.spaces),
		spaceSortOrders: reconcileSpaceSortOrders(
			state.spaceSortOrders,
			workspace.spaces,
		),
		spaceFolderFirst: state.spaceFolderFirst,
		spacePreviewModes: state.spacePreviewModes,
		customItemOrders: reconcileCustomItemOrders(
			state.customItemOrders,
			workspace.spaces,
		),
		sidebarOpen: state.sidebarOpen,
		inboxViewMode: state.inboxViewMode,
		showNotePreview: state.showNotePreview,
		closeButtonOnly: state.closeButtonOnly,
		defaultPageFormat: state.defaultPageFormat,
	};
}

function collectNotePaths(spaces: WorkspaceSpace[]) {
	const paths = new Set<string>();

	for (const space of spaces) {
		collectNotePathsFromItems(space.children, paths);
	}

	return paths;
}

function collectNotePathsFromItems(items: WorkspaceItem[], paths: Set<string>) {
	for (const item of items) {
		if (item.type === "note") {
			paths.add(item.path);
			continue;
		}

		collectNotePathsFromItems(item.children, paths);
	}
}

function collectFolderPaths(spaces: WorkspaceSpace[]) {
	const paths = new Set(spaces.map((space) => space.path));

	for (const space of spaces) {
		collectFolderPathsFromItems(space.children, paths);
	}

	return paths;
}

function orderSpaces(spaces: WorkspaceSpace[], spaceOrder: string[]) {
	if (spaceOrder.length === 0) return spaces;

	const order = new Map(spaceOrder.map((path, index) => [path, index]));
	return [...spaces].sort((a, b) => {
		if (a.path === "Inbox") return -1;
		if (b.path === "Inbox") return 1;

		return (
			(order.get(a.path) ?? Number.MAX_SAFE_INTEGER) -
			(order.get(b.path) ?? Number.MAX_SAFE_INTEGER)
		);
	});
}

function reconcileSpaceOrder(spaceOrder: string[], spaces: WorkspaceSpace[]) {
	const paths = spaces
		.map((space) => space.path)
		.filter((path) => path !== "Inbox");
	const pathSet = new Set(paths);
	const reconciled = spaceOrder.filter((path) => pathSet.has(path));

	for (const path of paths) {
		if (!reconciled.includes(path)) reconciled.push(path);
	}

	return reconciled;
}


function normalizeSortOrder(
	order: SidebarSortOrder | undefined,
	spacePath: string,
): SidebarSortOrder {
	const normalized = isSortOrder(order) ? order : "newest";
	return spacePath === "Inbox" && normalized === "custom"
		? "newest"
		: normalized;
}

function normalizeSpaceSortOrders(
	spaceSortOrders: Record<string, SidebarSortOrder>,
) {
	return Object.fromEntries(
		Object.entries(spaceSortOrders)
			.filter(([, order]) => isSortOrder(order))
			.map(([spacePath, order]) => [
				spacePath,
				normalizeSortOrder(order, spacePath),
			]),
	) as Record<string, SidebarSortOrder>;
}

function reconcileSpaceSortOrders(
	spaceSortOrders: Record<string, SidebarSortOrder>,
	spaces: WorkspaceSpace[],
) {
	const spacePaths = new Set(spaces.map((space) => space.path));

	return Object.fromEntries(
		Object.entries(spaceSortOrders)
			.filter(
				([spacePath, order]) => spacePaths.has(spacePath) && isSortOrder(order),
			)
			.map(([spacePath, order]) => [
				spacePath,
				normalizeSortOrder(order, spacePath),
			]),
	) as Record<string, SidebarSortOrder>;
}

function normalizeCustomItemOrders(customItemOrders: Record<string, string[]>) {
	return Object.fromEntries(
		Object.entries(customItemOrders).filter(
			([parentPath, itemOrder]) =>
				topLevelPath(parentPath) !== "Inbox" && Array.isArray(itemOrder),
		),
	) as Record<string, string[]>;
}

function reconcileCustomItemOrders(
	customItemOrders: Record<string, string[]>,
	spaces: WorkspaceSpace[],
) {
	const itemPathsByParent = collectItemPathsByParent(spaces);
	const reconciled: Record<string, string[]> = {};

	for (const [parent, order] of Object.entries(customItemOrders)) {
		if (topLevelPath(parent) === "Inbox") continue;

		const childPaths = itemPathsByParent.get(parent);
		if (!childPaths) continue;

		const childPathSet = new Set(childPaths);
		const nextOrder = unique(order.filter((path) => childPathSet.has(path)));

		for (const path of childPaths) {
			if (!nextOrder.includes(path)) nextOrder.push(path);
		}

		reconciled[parent] = nextOrder;
	}

	return reconciled;
}

function collectItemPathsByParent(spaces: WorkspaceSpace[]) {
	const itemPathsByParent = new Map<string, string[]>();

	for (const space of spaces) {
		itemPathsByParent.set(
			space.path,
			space.children.map((item) => item.path),
		);
		collectItemPathsByParentFromItems(space.children, itemPathsByParent);
	}

	return itemPathsByParent;
}

function collectItemPathsByParentFromItems(
	items: WorkspaceItem[],
	itemPathsByParent: Map<string, string[]>,
) {
	for (const item of items) {
		if (item.type !== "folder") continue;

		itemPathsByParent.set(
			item.path,
			item.children.map((child) => child.path),
		);
		collectItemPathsByParentFromItems(item.children, itemPathsByParent);
	}
}

function isSortOrder(order: unknown): order is SidebarSortOrder {
	return (
		order === "newest" ||
		order === "oldest" ||
		order === "a-z" ||
		order === "z-a" ||
		order === "custom"
	);
}

function collectFolderPathsFromItems(
	items: WorkspaceItem[],
	paths: Set<string>,
) {
	for (const item of items) {
		if (item.type !== "folder") continue;

		paths.add(item.path);
		collectFolderPathsFromItems(item.children, paths);
	}
}

function pickByPaths<T>(record: Record<string, T>, paths: Set<string>) {
	return Object.fromEntries(
		Object.entries(record).filter(([path]) => paths.has(path)),
	) as Record<string, T>;
}

function replaceOrAppendPreviewTab(
	openTabs: OpenNoteTab[],
	nextTab: OpenNoteTab,
	previewIndex: number,
) {
	if (previewIndex === -1 || !nextTab.preview) return [...openTabs, nextTab];

	return openTabs.map((tab, index) => (index === previewIndex ? nextTab : tab));
}

function SaveStatusBadge({
	onVerify,
}: {
	onVerify: () => Promise<{ ok: boolean; message: string; detail?: string }>;
}) {
	const saveStatus = useEditorUiStore((s) => s.saveStatus);
	const lastSavedAt = useEditorUiStore((s) => s.lastSavedAt);
	const label = saveStatusLabel(saveStatus);
	const relative = formatSavedAt(lastSavedAt);
	const absolute = formatSavedAtAbsolute(lastSavedAt);
	const [verifying, setVerifying] = useState(false);
	const [verifyResult, setVerifyResult] = useState<{
		ok: boolean;
		message: string;
		detail?: string;
	} | null>(null);

	useEffect(() => {
		if (!verifyResult) return;
		const timer = window.setTimeout(() => setVerifyResult(null), 10_000);
		return () => window.clearTimeout(timer);
	}, [verifyResult]);

	const statusColor =
		saveStatus === "error"
			? "text-destructive"
			: "text-muted-foreground";

	const displayLabel =
		saveStatus === "saving"
			? "Saving..."
			: saveStatus === "error"
				? "Error"
				: saveStatus === "saved"
					? "Saved"
					: label;

	const handleVerify = async (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		if (verifying) return;
		setVerifying(true);
		setVerifyResult(null);
		try {
			const result = await onVerify();
			setVerifyResult(result);
		} catch {
			setVerifyResult({
				ok: false,
				message: "Verify failed",
				detail: "Unexpected error while checking the file.",
			});
		} finally {
			setVerifying(false);
		}
	};

	if (!displayLabel) {
		return (
			<span className="min-w-14 px-2 text-right text-xs text-muted-foreground" />
		);
	}

	return (
		<HoverCard openDelay={500} closeDelay={120}>
			<HoverCardTrigger asChild>
				<button
					type="button"
					className={`min-w-14 max-w-28 truncate px-2 text-right text-xs transition-colors hover:text-foreground ${statusColor}`}
					aria-label={saveStatus === "saved" ? `Saved ${absolute}` : displayLabel}
				>
					{displayLabel}
				</button>
			</HoverCardTrigger>
			<HoverCardContent
				side="bottom"
				align="end"
				className="w-64 space-y-2 p-3 text-xs"
				onPointerDownOutside={(e) => {
					// Keep card open while interacting with the verify button path
					if (verifying) e.preventDefault();
				}}
			>
				<div className="font-medium text-foreground">
					{saveStatus === "saving"
						? "Saving note…"
						: saveStatus === "error"
							? "Save failed"
							: "Note saved"}
				</div>
				{lastSavedAt != null ? (
					<>
						<div className="text-muted-foreground">
							Last saved {relative}
						</div>
						<div className="text-muted-foreground/80 tabular-nums">{absolute}</div>
					</>
				) : (
					<div className="text-muted-foreground">No local save yet</div>
				)}
				<div className="text-muted-foreground/70">Ctrl+S force save</div>
				<div className="border-t border-border/60 pt-2">
					<Button
						type="button"
						variant="outline"
						size="xs"
						className="w-full justify-center gap-1.5"
						disabled={verifying}
						onClick={handleVerify}
						onMouseDown={(event) => event.preventDefault()}
					>
						{verifying ? (
							<Loader2Icon className="size-3.5 animate-spin" />
						) : (
							<ShieldCheckIcon className="size-3.5" />
						)}
						{verifying ? "Verifying…" : "Verify save note"}
					</Button>
					{verifyResult ? (
						<div
							className={
								verifyResult.ok
									? "mt-2 space-y-0.5 text-emerald-600 dark:text-emerald-400"
									: "mt-2 space-y-0.5 text-destructive"
							}
						>
							<div className="font-medium">{verifyResult.message}</div>
							{verifyResult.detail ? (
								<div className="text-[11px] opacity-90">{verifyResult.detail}</div>
							) : null}
						</div>
					) : null}
				</div>
			</HoverCardContent>
		</HoverCard>
	);
}

function FormatPanelButton({
	active,
	label,
	onClick,
}: {
	active: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			data-active={active}
			className="flex h-9 min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2.5 text-left text-sm transition-[background-color,scale] hover:bg-muted/80 active:scale-[0.96] data-[active=true]:bg-background data-[active=true]:shadow-[0_1px_8px_rgb(0_0_0/0.16)]"
			onClick={onClick}
		>
			<span className="truncate">{label}</span>
			{active ? <CheckIcon className="size-4 shrink-0" /> : null}
		</button>
	);
}

function FormatPanelSection({
	children,
	label,
}: {
	children: ReactNode;
	label: string;
}) {
	return (
		<div className="space-y-1.5">
			<span className="px-1 text-muted-foreground text-xs">{label}</span>
			<div className="flex rounded-lg bg-background/35 p-1 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)]">
				{children}
			</div>
		</div>
	);
}

function displayNoteTitle(title: string) {
	return title.trim() || "Untitled";
}

function topLevelPath(notePath: string) {
	return notePath.split("/")[0] || "Inbox";
}

/** Resolve active space without React subscription (plan 015). */
function resolveSpacePath(
	activeSpacePath: string,
	workspace: WorkspaceSnapshot | null | undefined,
): string {
	if (activeSpacePath === "Trash") return "Trash";
	if (
		!workspace?.spaces.some((space) => space.path === activeSpacePath)
	) {
		return workspace?.spaces[0]?.path ?? "Inbox";
	}
	return activeSpacePath;
}

function parentPath(itemPath: string) {
	const separatorIndex = itemPath.lastIndexOf("/");
	return separatorIndex === -1 ? "" : itemPath.slice(0, separatorIndex);
}

function fileName(notePath: string) {
	return notePath.split("/").at(-1) ?? notePath;
}

function stripNoteExtension(filename: string) {
	return filename.replace(/\.(?:json|md)$/i, "");
}

function isSameOrChildPath(parentPath: string, childPath: string) {
	return childPath === parentPath || childPath.startsWith(`${parentPath}/`);
}

function movePath(path: string, fromPath: string, toPath: string) {
	if (path === fromPath) return toPath;
	return `${toPath}/${path.slice(fromPath.length + 1)}`;
}

function moveDecorations<T>(
	decorations: Record<string, T>,
	fromPath: string,
	toPath: string,
) {
	return Object.fromEntries(
		Object.entries(decorations).map(([path, value]) => [
			isSameOrChildPath(fromPath, path)
				? movePath(path, fromPath, toPath)
				: path,
			value,
		]),
	);
}

function moveCustomItemOrders(
	customItemOrders: Record<string, string[]>,
	fromPath: string,
	toPath: string,
) {
	if (fromPath === toPath) return customItemOrders;

	const fromParentPath = parentPath(fromPath);
	const toParentPath = parentPath(toPath);
	const movedAcrossParents = fromParentPath !== toParentPath;
	const movedOrders: Record<string, string[]> = {};

	for (const [parent, order] of Object.entries(customItemOrders)) {
		const nextParent = isSameOrChildPath(fromPath, parent)
			? movePath(parent, fromPath, toPath)
			: parent;
		const nextOrder = order
			.filter(
				(path) =>
					!(
						movedAcrossParents &&
						parent === fromParentPath &&
						path === fromPath
					),
			)
			.map((path) =>
				isSameOrChildPath(fromPath, path)
					? movePath(path, fromPath, toPath)
					: path,
			);

		movedOrders[nextParent] = unique([
			...(movedOrders[nextParent] ?? []),
			...nextOrder,
		]);
	}

	if (movedAcrossParents && movedOrders[toParentPath]) {
		movedOrders[toParentPath] = unique([...movedOrders[toParentPath], toPath]);
	}

	return movedOrders;
}

function omitCustomItemOrders(
	customItemOrders: Record<string, string[]>,
	pathToOmit: string,
) {
	return Object.fromEntries(
		Object.entries(customItemOrders)
			.filter(([parent]) => !isSameOrChildPath(pathToOmit, parent))
			.map(([parent, order]) => [
				parent,
				order.filter((path) => !isSameOrChildPath(pathToOmit, path)),
			]),
	) as Record<string, string[]>;
}

function omitDecoration<T>(decorations: Record<string, T>, pathToOmit: string) {
	return Object.fromEntries(
		Object.entries(decorations).filter(
			([path]) => !isSameOrChildPath(pathToOmit, path),
		),
	);
}

function omitExact<T>(record: Record<string, T>, pathToOmit: string) {
	const { [pathToOmit]: _omitted, ...rest } = record;
	return rest;
}

function updateWorkspaceNote(
	workspace: WorkspaceSnapshot,
	notePath: string,
	patch: Pick<WorkspaceNote, "preview" | "updatedAt">,
): WorkspaceSnapshot {
	return {
		...workspace,
		spaces: workspace.spaces.map((space) => ({
			...space,
			children: updateWorkspaceItems(space.children, notePath, patch),
		})),
	};
}

function updateWorkspaceItems(
	items: WorkspaceItem[],
	notePath: string,
	patch: Pick<WorkspaceNote, "preview" | "updatedAt">,
): WorkspaceItem[] {
	let changed = false;
	const nextItems = items.map((item) => {
		if (item.type === "note") {
			if (item.path !== notePath) return item;

			changed = true;
			return { ...item, ...patch };
		}

		const children = updateWorkspaceItems(item.children, notePath, patch);
		if (children === item.children) return item;

		changed = true;
		return { ...item, children };
	});

	if (!changed) return items;

	return nextItems;
}

function applyNoteDecorations(
	spaces: WorkspaceSpace[],
	previews: Record<string, string>,
	titleDrafts: Record<string, string>,
): WorkspaceSpace[] {
	return spaces.map((space) => ({
		...space,
		children: applyItemDecorations(space.children, previews, titleDrafts),
	}));
}

function applyItemDecorations(
	items: WorkspaceItem[],
	previews: Record<string, string>,
	titleDrafts: Record<string, string>,
): WorkspaceItem[] {
	return items.map((item) => {
		if (item.type === "folder") {
			return {
				...item,
				children: applyItemDecorations(item.children, previews, titleDrafts),
			};
		}

		return {
			...item,
			title: titleDrafts[item.path] ?? item.title,
			preview: previews[item.path] ?? item.preview,
		};
	});
}

function unique(values: string[]) {
	return Array.from(new Set(values.filter(Boolean)));
}
