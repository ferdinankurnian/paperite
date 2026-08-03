export type NoteContent = {
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

export type YNoteState = {
	noteId: string;
	format: "yjs-v1";
	snapshot: Uint8Array;
};

export type WorkspaceNote = {
	type: "note";
	title: string;
	path: string;
	preview: string;
	updatedAt: number;
	pinned: boolean;
};

export type WorkspaceFolder = {
	type: "folder";
	title: string;
	path: string;
	children: WorkspaceItem[];
};

export type WorkspaceItem = WorkspaceNote | WorkspaceFolder;

export type WorkspaceSpace = {
	title: string;
	path: string;
	children: WorkspaceItem[];
};

export type WorkspaceSnapshot = {
	rootPath: string;
	spaces: WorkspaceSpace[];
};

export type NoteSearchResult = {
	path: string;
	title: string;
	preview: string;
	updatedAt: number;
	rank: number;
};

export type TrashNote = {
	title: string;
	trashPath: string;
	originalPath: string;
	deletedAt: number;
	preview: string;
};

export type OpenNoteTab = {
	path: string;
	title: string;
	preview: boolean;
	pinned: boolean;
};

export type SidebarSortOrder = "newest" | "oldest" | "a-z" | "z-a" | "custom";

export type SpacePreviewMode = "global" | "show" | "hide";

export type PageFormat = {
	firstLineIndent: boolean;
	lineHeight: "normal" | "1.5";
	paragraphSpacing: "default" | "compact";
};

export type PaperiteAppState = {
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
	defaultPageFormat: PageFormat;
};

export interface NotesEngine {
	getWorkspace(): Promise<WorkspaceSnapshot>;
	search(query: string): Promise<NoteSearchResult[]>;
	readNote(path: string): Promise<NoteContent>;
	readYNote(path: string): Promise<YNoteState>;
	writeYUpdate(
		path: string,
		update: Uint8Array,
	): Promise<{ ok: true; noteId: string; updatedAt: number }>;
	writeDerivedNote(path: string, content: NoteContent): Promise<{ ok: true }>;
	writeNote(path: string, content: NoteContent): Promise<{ ok: true }>;
	createNote(
		parentPath: string,
		title: string,
	): Promise<{ path: string; title: string }>;
	createFolder(
		parentPath: string,
		title: string,
	): Promise<{ path: string; title: string }>;
	createSpace(title: string): Promise<{ path: string; title: string }>;
	renameItem(path: string, nextName: string): Promise<{ path: string }>;
	moveItem(path: string, nextParentPath: string): Promise<{ path: string }>;
	deleteItem(path: string): Promise<{ ok: true }>;
	popoutNote(path: string): Promise<{ ok: true }>;
	readAppState(): Promise<Partial<PaperiteAppState>>;
	writeAppState(state: PaperiteAppState): Promise<{ ok: true }>;
}

export interface TrashEngine {
	getContents(): Promise<TrashNote[]>;
	restoreItem(trashNoteName: string): Promise<{ ok: true; path: string }>;
	permanentDeleteItem(trashNoteName: string): Promise<{ ok: true }>;
	emptyTrash(): Promise<{ ok: true }>;
}

export interface SyncEngine {
	getStatus(): Promise<SyncStatus>;
	setGoogleDriveEnabled(
		enabled: boolean,
	): Promise<{ ok: true; googleDriveEnabled: boolean }>;
	connectGoogleDrive(): Promise<{ ok: true } | { ok: false; error: string }>;
	runGoogleDrive(): Promise<
		| { ok: true; uploaded: number; downloaded: number }
		| { ok: false; error: string }
	>;
	disconnectGoogleDrive(): Promise<{ ok: true }>;
}

export type SyncStatus = {
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
