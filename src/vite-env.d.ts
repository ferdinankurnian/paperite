/// <reference types="vite/client" />

interface Window {
	electron?: {
		onAuthCallback: (callback: (url: string) => void) => () => void;
		onWorkspaceChanged: (callback: () => void) => () => void;
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
			readNote: (path: string) => Promise<string>;
			writeNote: (path: string, markdown: string) => Promise<{ ok: true }>;
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
			readAppState: () => Promise<Partial<PaperiteAppState>>;
			writeAppState: (state: PaperiteAppState) => Promise<{ ok: true }>;
		};
	};
}

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
};
