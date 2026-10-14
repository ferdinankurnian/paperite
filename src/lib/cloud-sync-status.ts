import { useSyncExternalStore } from "react";

export type CloudTransientPhase = "syncing" | "error";

export type CloudTransientEntry = {
	phase: CloudTransientPhase;
	message: string | null;
};

/**
 * Transient per-space cloud phases (a share/pull in flight, or its error).
 * The space settings dialog writes; the titlebar indicator reads. The
 * durable linked state stays in `PaperiteAppState.cloudSpaceLinks` — this
 * store is memory-only and never persisted.
 */
const transientBySpace = new Map<string, CloudTransientEntry>();

type Listener = () => void;

const listeners = new Set<Listener>();

function notify() {
	for (const listener of listeners) listener();
}

export function subscribeCloudTransient(listener: Listener) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function getCloudTransient(
	spacePath: string,
): CloudTransientEntry | null {
	return transientBySpace.get(spacePath) ?? null;
}

export function setCloudTransient(
	spacePath: string,
	entry: CloudTransientEntry | null,
) {
	if (entry === null) {
		if (!transientBySpace.has(spacePath)) return;
		transientBySpace.delete(spacePath);
	} else {
		transientBySpace.set(spacePath, entry);
	}
	notify();
}

/** React binding for the transient phase of one space. */
export function useCloudTransient(spacePath: string) {
	return useSyncExternalStore(
		subscribeCloudTransient,
		() => getCloudTransient(spacePath),
		() => getCloudTransient(spacePath),
	);
}
