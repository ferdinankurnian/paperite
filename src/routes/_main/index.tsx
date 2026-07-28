import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	type Modifier,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	horizontalListSortingStrategy,
	SortableContext,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	BookOpenIcon,
	CheckIcon,
	ExternalLinkIcon,
	InfoIcon,
	MoreVerticalIcon,
	PencilIcon,
	SearchIcon,
	Trash2Icon,
	PinIcon,
	XIcon,
} from "lucide-react";
import {
	type CSSProperties,
	memo,
	type ReactNode,
	startTransition,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { useKeyboardShortcuts } from "@/components/keyboard-shortcuts-provider";
import { NoteEditor, type PageFormat } from "@/components/note-editor";

const MemoNoteEditor = memo(NoteEditor);

import { SidebarHotkeys } from "@/components/sidebar-hotkeys";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
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

import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";
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

const defaultAppState: PaperiteAppState = {
	activeNotePath: null,
	activeSpacePath: "Inbox",
	expandedFolders: [],
	openTabs: [],
	spaceColors: {},
	spaceIcons: {},
	spaceOrder: [],
	spaceSortOrders: {},
	spacePreviewModes: {},
	customItemOrders: {},
	readOnlyNotes: {},
	sidebarOpen: true,
	inboxViewMode: "list",
	showNotePreview: true,
	closeButtonOnly: false,
};

type SaveStatus = "idle" | "saving" | "saved" | "error";
type FloatingPanelMode = "find" | "format" | "info" | "replace" | null;

type NoteInfoTarget = {
	path: string;
	title: string;
};

const defaultPageFormat: PageFormat = {
	firstLineIndent: false,
	lineHeight: "normal",
	paragraphSpacing: "default",
};

type SortableTabProps = {
	note: OpenNoteTab;
	isActive: boolean;
	displayTitle: (title: string) => string;
	onSelect: () => void;
	onDoubleClick: () => void;
	onClose: () => void;
	onTogglePin: () => void;
};

function SortableTab({
	note,
	isActive,
	displayTitle,
	onSelect,
	onDoubleClick,
	onClose,
	onTogglePin,
}: SortableTabProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging: isSortableDragging,
	} = useSortable({ id: note.path });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isSortableDragging ? "1" : undefined,
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					ref={setNodeRef}
					style={style}
					data-active={isActive}
					data-preview={note.preview}
					data-pinned={note.pinned}
					data-dragging={isSortableDragging}
					className="group relative z-10 my-2 w-28 shrink-0 rounded-md text-[13px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground data-[preview=true]:italic data-[preview=true]:opacity-70 data-[dragging=true]:bg-muted data-[dragging=true]:opacity-100 sm:w-36 lg:w-44 cursor-grab active:cursor-grabbing !opacity-100"
					{...attributes}
					{...listeners}
				>
					<button
						type="button"
						className="flex h-full w-full items-center rounded-md pr-7 pl-2.5 text-left outline-none"
						onClick={onSelect}
						onDoubleClick={onDoubleClick}
						onMouseDown={(event) => {
							if (event.button === 1) {
								event.preventDefault();
								if (!note.pinned) onClose();
							}
						}}
					>
						<span className="min-w-0 flex-1 truncate">
							{displayTitle(note.title)}
						</span>
					</button>
					<button
						type="button"
						aria-label={
							note.pinned
								? `Unpin ${displayTitle(note.title)}`
								: `Close ${displayTitle(note.title)}`
						}
						className={
							note.pinned
								? "-translate-y-1/2 absolute top-1/2 right-2 flex size-4 shrink-0 items-center justify-center opacity-65 hover:opacity-100"
								: "-translate-y-1/2 absolute top-1/2 right-2 flex size-4 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover:opacity-65 group-data-[active=true]:opacity-65 hover:opacity-100"
						}
						onClick={(event) => {
							event.stopPropagation();
							if (note.pinned) onTogglePin();
							else onClose();
						}}
					>
						{note.pinned ? (
							<PinIcon className="size-3.5" />
						) : (
							<XIcon className="size-3.5" />
						)}
					</button>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={onTogglePin}>
					{note.pinned ? "Unpin Tab" : "Pin Tab"}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

function Index() {
	const notesApi = getNotesEngine();
	const { getShortcut } = useKeyboardShortcuts();
	const workspaceRef = useRef<WorkspaceSnapshot | null>(null);
	const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
	const [appState, setAppState] = useState<PaperiteAppState>(defaultAppState);
	const inboxViewMode = appState.inboxViewMode;
	const setInboxViewMode = useCallback(
		(mode: "list" | "grid") =>
			setAppState((prev) => ({ ...prev, inboxViewMode: mode })),
		[],
	);
	const setShowNotePreview = useCallback(
		(show: boolean) =>
			setAppState((prev) => ({ ...prev, showNotePreview: show })),
		[],
	);
	const setCloseButtonOnly = useCallback(
		(closeButtonOnly: boolean) =>
			setAppState((prev) => ({ ...prev, closeButtonOnly })),
		[],
	);
	const setSpacePreviewMode = useCallback(
		(spacePath: string, mode: SpacePreviewMode) =>
			setAppState((prev) => ({
				...prev,
				spacePreviewModes: {
					...prev.spacePreviewModes,
					[spacePath]: mode,
				},
			})),
		[],
	);
	const setSpaceSortOrder = useCallback(
		(spacePath: string, order: SidebarSortOrder) =>
			setAppState((prev) => ({
				...prev,
				spaceSortOrders: {
					...prev.spaceSortOrders,
					[spacePath]: normalizeSortOrder(order, spacePath),
				},
			})),
		[],
	);
	const [noteContent, setNoteContent] = useState<NoteContent>(() =>
		createEmptyNoteContent(),
	);
	const [loadedNotePath, setLoadedNotePath] = useState<string | null>(null);
	const [notePreviews, setNotePreviews] = useState<Record<string, string>>({});
	const [noteTitleDrafts, setNoteTitleDrafts] = useState<
		Record<string, string>
	>({});
	const [loadedYNote, setLoadedYNote] = useState<{
		path: string;
		note: LoadedYNote;
	} | null>(null);
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
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
	const didHydrate = useRef(false);
	const findInputRef = useRef<HTMLInputElement>(null);
	const lastLoadedNote = useRef<string | null>(null);
	const lastPersistedContent = useRef("");
	const activeNotePathRef = useRef<string | null>(null);
	const noteContentRef = useRef<NoteContent>(createEmptyNoteContent());
	const tabListRef = useRef<HTMLDivElement>(null);
	const [newlyCreatedFolderPath, setNewlyCreatedFolderPath] = useState<
		string | null
	>(null);
	const noteContentCache = useRef(new Map<string, NoteContent>());
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

	const restrictToHorizontalAxis: Modifier = ({
		transform,
		activeNodeRect,
	}) => {
		const listRect = tabListRef.current?.getBoundingClientRect();
		if (!listRect || !activeNodeRect) return { ...transform, y: 0 };

		const minX = listRect.left - activeNodeRect.left;
		const maxX = listRect.right - activeNodeRect.right;

		return {
			...transform,
			x: Math.min(maxX, Math.max(minX, transform.x)),
			y: 0,
		};
	};

	const dndSensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 5 },
		}),
	);

	const handleDragEnd = useCallback((event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) return;

		setAppState((current) => {
			const oldIndex = current.openTabs.findIndex(
				(tab) => tab.path === active.id,
			);
			const newIndex = current.openTabs.findIndex(
				(tab) => tab.path === over.id,
			);
			if (oldIndex === -1 || newIndex === -1) return current;
			return {
				...current,
				openTabs: arrayMove(current.openTabs, oldIndex, newIndex),
			};
		});
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

	const flushSaveAndSync = useCallback(async () => {
		const notePath = activeNotePathRef.current;
		if (!notePath) return;

		const latestContent = noteContentCache.current.get(notePath);
		const latestBody = latestContent
			? serializeNoteContentBody(latestContent)
			: null;
		const persistedContent = notePersistedCache.current.get(notePath);
		const persistedBody = persistedContent
			? serializeNoteContentBody(persistedContent)
			: null;

		if (latestBody && latestBody !== persistedBody && latestContent) {
			setSaveStatus("saving");
			clearNoteAutosaveTimer(notePath);
			clearAutosavesForPath(notePath);

			try {
				if (loadedYNote?.path === notePath) {
					await notesApi?.writeDerivedNote(notePath, latestContent);
				} else {
					await enqueueNoteWrite(notePath, latestContent);
				}
				notePersistedCache.current.set(notePath, latestContent);
				lastPersistedContent.current = latestBody;
				setSaveStatus("saved");

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
		}

		const syncEngine = getSyncEngine();
		if (syncEngine) {
			syncEngine.runGoogleDrive().catch(() => undefined);
		}
	}, [
		clearAutosavesForPath,
		clearNoteAutosaveTimer,
		enqueueNoteWrite,
		loadedYNote?.path,
		notesApi,
	]);

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

	const activePageFormat = appState.activeNotePath
		? (pageFormats[appState.activeNotePath] ?? defaultPageFormat)
		: defaultPageFormat;

	const openTabPaths = useMemo(
		() => appState.openTabs.map((t) => t.path),
		[appState.openTabs],
	);

	activeNotePathRef.current = appState.activeNotePath;

	useEffect(() => {
		noteContentRef.current = noteContent;

		if (
			appState.activeNotePath &&
			lastLoadedNote.current === appState.activeNotePath
		) {
			noteContentCache.current.set(appState.activeNotePath, noteContent);
		}
	}, [appState.activeNotePath, noteContent]);

	useEffect(() => {
		if (!appState.activeNotePath) {
			setLoadedYNote((current) => {
				current?.note.destroy();
				return null;
			});
			return;
		}

		let cancelled = false;
		const notePath = appState.activeNotePath;

		loadYNote(notePath)
			.then((note) => {
				if (!note) return;

				if (cancelled) {
					note.destroy();
					return;
				}

				setLoadedYNote((current) => {
					current?.note.destroy();
					return { path: notePath, note };
				});
			})
			.catch(() => setSaveStatus("error"));

		return () => {
			cancelled = true;
		};
	}, [appState.activeNotePath]);

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
			await refreshTrash();
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

	useEffect(() => {
		if (!notesApi || !didHydrate.current) return;

		const timer = setTimeout(() => {
			notesApi.writeAppState(appState);
		}, 300);
		return () => clearTimeout(timer);
	}, [appState, notesApi]);

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

		let cancelled = false;
		const notePath = appState.activeNotePath;

		const loadNote = async () => {
			setSaveStatus("idle");
			const cachedContent = noteContentCache.current.get(notePath);
			setNotePreviews((current) => omitExact(current, notePath));

			if (cachedContent !== undefined) {
				const persistedContent = notePersistedCache.current.get(notePath);
				const cachedSerialized = serializeNoteContent(cachedContent);
				const persistedSerialized = persistedContent
					? serializeNoteContent(persistedContent)
					: "";

				setNoteContent(cachedContent);
				setLoadedNotePath(notePath);
				setSaveStatus(
					persistedContent
						? cachedSerialized === persistedSerialized
							? "saved"
							: "saving"
						: "idle",
				);
			} else {
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
				return;
			}

			lastLoadedNote.current = notePath;
			lastPersistedContent.current = readSerializedBody;
			noteContentCache.current.set(notePath, content);
			notePersistedCache.current.set(notePath, content);
			setNoteContent(content);
			setLoadedNotePath(notePath);
			setSaveStatus("saved");

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
	}, [appState.activeNotePath, notesApi]);

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

	const currentSpacePath = useMemo(() => {
		if (appState.activeSpacePath === "Trash") return "Trash";

		if (
			!workspace?.spaces.some(
				(space) => space.path === appState.activeSpacePath,
			)
		) {
			return workspace?.spaces[0]?.path ?? "Inbox";
		}

		return appState.activeSpacePath;
	}, [appState.activeSpacePath, workspace]);

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
				const openTabs = existing
					? current.openTabs.map((tab) =>
							tab.path === note.path
								? { ...tab, preview: mode === "fixed" ? false : tab.preview }
								: tab,
						)
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
		},
		[],
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

	useEffect(() => {
		window.dispatchEvent(
			new CustomEvent("paperite:active-space-change", {
				detail: { path: currentSpacePath },
			}),
		);
	}, [currentSpacePath]);

	const openNoteInfo = useCallback((target: NoteInfoTarget) => {
		setNoteInfoTarget(target);
		setFloatingPanelMode("info");
	}, []);

	useEffect(() => {
		const createNoteFromMenu = () => createNote(currentSpacePath);
		const createFolderFromMenu = () => {
			if (currentSpacePath !== "Inbox") createFolder(currentSpacePath);
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
			window.removeEventListener("paperite:refresh-workspace", refreshFromEvent);
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
	}, [currentSpacePath, createNote, createFolder, openNoteInfo, refreshWorkspace]);

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
				readOnlyNotes: moveDecorations(
					current.readOnlyNotes,
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
				spacePreviewModes: omitDecoration(current.spacePreviewModes, path),
				customItemOrders: omitCustomItemOrders(current.customItemOrders, path),
				readOnlyNotes: omitDecoration(current.readOnlyNotes, path),
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
			setAppState((current) => ({
				...current,
				readOnlyNotes: moveDecorations(
					current.readOnlyNotes,
					itemPath,
					moved.path,
				),
			}));
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
				readOnlyNotes: moveDecorations(
					current.readOnlyNotes,
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
				readOnlyNotes: omitDecoration(current.readOnlyNotes, path),
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

		setNoteTitleDrafts((current) => ({
			...current,
			[notePath]: title,
		}));
		setAppState((current) => ({
			...current,
			openTabs: current.openTabs.map((tab) =>
				tab.path === notePath ? { ...tab, title } : tab,
			),
		}));
	}, []);

	const updateActivePageFormat = useCallback(
		(patch: Partial<PageFormat>) => {
			if (!appState.activeNotePath) return;

			setPageFormats((current) => ({
				...current,
				[appState.activeNotePath as string]: {
					...(current[appState.activeNotePath as string] ?? defaultPageFormat),
					...patch,
				},
			}));
		},
		[appState.activeNotePath],
	);

	const updateNoteContent = useCallback(
		(
			nextContent: NoteContent,
			sourceNotePath: string | null,
			isUserEdit: boolean,
		) => {
			if (!sourceNotePath) return;
			if (sourceNotePath !== activeNotePathRef.current) return;

			// TipTap already owns the live document. Keep React noteContent
			// stable during typing so Index / sidebar / tabs don't re-render
			// on every keystroke. Refs + cache drive autosave and exports.
			noteContentRef.current = nextContent;
			noteContentCache.current.set(sourceNotePath, nextContent);

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

			if (loadedYNote?.path === sourceNotePath) {
				scheduleYjsDerivedAutosave(sourceNotePath, nextContent);
				return;
			}

			scheduleNoteAutosave(sourceNotePath, nextContent);
		},
		[loadedYNote?.path, scheduleNoteAutosave, scheduleYjsDerivedAutosave],
	);

	const activeNoteReadOnly = appState.activeNotePath
		? appState.readOnlyNotes[appState.activeNotePath] === true
		: false;
	const activeYDoc =
		loadedYNote?.path === appState.activeNotePath ? loadedYNote.note.doc : null;

	const toggleReadOnly = useCallback(() => {
		const notePath = activeNotePathRef.current;
		if (!notePath) return;

		setAppState((current) => {
			const nextReadOnly = !(current.readOnlyNotes[notePath] === true);
			if ((current.readOnlyNotes[notePath] === true) === nextReadOnly) {
				return current;
			}
			return {
				...current,
				readOnlyNotes: {
					...current.readOnlyNotes,
					[notePath]: nextReadOnly,
				},
			};
		});
	}, []);

	useEffect(() => {
		const handleShortcut = (event: KeyboardEvent) => {
			if (event.repeat) return;

			const zenShortcut = getShortcut("view.toggleZen");
			const sidebarShortcut = getShortcut("view.toggleSidebar");
			const isGlobalViewShortcut =
				shortcutMatchesEvent(zenShortcut, event) ||
				shortcutMatchesEvent(sidebarShortcut, event);

			if (isShortcutEditableInput(event.target) && !isGlobalViewShortcut)
				return;

			if (shortcutMatchesEvent(getShortcut("note.saveAndSync"), event)) {
				event.preventDefault();
				flushSaveAndSync();
				return;
			}

			if (shortcutMatchesEvent(getShortcut("note.create"), event)) {
				event.preventDefault();
				createNote(currentSpacePath);
				return;
			}

			if (shortcutMatchesEvent(getShortcut("folder.create"), event)) {
				event.preventDefault();
				if (currentSpacePath !== "Inbox") createFolder(currentSpacePath);
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
		currentSpacePath,
		flushSaveAndSync,
		getShortcut,
		switchTab,
	]);

	const selectTab = useCallback((notePath: string) => {
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
			if (!tab || !tab.preview) return current;
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

	const handleSidebarOpenChange = useCallback((sidebarOpen: boolean) => {
		setAppState((current) =>
			current.sidebarOpen === sidebarOpen
				? current
				: { ...current, sidebarOpen },
		);
	}, []);

	const handleSortOrderChange = useCallback(
		(order: SidebarSortOrder) => {
			setSpaceSortOrder(currentSpacePath, order);
		},
		[currentSpacePath, setSpaceSortOrder],
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
		<SidebarProvider
			className="h-full min-h-0"
			open={appState.sidebarOpen}
			onOpenChange={handleSidebarOpenChange}
			style={
				{
					"--sidebar-width": "14.5rem",
				} as CSSProperties
			}
		>
			{zenMode ? null : (
				<>
					<SidebarHotkeys />
					<AppSidebar
						activeNotePath={appState.activeNotePath}
						activeSpacePath={currentSpacePath}
						expandedFolders={appState.expandedFolders}
						spaceColors={appState.spaceColors}
						spaceIcons={appState.spaceIcons}
						spacePreviewModes={appState.spacePreviewModes}
						showNotePreview={appState.showNotePreview}
						closeButtonOnly={appState.closeButtonOnly}
						onSetShowNotePreview={setShowNotePreview}
						onSetCloseButtonOnly={setCloseButtonOnly}
						onSetSpacePreviewMode={setSpacePreviewMode}
						spaces={visibleSpaces}
						viewMode={inboxViewMode}
						onViewModeChange={setInboxViewMode}
						sortOrder={sortOrderForSpace(
							currentSpacePath,
							appState.spaceSortOrders,
						)}
						onSortOrderChange={handleSortOrderChange}
						customItemOrders={appState.customItemOrders}
						onReorderItems={reorderItems}
						onCreateFolder={createFolder}
						onCreateNote={createNote}
						onCreateSpace={createSpace}
						onDeleteItem={deleteItem}
						onDeleteSpace={deleteSpace}
						onEditSpace={editSpace}
						onMoveItem={moveItem}
						onOpenNote={openNote}
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
			<SidebarInset className="min-w-0 overflow-hidden">
				{zenMode || !appState.activeNotePath ? null : (
					<header className="relative z-10 flex h-12 shrink-0 items-stretch gap-3 px-3 transition-[width,height] ease-linear after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-8 after:bg-linear-to-b after:from-background after:to-transparent after:content-['']">
						<div className="flex shrink-0 items-center min-[56.0625rem]:hidden">
							<SidebarTrigger
								toggleNotesSheet
								className="text-muted-foreground min-[56.0625rem]:hidden"
							/>
						</div>
						<div
							ref={tabListRef}
							className="no-scrollbar flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain"
							onWheel={(e) => {
								if (e.deltaY !== 0) {
									e.preventDefault();
									tabListRef.current?.scrollBy({
										left: e.deltaY,
										behavior: "auto",
									});
								}
							}}
						>
							<DndContext
								sensors={dndSensors}
								collisionDetection={closestCenter}
								modifiers={[restrictToHorizontalAxis]}
								onDragEnd={handleDragEnd}
							>
								<SortableContext
									items={openTabPaths}
									strategy={horizontalListSortingStrategy}
								>
									{appState.openTabs.map((note) => (
										<SortableTab
											key={note.path}
											note={note}
											isActive={note.path === appState.activeNotePath}
											displayTitle={displayNoteTitle}
											onSelect={() => selectTab(note.path)}
											onDoubleClick={() => fixTab(note.path)}
											onClose={() => closeTab(note.path)}
											onTogglePin={() => togglePinTab(note.path)}
										/>
									))}
								</SortableContext>
							</DndContext>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<span className="min-w-12 px-2 text-right text-xs text-muted-foreground">
								{saveStatusLabel(saveStatus)}
							</span>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className="text-muted-foreground"
								aria-label={activeNoteReadOnly ? "Edit note" : "Reading view"}
								onClick={toggleReadOnly}
							>
								{activeNoteReadOnly ? <PencilIcon /> : <BookOpenIcon />}
							</Button>
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
						{floatingPanelLastMode.current === "format" ? (
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
						) : floatingPanelLastMode.current === "info" ? (
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
									<input
										ref={findInputRef}
										value={findText}
										placeholder="Find..."
										className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 outline-none focus-visible:border-ring"
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
								{floatingPanelLastMode.current === "replace" ? (
									<div className="flex items-center gap-2">
										<input
											value={replaceText}
											placeholder="Replace..."
											className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 outline-none focus-visible:border-ring"
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
					className="flex min-h-0 flex-1 overflow-y-auto overscroll-contain"
					onKeyDown={(event) => {
						if (
							event.key.toLowerCase() === "b" &&
							(event.ctrlKey || event.metaKey)
						) {
							event.stopPropagation();
						}
					}}
				>
					{appState.activeNotePath &&
					loadedNotePath === appState.activeNotePath &&
					activeYDoc ? (
						<MemoNoteEditor
							key={appState.activeNotePath}
							content={noteContent}
							noteTitle={activeNoteTitle}
							notePath={appState.activeNotePath}
							pageFormat={activePageFormat}
							readOnly={activeNoteReadOnly}
							yDoc={activeYDoc}
							searchQuery={
								floatingPanelMode === "find" || floatingPanelMode === "replace"
									? findText
									: ""
							}
							zenMode={zenMode}
							onChange={updateNoteContent}
							onContentRendered={completeSwitchBenchmark}
							onRename={renameActiveNote}
							onTitleChange={updateActiveTitleDraft}
						/>
					) : appState.activeNotePath ? (
						<div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
							Loading note...
						</div>
					) : (
						<div className="flex flex-1 items-center justify-center">
							<h1 className="font-brand text-5xl text-muted-foreground/50 select-none">
								Paperite
							</h1>
						</div>
					)}
				</section>
			</SidebarInset>
		</SidebarProvider>
	);
}

function normalizeAppState(state: PaperiteAppState): PaperiteAppState {
	return {
		activeNotePath: state.activeNotePath ?? null,
		activeSpacePath: state.activeSpacePath || "Inbox",
		expandedFolders: unique(state.expandedFolders ?? []),
		openTabs: (state.openTabs ?? [])
			.filter((tab) => tab.path && tab.title)
			.map((tab) => ({ ...tab, pinned: tab.pinned === true, preview: tab.preview === true })),
		spaceColors: state.spaceColors ?? {},
		spaceIcons: state.spaceIcons ?? {},
		spaceOrder: unique(state.spaceOrder ?? []),
		spaceSortOrders: normalizeSpaceSortOrders(state.spaceSortOrders ?? {}),
		spacePreviewModes: state.spacePreviewModes ?? {},
		customItemOrders: normalizeCustomItemOrders(state.customItemOrders ?? {}),
		readOnlyNotes: state.readOnlyNotes ?? {},
		sidebarOpen: state.sidebarOpen ?? true,
		inboxViewMode: state.inboxViewMode === "grid" ? "grid" : "list",
		showNotePreview: state.showNotePreview !== false,
		closeButtonOnly: state.closeButtonOnly === true,
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
		spacePreviewModes: state.spacePreviewModes,
		customItemOrders: reconcileCustomItemOrders(
			state.customItemOrders,
			workspace.spaces,
		),
		readOnlyNotes: state.readOnlyNotes,
		sidebarOpen: state.sidebarOpen,
		inboxViewMode: state.inboxViewMode,
		showNotePreview: state.showNotePreview,
		closeButtonOnly: state.closeButtonOnly,
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

function sortOrderForSpace(
	spacePath: string,
	spaceSortOrders: Record<string, SidebarSortOrder>,
) {
	return normalizeSortOrder(spaceSortOrders[spacePath], spacePath);
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

function saveStatusLabel(status: SaveStatus) {
	if (status === "saving") return "Saving...";
	if (status === "saved") return "Saved";
	if (status === "error") return "Error";
	return "";
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
