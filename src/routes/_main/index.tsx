import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	AlignLeftIcon,
	BookOpenIcon,
	CheckIcon,
	DownloadIcon,
	FileSearchIcon,
	InfoIcon,
	MoreVerticalIcon,
	PencilIcon,
	PrinterIcon,
	SearchIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import {
	type CSSProperties,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { NoteEditor, type PageFormat } from "@/components/note-editor";
import { SidebarHotkeys } from "@/components/sidebar-hotkeys";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { clerk, loadClerk } from "@/lib/clerk";
import { getNotesEngine } from "@/lib/notes-engine";

export const Route = createFileRoute("/_main/")({
	beforeLoad: async () => {
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
	readOnlyNotes: {},
};

type SaveStatus = "idle" | "saving" | "saved" | "error";
type FloatingPanelMode = "find" | "format" | "replace" | null;

const defaultPageFormat: PageFormat = {
	firstLineIndent: false,
	lineHeight: "normal",
	paragraphSpacing: "default",
};

function Index() {
	const notesApi = getNotesEngine();
	const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
	const [appState, setAppState] = useState<PaperiteAppState>(defaultAppState);
	const [markdown, setMarkdown] = useState("");
	const [notePreviews, setNotePreviews] = useState<Record<string, string>>({});
	const [noteTitleDrafts, setNoteTitleDrafts] = useState<
		Record<string, string>
	>({});
	const [floatingPanelMode, setFloatingPanelMode] =
		useState<FloatingPanelMode>(null);
	const [findText, setFindText] = useState("");
	const [replaceText, setReplaceText] = useState("");
	const [pageFormats, setPageFormats] = useState<Record<string, PageFormat>>(
		{},
	);
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
	const didHydrate = useRef(false);
	const findInputRef = useRef<HTMLInputElement>(null);
	const lastLoadedNote = useRef<string | null>(null);
	const lastPersistedMarkdown = useRef("");
	const activeNotePathRef = useRef<string | null>(null);
	const markdownRef = useRef("");
	const noteContentCache = useRef(new Map<string, string>());
	const notePersistedCache = useRef(new Map<string, string>());
	const pendingSwitchBenchmark = useRef<{
		direction: 1 | -1;
		notePath: string;
		source: "benchmark" | "tabs";
		start: number;
	} | null>(null);
	const saveSequence = useRef(0);

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

	useEffect(() => {
		activeNotePathRef.current = appState.activeNotePath;
	}, [appState.activeNotePath]);

	useEffect(() => {
		markdownRef.current = markdown;

		if (
			appState.activeNotePath &&
			lastLoadedNote.current === appState.activeNotePath
		) {
			noteContentCache.current.set(appState.activeNotePath, markdown);
		}
	}, [appState.activeNotePath, markdown]);

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
	}, [notesApi]);

	const syncExternalWorkspace = useCallback(async () => {
		if (!notesApi) return;

		const nextWorkspace = await notesApi.getWorkspace();
		const notePaths = collectNotePaths(nextWorkspace.spaces);

		setWorkspace(nextWorkspace);
		setNotePreviews((current) => pickByPaths(current, notePaths));
		setNoteTitleDrafts((current) => pickByPaths(current, notePaths));
		setAppState((current) => reconcileAppState(current, nextWorkspace));

		const activeNotePath = appState.activeNotePath;
		if (!activeNotePath || !notePaths.has(activeNotePath)) return;
		if (markdown !== lastPersistedMarkdown.current) return;

		try {
			const content = await notesApi.readNote(activeNotePath);
			if (activeNotePathRef.current !== activeNotePath) return;
			if (markdownRef.current !== lastPersistedMarkdown.current) return;

			lastLoadedNote.current = activeNotePath;
			lastPersistedMarkdown.current = content;
			noteContentCache.current.set(activeNotePath, content);
			notePersistedCache.current.set(activeNotePath, content);
			setMarkdown(content);
			setSaveStatus("saved");
		} catch {
			setSaveStatus("error");
		}
	}, [appState.activeNotePath, markdown, notesApi]);

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
			setAppState(normalizeAppState({ ...defaultAppState, ...savedState }));
			didHydrate.current = true;
		};

		hydrate();

		return () => {
			cancelled = true;
		};
	}, [notesApi]);

	useEffect(() => {
		if (!notesApi) return;

		return window.electron?.onWorkspaceChanged(() => {
			syncExternalWorkspace();
		});
	}, [notesApi, syncExternalWorkspace]);

	useEffect(() => {
		if (!notesApi || !didHydrate.current) return;

		notesApi.writeAppState(appState);
	}, [appState, notesApi]);

	useEffect(() => {
		if (!floatingPanelMode) return;

		findInputRef.current?.focus();
	}, [floatingPanelMode]);

	useEffect(() => {
		if (!notesApi || !appState.activeNotePath) {
			setMarkdown("");
			lastLoadedNote.current = null;
			return;
		}

		let cancelled = false;
		const notePath = appState.activeNotePath;

		const loadNote = async () => {
			setSaveStatus("idle");
			const cachedContent = noteContentCache.current.get(notePath);
			setNotePreviews((current) => omitExact(current, notePath));

			if (cachedContent !== undefined) {
				lastLoadedNote.current = notePath;
				lastPersistedMarkdown.current =
					notePersistedCache.current.get(notePath) ?? cachedContent;
				setMarkdown(cachedContent);
				setSaveStatus(
					cachedContent === lastPersistedMarkdown.current ? "saved" : "saving",
				);
			} else {
				lastLoadedNote.current = null;
				lastPersistedMarkdown.current = "";
				setMarkdown("");
			}

			const readStart = performance.now();
			const content = await notesApi.readNote(notePath);
			const readDuration = performance.now() - readStart;

			if (cancelled) return;

			const currentCachedContent = noteContentCache.current.get(notePath);
			const currentPersistedContent = notePersistedCache.current.get(notePath);
			const hasDirtyCachedContent =
				currentCachedContent !== undefined &&
				currentPersistedContent !== undefined &&
				currentCachedContent !== currentPersistedContent;

			if (hasDirtyCachedContent) {
				lastLoadedNote.current = notePath;
				lastPersistedMarkdown.current = currentPersistedContent;
				return;
			}

			lastLoadedNote.current = notePath;
			lastPersistedMarkdown.current = content;
			noteContentCache.current.set(notePath, content);
			notePersistedCache.current.set(notePath, content);
			setMarkdown(content);
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

	useEffect(() => {
		if (!notesApi || !appState.activeNotePath) return;
		if (lastLoadedNote.current !== appState.activeNotePath) return;
		if (markdown === lastPersistedMarkdown.current) {
			setSaveStatus("saved");
			return;
		}

		setSaveStatus("saving");
		const saveTimer = window.setTimeout(() => {
			const notePath = appState.activeNotePath;
			if (!notePath) return;
			const sequence = saveSequence.current + 1;
			saveSequence.current = sequence;

			notesApi
				.writeNote(notePath, markdown)
				.then(() => {
					if (
						saveSequence.current !== sequence ||
						activeNotePathRef.current !== notePath
					) {
						return;
					}

					lastPersistedMarkdown.current = markdown;
					noteContentCache.current.set(notePath, markdown);
					notePersistedCache.current.set(notePath, markdown);
					setSaveStatus(markdownRef.current === markdown ? "saved" : "saving");
					setWorkspace((current) =>
						current
							? updateWorkspaceNote(current, notePath, {
									preview: markdownPreview(markdown),
									updatedAt: Date.now(),
								})
							: current,
					);
				})
				.catch(() => setSaveStatus("error"));
		}, 700);

		return () => window.clearTimeout(saveTimer);
	}, [appState.activeNotePath, markdown, notesApi]);

	const currentSpacePath = useMemo(() => {
		if (
			!workspace?.spaces.some(
				(space) => space.path === appState.activeSpacePath,
			)
		) {
			return workspace?.spaces[0]?.path ?? "Inbox";
		}

		return appState.activeSpacePath;
	}, [appState.activeSpacePath, workspace]);

	const visibleSpaces = useMemo(
		() =>
			applyNoteDecorations(
				workspace?.spaces ?? [],
				notePreviews,
				noteTitleDrafts,
			),
		[workspace, notePreviews, noteTitleDrafts],
	);

	const setActiveSpacePath = (path: string) => {
		setAppState((current) => ({ ...current, activeSpacePath: path }));
	};

	const openNote = (note: WorkspaceNote, mode: "preview" | "pinned") => {
		setAppState((current) => {
			const existing = current.openTabs.find((tab) => tab.path === note.path);
			const previewIndex = current.openTabs.findIndex((tab) => tab.preview);
			const nextTab: OpenNoteTab = {
				path: note.path,
				title: note.title,
				preview: mode === "preview" && !existing,
			};
			const openTabs = existing
				? current.openTabs.map((tab) =>
						tab.path === note.path
							? { ...tab, preview: mode === "pinned" ? false : tab.preview }
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
	};

	const closeTab = useCallback((path: string) => {
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
	}, []);

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

	useEffect(() => {
		const handleTabSwitch = (event: KeyboardEvent) => {
			if (!event.ctrlKey || event.metaKey) return;

			if (
				event.altKey &&
				(event.key === "ArrowRight" || event.key === "ArrowLeft")
			) {
				event.preventDefault();
				switchTab(event.key === "ArrowRight" ? 1 : -1, "benchmark");
				return;
			}

			if (event.altKey) return;

			if (event.key === "Tab") {
				event.preventDefault();
				switchTab(event.shiftKey ? -1 : 1);
				return;
			}

			if (event.key.toLowerCase() === "w" && appState.activeNotePath) {
				event.preventDefault();
				closeTab(appState.activeNotePath);
			}
		};

		window.addEventListener("keydown", handleTabSwitch);
		return () => window.removeEventListener("keydown", handleTabSwitch);
	}, [appState.activeNotePath, closeTab, switchTab]);

	const createNote = async (parentPath: string) => {
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
				"pinned",
			);
		} catch {
			setSaveStatus("error");
		}
	};

	const createFolder = async (parentPath: string) => {
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
		} catch {
			setSaveStatus("error");
		}
	};

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

	const toggleFolder = (path: string, isOpen: boolean) => {
		setAppState((current) => ({
			...current,
			expandedFolders: isOpen
				? unique([...current.expandedFolders, path])
				: current.expandedFolders.filter((folderPath) => folderPath !== path),
		}));
	};

	const moveItem = async (itemPath: string, nextParentPath: string) => {
		if (!notesApi) return;

		try {
			const moved = await notesApi.moveItem(itemPath, nextParentPath);
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
								title: stripMarkdownExtension(
									fileName(movePath(tab.path, itemPath, moved.path)),
								),
							}
						: tab,
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

	const renameActiveNote = async (title: string) => {
		if (!notesApi || !appState.activeNotePath) return;

		try {
			const previousPath = appState.activeNotePath;
			const renamed = await notesApi.renameItem(previousPath, title);
			const nextTitle = stripMarkdownExtension(fileName(renamed.path));

			setAppState((current) => ({
				...current,
				activeNotePath: renamed.path,
				activeSpacePath: topLevelPath(renamed.path),
				openTabs: current.openTabs.map((tab) =>
					tab.path === previousPath
						? { ...tab, path: renamed.path, title: nextTitle }
						: tab,
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
	};

	const deleteActiveNote = async () => {
		if (!notesApi || !appState.activeNotePath) return;

		const notePath = appState.activeNotePath;

		try {
			await notesApi.deleteItem(notePath);
			closeTab(notePath);
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
			const nextTitle = stripMarkdownExtension(fileName(renamed.path));

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
								title:
									tab.path === path
										? nextTitle
										: stripMarkdownExtension(
												fileName(movePath(tab.path, path, renamed.path)),
											),
							}
						: tab,
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

	const deleteItem = async (path: string) => {
		if (!notesApi) return;

		try {
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
			}));
			setNotePreviews((current) => omitDecoration(current, path));
			setNoteTitleDrafts((current) => omitDecoration(current, path));
			setPageFormats((current) => omitDecoration(current, path));
			await refreshWorkspace();
		} catch {
			setSaveStatus("error");
		}
	};

	const replaceInNote = () => {
		if (!findText) return;
		setMarkdown((current) => current.replace(findText, replaceText));
	};

	const replaceAllInNote = () => {
		if (!findText) return;
		setMarkdown((current) => current.split(findText).join(replaceText));
	};

	const updateActiveTitleDraft = (title: string) => {
		if (!appState.activeNotePath) return;

		setNoteTitleDrafts((current) => ({
			...current,
			[appState.activeNotePath as string]: title,
		}));
		setAppState((current) => ({
			...current,
			openTabs: current.openTabs.map((tab) =>
				tab.path === current.activeNotePath ? { ...tab, title } : tab,
			),
		}));
	};

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

	const updateNoteMarkdown = useCallback(
		(nextMarkdown: string, sourceNotePath: string | null) => {
			if (!sourceNotePath) return;

			noteContentCache.current.set(sourceNotePath, nextMarkdown);

			if (sourceNotePath === activeNotePathRef.current) {
				setMarkdown(nextMarkdown);
				return;
			}

			notesApi
				?.writeNote(sourceNotePath, nextMarkdown)
				.then(() => {
					notePersistedCache.current.set(sourceNotePath, nextMarkdown);
					setWorkspace((current) =>
						current
							? updateWorkspaceNote(current, sourceNotePath, {
									preview: markdownPreview(nextMarkdown),
									updatedAt: Date.now(),
								})
							: current,
					);
				})
				.catch(() => setSaveStatus("error"));
		},
		[notesApi],
	);

	const activeNoteReadOnly = appState.activeNotePath
		? appState.readOnlyNotes[appState.activeNotePath] === true
		: false;

	const toggleReadOnly = () => {
		if (!appState.activeNotePath) return;

		setAppState((current) => ({
			...current,
			readOnlyNotes: {
				...current.readOnlyNotes,
				[appState.activeNotePath as string]: !activeNoteReadOnly,
			},
		}));
	};

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
				Paperite needs the Electron shell to access local notes.
			</div>
		);
	}

	return (
		<SidebarProvider
			className="h-full min-h-0"
			style={
				{
					"--sidebar-width": "14.5rem",
				} as CSSProperties
			}
		>
			<SidebarHotkeys />
			<AppSidebar
				activeNotePath={appState.activeNotePath}
				activeSpacePath={currentSpacePath}
				expandedFolders={appState.expandedFolders}
				spaceColors={appState.spaceColors}
				spaceIcons={appState.spaceIcons}
				spaces={visibleSpaces}
				onCreateFolder={createFolder}
				onCreateNote={createNote}
				onCreateSpace={createSpace}
				onDeleteItem={deleteItem}
				onDeleteSpace={deleteSpace}
				onEditSpace={editSpace}
				onMoveItem={moveItem}
				onOpenNote={openNote}
				onRenameItem={renameItem}
				onSelectSpace={setActiveSpacePath}
				onToggleFolder={toggleFolder}
			/>
			<SidebarInset className="min-w-0 overflow-hidden">
				<header className="relative z-10 flex h-12 shrink-0 items-stretch gap-3 px-3 transition-[width,height] ease-linear after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-8 after:bg-linear-to-b after:from-background after:to-transparent after:content-['']">
					<div className="no-scrollbar flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain">
						{appState.openTabs.map((note) => (
							<div
								key={note.path}
								data-active={note.path === appState.activeNotePath}
								data-preview={note.preview}
								className="group my-2 flex w-28 shrink-0 items-center gap-2 rounded-md pl-2.5 pe-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground data-[preview=true]:italic data-[preview=true]:opacity-70 sm:w-36 lg:w-44"
							>
								<button
									type="button"
									className="min-w-0 flex-1 pe-1 truncate text-left"
									onClick={() =>
										setAppState((current) => ({
											...current,
											activeNotePath: note.path,
											activeSpacePath: topLevelPath(note.path),
										}))
									}
									onDoubleClick={() =>
										setAppState((current) => ({
											...current,
											openTabs: current.openTabs.map((tab) =>
												tab.path === note.path
													? { ...tab, preview: false }
													: tab,
											),
										}))
									}
								>
									{displayNoteTitle(note.title)}
								</button>
								<button
									type="button"
									aria-label={`Close ${displayNoteTitle(note.title)}`}
									className="flex size-4 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover:opacity-65 group-data-[active=true]:opacity-65 hover:opacity-100"
									onClick={(event) => {
										event.stopPropagation();
										closeTab(note.path);
									}}
								>
									<XIcon className="size-3.5" />
								</button>
							</div>
						))}
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
								<DropdownMenuItem>
									<InfoIcon />
									Note Info
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem>
									<DownloadIcon />
									Export as PDF…
								</DropdownMenuItem>
								<DropdownMenuItem>
									<PrinterIcon />
									Print…
								</DropdownMenuItem>
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
									<FileSearchIcon />
									Replace in note…
								</DropdownMenuItem>
								<DropdownMenuItem
									onSelect={() => {
										setFloatingPanelMode("format");
									}}
								>
									<AlignLeftIcon />
									Format page…
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
				{floatingPanelMode ? (
					<div className="absolute top-12 right-4 z-20 flex w-80 flex-col gap-2 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10">
						{floatingPanelMode === "format" ? (
							<>
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">Line height</span>
									<Button
										type="button"
										size="icon-sm"
										variant="ghost"
										aria-label="Close format page"
										onClick={() => setFloatingPanelMode(null)}
									>
										<XIcon />
									</Button>
								</div>
								<div className="grid grid-cols-[1fr_auto] items-center gap-2">
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
								</div>
								<span className="pt-1 text-muted-foreground">
									Paragraph spacing
								</span>
								<div className="grid grid-cols-[1fr_auto] items-center gap-2">
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
								</div>
								<FormatPanelButton
									active={activePageFormat.firstLineIndent}
									label="First-line indent"
									onClick={() =>
										updateActivePageFormat({
											firstLineIndent: !activePageFormat.firstLineIndent,
										})
									}
								/>
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
								{floatingPanelMode === "replace" ? (
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
					className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
					onKeyDown={(event) => {
						if (
							event.key.toLowerCase() === "b" &&
							(event.ctrlKey || event.metaKey)
						) {
							event.stopPropagation();
						}
					}}
				>
					<NoteEditor
						markdown={markdown}
						noteTitle={activeNoteTitle}
						notePath={appState.activeNotePath}
						pageFormat={activePageFormat}
						readOnly={activeNoteReadOnly}
						searchQuery={
							floatingPanelMode === "find" || floatingPanelMode === "replace"
								? findText
								: ""
						}
						onChange={updateNoteMarkdown}
						onContentRendered={completeSwitchBenchmark}
						onRename={renameActiveNote}
						onTitleChange={updateActiveTitleDraft}
					/>
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
		openTabs: (state.openTabs ?? []).filter((tab) => tab.path && tab.title),
		spaceColors: state.spaceColors ?? {},
		spaceIcons: state.spaceIcons ?? {},
		readOnlyNotes: state.readOnlyNotes ?? {},
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
		state.activeSpacePath &&
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
		readOnlyNotes: state.readOnlyNotes,
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
			className="flex h-9 items-center justify-between rounded-md px-2.5 text-left text-sm transition-colors hover:bg-muted data-[active=true]:bg-muted"
			onClick={onClick}
		>
			<span>{label}</span>
			{active ? <CheckIcon className="size-4" /> : null}
		</button>
	);
}

function displayNoteTitle(title: string) {
	return title.trim() || "Untitled";
}

function topLevelPath(notePath: string) {
	return notePath.split("/")[0] || "Inbox";
}

function fileName(notePath: string) {
	return notePath.split("/").at(-1) ?? notePath;
}

function stripMarkdownExtension(filename: string) {
	return filename.replace(/\.md$/i, "");
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

	return nextItems.sort((first, second) => {
		if (first.type === "folder" || second.type === "folder") return 0;
		return second.updatedAt - first.updatedAt;
	});
}

function markdownPreview(markdown: string) {
	return (
		markdown
			.replace(/^#{1,6}\s+/gm, "")
			.replace(/[`*_~>#-]/g, "")
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find(Boolean) ?? ""
	);
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
