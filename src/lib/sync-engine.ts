export type SyncEngine = NonNullable<Window["electron"]>["sync"];

export function getSyncEngine(): SyncEngine | null {
	return window.electron?.sync ?? null;
}

export function onSyncChanged(callback: (data?: { error?: string }) => void) {
	return window.electron?.onSyncChanged(callback) ?? (() => undefined);
}
