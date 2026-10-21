import { wrapNotesEngineWithLiveSync } from "./cloud-live-sync";
import { ElectronNotesEngine } from "./storage/electron-storage";
import type { NotesEngine } from "./storage/types";
import { WebNotesEngine } from "./storage/web-storage";

export type { NotesEngine } from "./storage/types";

let cachedEngine: NotesEngine | null = null;
let resolved = false;

function resolveEngine(): NotesEngine | null {
	if (resolved) return cachedEngine;
	resolved = true;

	if (
		window.electron?.workspaceMode === "attached" ||
		import.meta.env.PAPERITE_WEB
	) {
		cachedEngine = wrapNotesEngineWithLiveSync(new WebNotesEngine());
	} else if (window.electron?.notes) {
		cachedEngine = wrapNotesEngineWithLiveSync(new ElectronNotesEngine());
	}

	return cachedEngine;
}

export function getNotesEngine(): NotesEngine | null {
	return resolveEngine();
}
