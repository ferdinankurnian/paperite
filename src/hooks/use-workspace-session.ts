import { useCallback, useEffect, useRef } from "react";
import { subscribeLocalWorkspaceChanged } from "@/lib/local-live-sync";
import {
	serializeNoteContent,
	serializeNoteContentBody,
} from "@/lib/note-content";
import type { NotesEngine } from "@/lib/notes-engine";
import type {
	NoteContent,
	PaperiteAppState,
	TrashNote,
	WorkspaceSnapshot,
} from "@/lib/storage/types";
import {
	defaultAppState,
	getAppStateSnapshot,
	useAppStore,
} from "@/lib/stores/app-store";
import type { SaveStatus } from "@/lib/stores/editor-ui-store";
import { useEditorUiStore } from "@/lib/stores/editor-ui-store";
import {
	diffWorkspaceNotes,
	isWorkspaceContentEqual,
} from "@/lib/workspace-tree";

type Ref<T> = { current: T };
type Options = {
	notesApi: NotesEngine | null;
	noteContentRef: Ref<NoteContent>;
	lastPersistedContent: Ref<string>;
	activeNotePathRef: Ref<string | null>;
	noteContentCache: Ref<Map<string, NoteContent>>;
	notePersistedCache: Ref<Map<string, NoteContent>>;
	setWorkspace: React.Dispatch<React.SetStateAction<WorkspaceSnapshot | null>>;
	setNotePreviews: React.Dispatch<React.SetStateAction<Record<string, string>>>;
	setNoteTitleDrafts: React.Dispatch<
		React.SetStateAction<Record<string, string>>
	>;
	/** Programmatic content commit (external sync) — bumps editor without Index noteContent state. */
	commitNoteContent: (path: string, content: NoteContent) => void;
	setTrashNotes: React.Dispatch<React.SetStateAction<TrashNote[]>>;
	setSaveStatus: (status: SaveStatus) => void;
	setAppState: (
		state: PaperiteAppState | ((state: PaperiteAppState) => PaperiteAppState),
	) => void;
	didHydrate: Ref<boolean>;
	normalizeAppState: (state: PaperiteAppState) => PaperiteAppState;
	reconcileAppState: (
		state: PaperiteAppState,
		workspace: WorkspaceSnapshot,
	) => PaperiteAppState;
	collectNotePaths: (spaces: WorkspaceSnapshot["spaces"]) => Set<string>;
};

export function useWorkspaceSession(options: Options) {
	const optionsRef = useRef(options);
	optionsRef.current = options;
	const workspaceRef = useRef<WorkspaceSnapshot | null>(null);
	const refreshTrash = useCallback(async () => {
		const current = optionsRef.current;
		const api = (await import("@/lib/trash-engine")).getTrashEngine();
		if (!api) return;
		try {
			current.setTrashNotes(await api.getContents());
		} catch {
			/* non-critical */
		}
	}, []);
	const refreshWorkspace = useCallback(async () => {
		const current = optionsRef.current;
		if (!current.notesApi) return;
		const workspace = await current.notesApi.getWorkspace();
		workspaceRef.current = workspace;
		current.setWorkspace(workspace);
		await refreshTrash();
	}, [refreshTrash]);
	const syncExternalWorkspace = useCallback(async () => {
		const current = optionsRef.current;
		if (!current.notesApi) return;
		const workspace = await current.notesApi.getWorkspace();
		const paths = current.collectNotePaths(workspace.spaces);
		workspaceRef.current = workspace;
		// Self-triggered file-watcher events (our own autosave just wrote
		// note.json) carry no new tree info — the preview patch already landed
		// via updateWorkspaceNote. Swapping the tree here busted every sidebar
		// memo + app-store subscriber on every save (full-page re-render while
		// typing), so bail before touching any state.
		if (
			isWorkspaceContentEqual(useEditorUiStore.getState().workspace, workspace)
		)
			return;
		// Stale echo, mid-typing edition: the disk tree was snapshotted before
		// our latest keystrokes, so its preview lags our optimistic patch on
		// exactly the notes that are still dirty in memory. Our tree is
		// fresher — swapping in the stale one would bust every sidebar memo
		// (all-new object identities) for zero new information, on every save
		// while typing. Only take the incoming tree when something structural
		// changed or a clean note actually differs (real external edit).
		if (
			isStaleEchoOnly(
				useEditorUiStore.getState().workspace,
				workspace,
				current.noteContentCache.current,
				current.notePersistedCache.current,
			)
		) {
			workspaceRef.current = useEditorUiStore.getState().workspace;
			return;
		}
		current.setWorkspace(workspace);
		// Object.fromEntries always builds a new ref — only publish when a path
		// actually vanished, or every sync re-renders all preview/title
		// subscribers (i.e. every sidebar row).
		current.setNotePreviews((value) => {
			let removed = false;
			for (const path of Object.keys(value)) {
				if (!paths.has(path)) {
					removed = true;
					break;
				}
			}
			if (!removed) return value;
			return Object.fromEntries(
				Object.entries(value).filter(([path]) => paths.has(path)),
			);
		});
		current.setNoteTitleDrafts((value) => {
			let removed = false;
			for (const path of Object.keys(value)) {
				if (!paths.has(path)) {
					removed = true;
					break;
				}
			}
			if (!removed) return value;
			return Object.fromEntries(
				Object.entries(value).filter(([path]) => paths.has(path)),
			);
		});
		current.setAppState((value) => current.reconcileAppState(value, workspace));
		const activePath = useAppStore.getState().activeNotePath;
		if (
			!activePath ||
			!paths.has(activePath) ||
			serializeNoteContentBody(current.noteContentRef.current) !==
				current.lastPersistedContent.current
		)
			return;
		try {
			const content = await current.notesApi.readNote(activePath);
			if (
				current.activeNotePathRef.current !== activePath ||
				serializeNoteContentBody(current.noteContentRef.current) !==
					current.lastPersistedContent.current
			)
				return;
			// The tree changed elsewhere — but the active file itself may be
			// identical to our cache. Committing unconditionally bumps the content
			// epoch and re-renders the whole editor pane for nothing.
			const cached = current.noteContentCache.current.get(activePath);
			if (
				cached &&
				serializeNoteContent(content) === serializeNoteContent(cached)
			) {
				current.lastPersistedContent.current =
					serializeNoteContentBody(content);
				current.notePersistedCache.current.set(activePath, content);
				current.setSaveStatus("saved");
				return;
			}
			current.lastPersistedContent.current = serializeNoteContentBody(content);
			current.notePersistedCache.current.set(activePath, content);
			current.commitNoteContent(activePath, content);
			current.setSaveStatus("saved");
		} catch {
			current.setSaveStatus("error");
		}
	}, []);
	useEffect(() => {
		const current = optionsRef.current;
		if (!current.notesApi) return;
		let cancelled = false;
		Promise.all([
			current.notesApi.getWorkspace(),
			current.notesApi.readAppState(),
		])
			.then(([workspace, saved]) => {
				if (cancelled) return;
				workspaceRef.current = workspace;
				current.setWorkspace(workspace);
				current.setAppState(
					current.reconcileAppState(
						current.normalizeAppState({ ...defaultAppState, ...saved }),
						workspace,
					),
				);
				current.didHydrate.current = true;
				void refreshTrash();
			})
			.catch((error) => {
				console.error("[paperite] failed to hydrate workspace", error);
				current.setSaveStatus("error");
			});
		return () => {
			cancelled = true;
		};
	}, [refreshTrash]);
	useEffect(() => {
		if (!optionsRef.current.notesApi) return;
		const attached = window.electron?.workspaceMode === "attached";
		const unsubscribeElectron = attached
			? undefined
			: window.electron?.onWorkspaceChanged(() => {
				void syncExternalWorkspace();
			});
		const unsubscribeWeb =
			!window.electron || attached
				? subscribeLocalWorkspaceChanged(() => {
						void syncExternalWorkspace();
					})
				: () => undefined;
		return () => {
			unsubscribeElectron?.();
			unsubscribeWeb();
		};
	}, [syncExternalWorkspace]);
	useEffect(() => {
		const current = optionsRef.current;
		if (!current.notesApi) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const unsub = useAppStore.subscribe(() => {
			if (!current.didHydrate.current) return;
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				void current.notesApi?.writeAppState(getAppStateSnapshot());
			}, 300);
		});
		return () => {
			unsub();
			if (timer) clearTimeout(timer);
		};
	}, []);
	return {
		workspaceRef,
		refreshTrash,
		refreshWorkspace,
		syncExternalWorkspace,
	};
}

/**
 * True when the incoming disk tree only lags our optimistic patch on notes
 * that are still dirty in memory (preview-only diffs, nothing structural).
 * The in-memory tree is fresher, so the caller keeps it instead of swapping
 * in the stale snapshot and busting every sidebar memo.
 */
function isStaleEchoOnly(
	published: WorkspaceSnapshot | null,
	incoming: WorkspaceSnapshot | null,
	contentCache: Map<string, NoteContent>,
	persistedCache: Map<string, NoteContent>,
): boolean {
	const diff = diffWorkspaceNotes(published, incoming);
	if (diff.structural) return false;
	if (diff.changedNotePaths.length === 0) return true;
	return diff.changedNotePaths.every((path) => {
		const cached = contentCache.get(path);
		if (!cached) return false;
		const persisted = persistedCache.get(path);
		if (!persisted) return true;
		return (
			serializeNoteContentBody(cached) !== serializeNoteContentBody(persisted)
		);
	});
}
