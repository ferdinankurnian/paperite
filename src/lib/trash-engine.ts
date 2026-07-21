import { ElectronTrashEngine } from "./storage/electron-storage";
import type { TrashEngine } from "./storage/types";
import { WebTrashEngine } from "./storage/web-storage";

export type { TrashEngine } from "./storage/types";

let cachedEngine: TrashEngine | null = null;
let resolved = false;

function resolveEngine(): TrashEngine | null {
	if (resolved) return cachedEngine;
	resolved = true;

	if (window.electron?.trash) {
		cachedEngine = new ElectronTrashEngine();
	} else if (import.meta.env.PAPERITE_WEB) {
		cachedEngine = new WebTrashEngine();
	}

	return cachedEngine;
}

export function getTrashEngine(): TrashEngine | null {
	return resolveEngine();
}
