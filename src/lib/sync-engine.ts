import { ElectronSyncEngine } from "./storage/electron-storage";
import type { SyncEngine } from "./storage/types";

export type { SyncEngine, SyncStatus } from "./storage/types";

let cachedEngine: SyncEngine | null = null;
let resolved = false;

function resolveEngine(): SyncEngine | null {
	if (resolved) return cachedEngine;
	resolved = true;

	if (window.electron?.sync) {
		cachedEngine = new ElectronSyncEngine();
	}
	// Web mode: sync not supported yet (no server-side Google Drive)
	return cachedEngine;
}

export function getSyncEngine(): SyncEngine | null {
	return resolveEngine();
}

export function onSyncChanged(callback: (data?: { error?: string }) => void) {
	return window.electron?.onSyncChanged(callback) ?? (() => undefined);
}
