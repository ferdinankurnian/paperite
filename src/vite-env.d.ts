/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_CLERK_AUTH_CALLBACK_URL?: string;
}

	interface Window {
		electron?: {
			onAuthCallback: (callback: (url: string) => void) => () => void;
			onWorkspaceChanged: (callback: () => void) => () => void;
			onPopoutClosed: (callback: (notePath: string) => void) => () => void;
			onNotePathChanged: (
				callback: (data: { from: string; to: string }) => void,
			) => () => void;
		auth: {
			getPendingCallback: () => Promise<string | null>;
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
			writeNote: (path: string, content: NoteContent) => Promise<{ ok: true }>;
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

type WorkspaceNote = {
	type: "note";
	title: string;
	path: string;
	preview: string;
	updatedAt: number;
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

type OpenNoteTab = {
	path: string;
	title: string;
	preview: boolean;
};

type PaperiteAppState = {
	openTabs: OpenNoteTab[];
	activeNotePath: string | null;
	activeSpacePath: string;
	expandedFolders: string[];
	spaceColors: Record<string, string>;
	spaceIcons: Record<string, string>;
	readOnlyNotes: Record<string, boolean>;
	sidebarOpen: boolean;
};
