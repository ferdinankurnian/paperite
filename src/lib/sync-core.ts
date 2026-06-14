export type SyncProviderKind = "google-drive" | "convex";

export type SyncSpaceKind = "personal" | "collaborative";

export type SyncSpace = {
	id: string;
	kind: SyncSpaceKind;
	provider: SyncProviderKind;
	name: string;
};

export type SyncDocumentId = {
	spaceId: string;
	noteId: string;
};

export type SyncUpdate = {
	document: SyncDocumentId;
	updateId: string;
	deviceId: string;
	createdAt: number;
	format: "yjs-v1";
	data: Uint8Array;
};

export type SyncSnapshot = {
	document: SyncDocumentId;
	createdAt: number;
	format: "yjs-v1";
	stateVector: Uint8Array;
	data: Uint8Array;
};

export type SyncPullResult = {
	snapshot: SyncSnapshot | null;
	updates: SyncUpdate[];
};

export type SyncProvider = {
	kind: SyncProviderKind;
	pull(
		document: SyncDocumentId,
		knownUpdateIds: Set<string>,
	): Promise<SyncPullResult>;
	push(update: SyncUpdate): Promise<void>;
	writeSnapshot(snapshot: SyncSnapshot): Promise<void>;
};

export const personalDriveSpace = {
	id: "personal",
	kind: "personal",
	provider: "google-drive",
	name: "Personal",
} satisfies SyncSpace;

export function createSyncUpdateId(deviceId: string, sequence: number) {
	return `${deviceId}-${sequence.toString().padStart(12, "0")}`;
}
