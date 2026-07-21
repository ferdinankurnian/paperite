export type ExportStatus =
	| "pending"
	| "writing"
	| "done"
	| "error"
	| "cancelled";

export interface ExportItem {
	id: string;
	noteTitle: string;
	format: "markdown" | "txt";
	destPath: string | null;
	status: ExportStatus;
	error?: string;
	createdAt: number;
}

type Listener = () => void;

let exports: ExportItem[] = [];
const listeners: Set<Listener> = new Set();

function notify() {
	for (const l of listeners) {
		l();
	}
}

export function subscribeExports(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function getExports(): ExportItem[] {
	return exports;
}

export function getActiveCount(): number {
	return exports.filter((e) => e.status === "pending" || e.status === "writing")
		.length;
}

export function addExport(
	item: Omit<ExportItem, "id" | "status" | "createdAt">,
): string {
	const id = crypto.randomUUID();
	const entry: ExportItem = {
		...item,
		id,
		status: "pending",
		createdAt: Date.now(),
	};
	exports = [entry, ...exports];
	notify();
	return id;
}

export function updateExport(id: string, updates: Partial<ExportItem>) {
	exports = exports.map((e) => (e.id === id ? { ...e, ...updates } : e));
	notify();
}

export function cancelExport(id: string) {
	exports = exports.map((e) =>
		e.id === id && (e.status === "pending" || e.status === "writing")
			? { ...e, status: "cancelled" as const }
			: e,
	);
	notify();
}

export function removeExport(id: string) {
	exports = exports.filter((e) => e.id !== id);
	notify();
}

export function clearCompleted() {
	exports = exports.filter(
		(e) => e.status === "pending" || e.status === "writing",
	);
	notify();
}
