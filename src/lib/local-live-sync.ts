import * as Y from "yjs";
import { getNotesEngine } from "@/lib/notes-engine";

/**
 * Local realtime watch: every open Y.Doc converges toward the shared
 * snapshot without reload — electron, `paperite serve`, and popout all see
 * each other's edits (and direct file writes, e.g. AI agents) live.
 *
 * Transport: the serve websocket (`workspace:changed`) on web, the existing
 * `workspace:changed` IPC on electron, plus focus/visible refresh and a slow
 * safety interval. Payloads are incremental diffs against our own state
 * vector, applied under `localRemoteOrigin` so they never echo back to the
 * server nor re-enter the cloud push queue (the writer already enqueued
 * them from its own outbox).
 */

export const localRemoteOrigin = "paperite:local-remote";

const refreshDebounceMs = 250;
const safetyIntervalMs = 15000;

type LiveSub = {
	doc: Y.Doc;
	notePath: string;
	timer?: ReturnType<typeof setTimeout>;
	inFlight: boolean;
	queued: boolean;
};

const liveSubs = new Map<string, LiveSub>();

export function attachLocalLiveNote(notePath: string, doc: Y.Doc): void {
	const existing = liveSubs.get(notePath);
	if (existing?.timer) clearTimeout(existing.timer);
	liveSubs.set(notePath, { doc, notePath, inFlight: false, queued: false });
	ensureLiveTransport();
}

export function detachLocalLiveNote(notePath: string, doc: Y.Doc): void {
	const sub = liveSubs.get(notePath);
	if (!sub || sub.doc !== doc) return;
	if (sub.timer) clearTimeout(sub.timer);
	liveSubs.delete(notePath);
}

function isConflictError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? "");
	return /409|conflict|state vector|note not found/i.test(message);
}

function isLockedError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? "");
	return /locked|busy/i.test(message);
}

function toUint8Array(value: Uint8Array): Uint8Array {
	return value instanceof Uint8Array ? value : new Uint8Array(value);
}

export function scheduleLiveRefresh(notePath: string): void {
	const sub = liveSubs.get(notePath);
	if (!sub) return;
	if (sub.timer) clearTimeout(sub.timer);
	sub.timer = setTimeout(() => {
		sub.timer = undefined;
		void refreshLiveNote(notePath);
	}, refreshDebounceMs);
}

export function refreshAllLiveNotes(): void {
	for (const notePath of liveSubs.keys()) scheduleLiveRefresh(notePath);
}

export async function refreshLiveNote(notePath: string): Promise<void> {
	const sub = liveSubs.get(notePath);
	if (!sub) return;
	if (sub.inFlight) {
		sub.queued = true;
		return;
	}
	const engine = getNotesEngine();
	if (!engine) return;
	sub.inFlight = true;
	try {
		const stateVector = Y.encodeStateVector(sub.doc);
		const { diff } = await engine.readYDiff(notePath, stateVector);
		if (diff.length > 0) {
			Y.applyUpdate(sub.doc, toUint8Array(diff), localRemoteOrigin);
		}
	} catch (error) {
		if (isConflictError(error)) {
			// Stale vector or rotated lineage: fall back to a full snapshot
			// apply (idempotent merge, converges by construction).
			try {
				const state = await engine.readYNote(notePath);
				Y.applyUpdate(sub.doc, toUint8Array(state.snapshot), localRemoteOrigin);
			} catch {
				// Best effort — the next trigger retries.
			}
		} else if (isLockedError(error)) {
			sub.inFlight = false;
			sub.timer = setTimeout(() => {
				sub.timer = undefined;
				void refreshLiveNote(notePath);
			}, 2000);
			return;
		}
		// Offline / gone: stay quiet, the next trigger retries.
	} finally {
		sub.inFlight = false;
	}
	if (sub.queued) {
		sub.queued = false;
		void refreshLiveNote(notePath);
	}
}

let transportStarted = false;
let reconnectDelayMs = 1000;
let socket: WebSocket | null = null;

function liveSocketUrl(): string | null {
	try {
		const configured: string | undefined =
			(import.meta.env.PAPERITE_API_URL as string | undefined) ?? undefined;
		const http = configured || window.location.origin;
		return `${http.replace(/^http/, "ws")}/paperite-live`;
	} catch {
		return null;
	}
}

function scheduleReconnect(): void {
	const delay = reconnectDelayMs;
	reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000);
	window.setTimeout(() => {
		if (typeof window === "undefined" || window.electron) return;
		openLiveSocket();
	}, delay);
}

function openLiveSocket(): void {
	const url = liveSocketUrl();
	if (!url) return;
	let sock: WebSocket;
	try {
		sock = new WebSocket(url);
	} catch {
		scheduleReconnect();
		return;
	}
	socket = sock;
	sock.onopen = () => {
		reconnectDelayMs = 1000;
		refreshAllLiveNotes();
	};
	sock.onmessage = (event) => {
		try {
			const message = JSON.parse(String(event.data));
			if (message?.event === "workspace:changed") refreshAllLiveNotes();
		} catch {
			// Non-JSON frames are not ours.
		}
	};
	const down = () => {
		if (socket === sock) socket = null;
		scheduleReconnect();
	};
	sock.onclose = down;
	sock.onerror = down;
}

function ensureLiveTransport(): void {
	if (transportStarted || typeof window === "undefined") return;
	transportStarted = true;

	if (window.electron?.onWorkspaceChanged) {
		// Electron main already watches the workspace and pushes this IPC
		// (debounced) on any file change, including our own — the diff
		// against our state vector makes self-events a cheap no-op.
		window.electron.onWorkspaceChanged(() => refreshAllLiveNotes());
	} else {
		openLiveSocket();
	}

	window.addEventListener("focus", () => refreshAllLiveNotes());
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") refreshAllLiveNotes();
	});
	window.setInterval(() => {
		if (liveSubs.size > 0) refreshAllLiveNotes();
	}, safetyIntervalMs);
}
