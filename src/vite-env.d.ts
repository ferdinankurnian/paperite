/// <reference types="vite/client" />

import type {
	NoteContent as StorageNoteContent,
	NoteSearchResult as StorageNoteSearchResult,
	OpenNoteTab as StorageOpenNoteTab,
	PaperiteAppState as StoragePaperiteAppState,
	SidebarSortOrder as StorageSidebarSortOrder,
	SpacePreviewMode as StorageSpacePreviewMode,
	SyncStatus as StorageSyncStatus,
	TrashNote as StorageTrashNote,
	WorkspaceFolder as StorageWorkspaceFolder,
	WorkspaceItem as StorageWorkspaceItem,
	WorkspaceNote as StorageWorkspaceNote,
	WorkspaceSnapshot as StorageWorkspaceSnapshot,
	WorkspaceSpace as StorageWorkspaceSpace,
	YNoteState as StorageYNoteState,
} from "@/lib/storage/types";

// The data-model types below are global aliases for src/lib/storage/types.ts
// — the single source of truth. Do NOT hand-copy their shapes here again:
// that's what caused OpenNoteTab.pinned to silently drift out of sync
// between this file and storage/types.ts (see plans/010-fix-build-errors-
// and-edit-space-bug.md). Add new fields in storage/types.ts only.
declare global {
	interface ImportMetaEnv {
		readonly VITE_CLERK_AUTH_CALLBACK_URL?: string;
		readonly VITE_CONVEX_URL?: string;
		readonly PAPERITE_WEB?: boolean;
		readonly PAPERITE_API_URL?: string;
	}

	interface Window {
		electron?: {
			platform: {
				isMacOS: boolean;
			};
			onAppMenuAction: (callback: (action: string) => void) => () => void;
			onAppMenuFormat: (
				callback: (
					command:
						| "bold"
						| "italic"
						| "underline"
						| "strike"
						| "highlight"
						| "quote"
						| "code-block"
						| "typography-heading-1"
						| "typography-heading-2"
						| "typography-heading-3"
						| "typography-body"
						| "bullet-list"
						| "ordered-list"
						| "task-list"
						| "align-left"
						| "align-center"
						| "align-right"
						| "align-justify",
				) => void,
			) => () => void;
			onAuthCallback: (callback: (url: string) => void) => () => void;
			onWorkspaceChanged: (callback: () => void) => () => void;
			onPopoutClosed: (callback: (notePath: string) => void) => () => void;
			onNotePathChanged: (
				callback: (data: { from: string; to: string }) => void,
			) => () => void;
			onSyncChanged: (
				callback: (data?: { error?: string }) => void,
			) => () => void;
			auth: {
				getPendingCallback: () => Promise<string | null>;
			};
			sync: {
				getStatus: () => Promise<SyncStatus>;
				setGoogleDriveEnabled: (
					enabled: boolean,
				) => Promise<{ ok: true; googleDriveEnabled: boolean }>;
				connectGoogleDrive: () => Promise<
					{ ok: true } | { ok: false; error: string }
				>;
				runGoogleDrive: () => Promise<
					| { ok: true; uploaded: number; downloaded: number }
					| { ok: false; error: string }
				>;
				disconnectGoogleDrive: () => Promise<{ ok: true }>;
			};
			openExternal: (url: string) => Promise<void>;
			app: {
				setTitle: (title: string) => Promise<{ ok: true }>;
			};
			window: {
				getState: () => Promise<{ isMaximized: boolean }>;
				action: (
					action:
						| "minimize"
						| "toggleMaximize"
						| "close"
						| "quit"
						| "reload"
						| "forceReload"
						| "toggleDevTools"
						| "undo"
						| "redo"
						| "cut"
						| "copy"
						| "paste"
						| "selectAll",
				) => Promise<{ ok: boolean }>;
			};
			notes: {
				getWorkspace: () => Promise<WorkspaceSnapshot>;
				search: (query: string) => Promise<NoteSearchResult[]>;
				readNote: (path: string) => Promise<NoteContent>;
				readYNote: (path: string) => Promise<YNoteState>;
				writeYUpdate: (
					path: string,
					update: Uint8Array,
				) => Promise<{ ok: true; noteId: string; updatedAt: number }>;
				writeDerivedNote: (
					path: string,
					content: NoteContent,
				) => Promise<{ ok: true }>;
				writeNote: (
					path: string,
					content: NoteContent,
				) => Promise<{ ok: true }>;
				saveImage: (
					notePath: string,
					imageDataUrl: string,
					filename: string,
				) => Promise<{ path: string }>;
				getAssetUrl: (notePath: string, assetPath: string) => Promise<string>;
				pruneAssets: (
					notePath: string,
				) => Promise<{ ok: true; deleted: number; skipped?: string }>;
				setPinned: (
					notePath: string,
					pinned: boolean,
				) => Promise<{ pinned: boolean }>;
				createNote: (
					parentPath: string,
					title: string,
				) => Promise<{ path: string; title: string }>;
				createFolder: (
					parentPath: string,
					title: string,
				) => Promise<{ path: string; title: string }>;
				createSpace: (
					title: string,
				) => Promise<{ path: string; title: string }>;
				renameItem: (
					path: string,
					nextName: string,
				) => Promise<{ path: string }>;
				moveItem: (
					path: string,
					nextParentPath: string,
				) => Promise<{ path: string }>;
				deleteItem: (path: string) => Promise<{ ok: true }>;
				popoutNote: (path: string) => Promise<{ ok: true }>;
				readAppState: () => Promise<Partial<PaperiteAppState>>;
				writeAppState: (state: PaperiteAppState) => Promise<{ ok: true }>;
				exportFile: (
					content: string,
					format: "markdown" | "txt",
					defaultFilename: string,
				) => Promise<{ canceled: boolean; filePath?: string }>;
				getDefaultExportDir: () => Promise<string>;
			};
			trash: {
				getContents: () => Promise<TrashNote[]>;
				restoreItem: (
					trashNoteName: string,
				) => Promise<{ ok: true; path: string }>;
				permanentDeleteItem: (trashNoteName: string) => Promise<{ ok: true }>;
				emptyTrash: () => Promise<{ ok: true }>;
			};
		};
	}

	type NoteContent = StorageNoteContent;
	type YNoteState = StorageYNoteState;
	type SyncStatus = StorageSyncStatus;
	type WorkspaceNote = StorageWorkspaceNote;
	type WorkspaceFolder = StorageWorkspaceFolder;
	type WorkspaceItem = StorageWorkspaceItem;
	type WorkspaceSpace = StorageWorkspaceSpace;
	type WorkspaceSnapshot = StorageWorkspaceSnapshot;
	type NoteSearchResult = StorageNoteSearchResult;
	type TrashNote = StorageTrashNote;
	type OpenNoteTab = StorageOpenNoteTab;
	type SidebarSortOrder = StorageSidebarSortOrder;
	type SpacePreviewMode = StorageSpacePreviewMode;
	type PaperiteAppState = StoragePaperiteAppState;
}
