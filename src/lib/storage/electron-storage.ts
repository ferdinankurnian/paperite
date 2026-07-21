import type {
	NoteContent,
	NoteSearchResult,
	NotesEngine,
	PaperiteAppState,
	SyncEngine,
	SyncStatus,
	TrashEngine,
	TrashNote,
	WorkspaceSnapshot,
	YNoteState,
} from "./types";

export class ElectronNotesEngine implements NotesEngine {
	async getWorkspace(): Promise<WorkspaceSnapshot> {
		return window.electron?.notes.getWorkspace();
	}

	async search(query: string): Promise<NoteSearchResult[]> {
		return window.electron?.notes.search(query);
	}

	async readNote(path: string): Promise<NoteContent> {
		return window.electron?.notes.readNote(path);
	}

	async readYNote(path: string): Promise<YNoteState> {
		return window.electron?.notes.readYNote(path);
	}

	async writeYUpdate(
		path: string,
		update: Uint8Array,
	): Promise<{ ok: true; noteId: string; updatedAt: number }> {
		return window.electron?.notes.writeYUpdate(path, update);
	}

	async writeDerivedNote(
		path: string,
		content: NoteContent,
	): Promise<{ ok: true }> {
		return window.electron?.notes.writeDerivedNote(path, content);
	}

	async writeNote(path: string, content: NoteContent): Promise<{ ok: true }> {
		return window.electron?.notes.writeNote(path, content);
	}

	async createNote(
		parentPath: string,
		title: string,
	): Promise<{ path: string; title: string }> {
		return window.electron?.notes.createNote(parentPath, title);
	}

	async createFolder(
		parentPath: string,
		title: string,
	): Promise<{ path: string; title: string }> {
		return window.electron?.notes.createFolder(parentPath, title);
	}

	async createSpace(title: string): Promise<{ path: string; title: string }> {
		return window.electron?.notes.createSpace(title);
	}

	async renameItem(path: string, nextName: string): Promise<{ path: string }> {
		return window.electron?.notes.renameItem(path, nextName);
	}

	async moveItem(
		path: string,
		nextParentPath: string,
	): Promise<{ path: string }> {
		return window.electron?.notes.moveItem(path, nextParentPath);
	}

	async deleteItem(path: string): Promise<{ ok: true }> {
		return window.electron?.notes.deleteItem(path);
	}

	async popoutNote(path: string): Promise<{ ok: true }> {
		return window.electron?.notes.popoutNote(path);
	}

	async readAppState(): Promise<Partial<PaperiteAppState>> {
		return window.electron?.notes.readAppState();
	}

	async writeAppState(state: PaperiteAppState): Promise<{ ok: true }> {
		return window.electron?.notes.writeAppState(state);
	}
}

export class ElectronTrashEngine implements TrashEngine {
	async getContents(): Promise<TrashNote[]> {
		return window.electron?.trash.getContents();
	}

	async restoreItem(
		trashNoteName: string,
	): Promise<{ ok: true; path: string }> {
		return window.electron?.trash.restoreItem(trashNoteName);
	}

	async permanentDeleteItem(trashNoteName: string): Promise<{ ok: true }> {
		return window.electron?.trash.permanentDeleteItem(trashNoteName);
	}

	async emptyTrash(): Promise<{ ok: true }> {
		return window.electron?.trash.emptyTrash();
	}
}

export class ElectronSyncEngine implements SyncEngine {
	async getStatus(): Promise<SyncStatus> {
		return window.electron?.sync.getStatus();
	}

	async setGoogleDriveEnabled(
		enabled: boolean,
	): Promise<{ ok: true; googleDriveEnabled: boolean }> {
		return window.electron?.sync.setGoogleDriveEnabled(enabled);
	}

	async connectGoogleDrive(): Promise<
		{ ok: true } | { ok: false; error: string }
	> {
		return window.electron?.sync.connectGoogleDrive();
	}

	async runGoogleDrive(): Promise<
		| { ok: true; uploaded: number; downloaded: number }
		| { ok: false; error: string }
	> {
		return window.electron?.sync.runGoogleDrive();
	}

	async disconnectGoogleDrive(): Promise<{ ok: true }> {
		return window.electron?.sync.disconnectGoogleDrive();
	}
}
