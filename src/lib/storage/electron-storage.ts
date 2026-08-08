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

// These engines are only ever constructed by getNotesEngine()/getTrashEngine()/
// getSyncEngine() after confirming window.electron exists (see notes-engine.ts,
// trash-engine.ts, sync-engine.ts). window.electron?.foo() would otherwise
// silently resolve to `undefined` at runtime despite every method here
// promising a non-optional return type — asserting it here turns that into
// a clear, immediate error instead of a confusing failure downstream.
function requireElectron(): NonNullable<Window["electron"]> {
	if (!window.electron) {
		throw new Error(
			"ElectronNotesEngine used without the window.electron bridge",
		);
	}
	return window.electron;
}

export class ElectronNotesEngine implements NotesEngine {
	async getWorkspace(): Promise<WorkspaceSnapshot> {
		return requireElectron().notes.getWorkspace();
	}

	async search(query: string): Promise<NoteSearchResult[]> {
		return requireElectron().notes.search(query);
	}

	async readNote(path: string): Promise<NoteContent> {
		return requireElectron().notes.readNote(path);
	}

	async readYNote(path: string): Promise<YNoteState> {
		return requireElectron().notes.readYNote(path);
	}

	async writeYUpdate(
		path: string,
		update: Uint8Array,
	): Promise<{ ok: true; noteId: string; updatedAt: number }> {
		return requireElectron().notes.writeYUpdate(path, update);
	}

	async writeDerivedNote(
		path: string,
		content: NoteContent,
	): Promise<{ ok: true }> {
		return requireElectron().notes.writeDerivedNote(path, content);
	}

	async writeNote(path: string, content: NoteContent): Promise<{ ok: true }> {
		return requireElectron().notes.writeNote(path, content);
	}

	async pruneAssets(path: string): Promise<{ ok: true; deleted: number; skipped?: string }> {
		return requireElectron().notes.pruneAssets(path);
	}

	async createNote(
		parentPath: string,
		title: string,
	): Promise<{ path: string; title: string }> {
		return requireElectron().notes.createNote(parentPath, title);
	}

	async createFolder(
		parentPath: string,
		title: string,
	): Promise<{ path: string; title: string }> {
		return requireElectron().notes.createFolder(parentPath, title);
	}

	async createSpace(title: string): Promise<{ path: string; title: string }> {
		return requireElectron().notes.createSpace(title);
	}

	async renameItem(path: string, nextName: string): Promise<{ path: string }> {
		return requireElectron().notes.renameItem(path, nextName);
	}

	async moveItem(
		path: string,
		nextParentPath: string,
	): Promise<{ path: string }> {
		return requireElectron().notes.moveItem(path, nextParentPath);
	}

	async deleteItem(path: string): Promise<{ ok: true }> {
		return requireElectron().notes.deleteItem(path);
	}

	async popoutNote(path: string): Promise<{ ok: true }> {
		return requireElectron().notes.popoutNote(path);
	}

	async readAppState(): Promise<Partial<PaperiteAppState>> {
		return requireElectron().notes.readAppState();
	}

	async writeAppState(state: PaperiteAppState): Promise<{ ok: true }> {
		return requireElectron().notes.writeAppState(state);
	}
}

export class ElectronTrashEngine implements TrashEngine {
	async getContents(): Promise<TrashNote[]> {
		return requireElectron().trash.getContents();
	}

	async restoreItem(
		trashNoteName: string,
	): Promise<{ ok: true; path: string }> {
		return requireElectron().trash.restoreItem(trashNoteName);
	}

	async permanentDeleteItem(trashNoteName: string): Promise<{ ok: true }> {
		return requireElectron().trash.permanentDeleteItem(trashNoteName);
	}

	async emptyTrash(): Promise<{ ok: true }> {
		return requireElectron().trash.emptyTrash();
	}
}

export class ElectronSyncEngine implements SyncEngine {
	async getStatus(): Promise<SyncStatus> {
		return requireElectron().sync.getStatus();
	}

	async setGoogleDriveEnabled(
		enabled: boolean,
	): Promise<{ ok: true; googleDriveEnabled: boolean }> {
		return requireElectron().sync.setGoogleDriveEnabled(enabled);
	}

	async connectGoogleDrive(): Promise<
		{ ok: true } | { ok: false; error: string }
	> {
		return requireElectron().sync.connectGoogleDrive();
	}

	async runGoogleDrive(): Promise<
		| { ok: true; uploaded: number; downloaded: number }
		| { ok: false; error: string }
	> {
		return requireElectron().sync.runGoogleDrive();
	}

	async disconnectGoogleDrive(): Promise<{ ok: true }> {
		return requireElectron().sync.disconnectGoogleDrive();
	}
}
