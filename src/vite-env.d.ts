/// <reference types="vite/client" />

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
			writeNote: (path: string, content: NoteContent) => Promise<{ ok: true }>;
			saveImage: (
				notePath: string,
				imageDataUrl: string,
				filename: string,
			) => Promise<{ path: string }>;
			getAssetUrl: (notePath: string, assetPath: string) => Promise<string>;
			setPinned: (notePath: string, pinned: boolean) => Promise<{ pinned: boolean }>;
			createNote: (
				parentPath: string,
				title: string,
			) => Promise<{ path: string; title: string }>;
			createFolder: (
				parentPath: string,
				title: string,
			) => Promise<{ path: string; title: string }>;
			createSpace: (title: string) => Promise<{ path: string; title: string }>;
			renameItem: (path: string, nextName: string) => Promise<{ path: string }>;
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

type NoteContent = {
	type?: string;
	attrs?: Record<string, unknown>;
	content?: NoteContent[];
	marks?: Array<{
		type: string;
		attrs?: Record<string, unknown>;
	}>;
	text?: string;
	[key: string]: unknown;
};

type YNoteState = {
	noteId: string;
	format: "yjs-v1";
	snapshot: Uint8Array;
};

type SyncStatus = {
	googleDrive: {
		configured: boolean;
		connected: boolean;
		enabled: boolean;
		expiresAt: number | null;
		syncing: boolean;
		lastSyncedAt: number | null;
		lastError: string | null;
	};
	convex: {
		configured: boolean;
	};
};

type WorkspaceNote = {
	type: "note";
	title: string;
	path: string;
	preview: string;
	updatedAt: number;
	pinned: boolean;
};

type WorkspaceFolder = {
	type: "folder";
	title: string;
	path: string;
	children: WorkspaceItem[];
};

type WorkspaceItem = WorkspaceNote | WorkspaceFolder;

type WorkspaceSpace = {
	title: string;
	path: string;
	children: WorkspaceItem[];
};

type WorkspaceSnapshot = {
	rootPath: string;
	spaces: WorkspaceSpace[];
};

type NoteSearchResult = {
	path: string;
	title: string;
	preview: string;
	updatedAt: number;
	rank: number;
};

type TrashNote = {
	title: string;
	trashPath: string;
	originalPath: string;
	deletedAt: number;
	preview: string;
};

type OpenNoteTab = {
	path: string;
	title: string;
	preview: boolean;
};

type SidebarSortOrder = "newest" | "oldest" | "a-z" | "z-a" | "custom";

type SpacePreviewMode = "global" | "show" | "hide";

type PaperiteAppState = {
	openTabs: OpenNoteTab[];
	activeNotePath: string | null;
	activeSpacePath: string;
	expandedFolders: string[];
	spaceColors: Record<string, string>;
	spaceIcons: Record<string, string>;
	spaceOrder: string[];
	spaceSortOrders: Record<string, SidebarSortOrder>;
	spacePreviewModes: Record<string, SpacePreviewMode>;
	customItemOrders: Record<string, string[]>;
	readOnlyNotes: Record<string, boolean>;
	sidebarOpen: boolean;
	inboxViewMode: "list" | "grid";
	showNotePreview: boolean;
	closeButtonOnly: boolean;
};
