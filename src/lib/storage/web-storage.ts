import type {
	NoteContent,
	NoteSearchResult,
	NotesEngine,
	PaperiteAppState,
	TrashNote,
	WorkspaceSnapshot,
	YNoteState,
} from "./types";

const BASE_URL = import.meta.env.PAPERITE_API_URL ?? "";

async function api<T>(path: string, options?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE_URL}${path}`, {
		headers: {
			"Content-Type": "application/json",
			...options?.headers,
		},
		...options,
	});

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`API error ${res.status}: ${body}`);
	}

	return res.json() as Promise<T>;
}

async function apiBinary(
	path: string,
	options?: RequestInit,
): Promise<ArrayBuffer> {
	const res = await fetch(`${BASE_URL}${path}`, options);

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`API error ${res.status}: ${body}`);
	}

	return res.arrayBuffer();
}

export class WebNotesEngine implements NotesEngine {
	async getWorkspace(): Promise<WorkspaceSnapshot> {
		return api<WorkspaceSnapshot>("/api/workspace");
	}

	async search(query: string): Promise<NoteSearchResult[]> {
		return api<NoteSearchResult[]>(
			`/api/search?q=${encodeURIComponent(query)}`,
		);
	}

	async readNote(path: string): Promise<NoteContent> {
		return api<NoteContent>(`/api/notes/${encodeURIComponent(path)}`);
	}

	async readYNote(path: string): Promise<YNoteState> {
		const buf = await apiBinary(`/api/notes/${encodeURIComponent(path)}/yjs`);
		const view = new Uint8Array(buf);
		const noteId = new TextDecoder().decode(view.slice(0, view.indexOf(0)));
		const snapshot = view.slice(view.indexOf(0) + 1);
		return { noteId, format: "yjs-v1", snapshot };
	}

	async writeYUpdate(
		path: string,
		update: Uint8Array,
	): Promise<{ ok: true; noteId: string; updatedAt: number }> {
		// `Uint8Array`'s type is generic over its backing buffer
		// (`ArrayBufferLike` = `ArrayBuffer | SharedArrayBuffer`), and DOM's
		// `BodyInit`/`BlobPart` types only accept the concrete `ArrayBuffer`
		// case. At runtime this is always a real, non-shared buffer (it
		// comes straight from Yjs's update encoder, never from a
		// SharedArrayBuffer-backed view) — `fetch` has always accepted a
		// plain `Uint8Array` body. This cast bridges that lib-type gap
		// without an unnecessary copy.
		return api(`/api/notes/${encodeURIComponent(path)}/yjs/update`, {
			method: "POST",
			body: update as BodyInit,
			headers: { "Content-Type": "application/octet-stream" },
		});
	}

	async writeDerivedNote(
		path: string,
		content: NoteContent,
	): Promise<{ ok: true }> {
		return api(`/api/notes/${encodeURIComponent(path)}/derived`, {
			method: "PUT",
			body: JSON.stringify(content),
		});
	}

	async writeNote(path: string, content: NoteContent): Promise<{ ok: true }> {
		return api(`/api/notes/${encodeURIComponent(path)}`, {
			method: "PUT",
			body: JSON.stringify(content),
		});
	}

	async createNote(
		parentPath: string,
		title: string,
	): Promise<{ path: string; title: string }> {
		return api("/api/notes", {
			method: "POST",
			body: JSON.stringify({ parentPath, title }),
		});
	}

	async createFolder(
		parentPath: string,
		title: string,
	): Promise<{ path: string; title: string }> {
		return api("/api/folders", {
			method: "POST",
			body: JSON.stringify({ parentPath, title }),
		});
	}

	async createSpace(title: string): Promise<{ path: string; title: string }> {
		return api("/api/spaces", {
			method: "POST",
			body: JSON.stringify({ title }),
		});
	}

	async renameItem(path: string, nextName: string): Promise<{ path: string }> {
		return api("/api/rename", {
			method: "PATCH",
			body: JSON.stringify({ path, nextName }),
		});
	}

	async moveItem(
		path: string,
		nextParentPath: string,
	): Promise<{ path: string }> {
		return api("/api/move", {
			method: "POST",
			body: JSON.stringify({ path, nextParentPath }),
		});
	}

	async deleteItem(path: string): Promise<{ ok: true }> {
		return api(`/api/notes/${encodeURIComponent(path)}`, {
			method: "DELETE",
		});
	}

	async popoutNote(_path: string): Promise<{ ok: true }> {
		return { ok: true };
	}

	async readAppState(): Promise<Partial<PaperiteAppState>> {
		return api("/api/state");
	}

	async writeAppState(state: PaperiteAppState): Promise<{ ok: true }> {
		return api("/api/state", {
			method: "PUT",
			body: JSON.stringify(state),
		});
	}
}

export class WebTrashEngine {
	async getContents(): Promise<TrashNote[]> {
		return api<TrashNote[]>("/api/trash");
	}

	async restoreItem(
		trashNoteName: string,
	): Promise<{ ok: true; path: string }> {
		return api("/api/trash/restore", {
			method: "POST",
			body: JSON.stringify({ name: trashNoteName }),
		});
	}

	async permanentDeleteItem(trashNoteName: string): Promise<{ ok: true }> {
		return api(`/api/trash/${encodeURIComponent(trashNoteName)}`, {
			method: "DELETE",
		});
	}

	async emptyTrash(): Promise<{ ok: true }> {
		return api("/api/trash", { method: "DELETE" });
	}
}
