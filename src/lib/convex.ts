import { ConvexReactClient } from "convex/react";
import { useSyncExternalStore } from "react";
// Single choke point for generated API types (plan 018, Step 3).
// `convex/` still lives in this repo until the paperite-server cutover
// (Step 7); when `@paperite/server-api` is published this is the ONE import
// to swap — nothing else may import `convex/_generated` directly.
import { api } from "../../convex/_generated/api";
import { clerk, isClerkConfigured, loadClerk } from "./clerk";

const customUrlStorageKey = "paperite.convex-url";

export type ConvexUrlSource = "custom" | "default" | "none";

type ConvexUrlListener = () => void;

const listeners = new Set<ConvexUrlListener>();

function notifyConvexUrlChanged() {
	for (const listener of listeners) listener();
}

export function subscribeConvexUrl(listener: ConvexUrlListener) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Build-time default (the Paperite+ deployment), or null when not baked in. */
export function getDefaultConvexUrl(): string | null {
	const raw = import.meta.env.VITE_CONVEX_URL?.trim();
	return raw ? raw : null;
}

/** User override persisted in localStorage, or null when never set. */
export function getCustomConvexUrl(): string | null {
	try {
		const raw = window.localStorage.getItem(customUrlStorageKey)?.trim();
		return raw ? raw : null;
	} catch {
		return null;
	}
}

/** Priority: runtime setting (localStorage) > build-time env. */
export function getEffectiveConvexUrl(): string | null {
	return getCustomConvexUrl() ?? getDefaultConvexUrl();
}

export function getConvexUrlSource(): ConvexUrlSource {
	if (getCustomConvexUrl()) return "custom";
	if (getDefaultConvexUrl()) return "default";
	return "none";
}

export function isConvexConfigured(): boolean {
	return getEffectiveConvexUrl() !== null;
}

/**
 * Normalize + validate a Convex deployment URL.
 * Returns the clean URL, or null when invalid.
 * Accepts https anywhere; http only for loopback (local `convex dev`).
 */
export function normalizeConvexUrl(raw: string): string | null {
	const trimmed = raw.trim().replace(/\/+$/, "");
	if (!trimmed) return null;

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return null;
	}

	if (parsed.protocol === "https:") return trimmed;
	if (parsed.protocol === "http:") {
		const host = parsed.hostname.toLowerCase();
		if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
			return trimmed;
		}
	}
	return null;
}

export function setCustomConvexUrl(raw: string) {
	const normalized = normalizeConvexUrl(raw);
	if (!normalized) {
		throw new Error(
			"That doesn't look like a Convex URL. Use https://<deployment>.convex.cloud (http only works for localhost dev).",
		);
	}

	try {
		window.localStorage.setItem(customUrlStorageKey, normalized);
	} catch {
		throw new Error("Could not save the Convex URL on this device.");
	}

	resetCachedClient();
	notifyConvexUrlChanged();
}

export function resetConvexUrl() {
	try {
		window.localStorage.removeItem(customUrlStorageKey);
	} catch {
		// Storage unavailable — still drop the cached client below.
	}

	resetCachedClient();
	notifyConvexUrlChanged();
}

/** React binding for the effective URL; re-renders on Settings changes. */
export function useConvexUrl(): string | null {
	return useSyncExternalStore(
		subscribeConvexUrl,
		getEffectiveConvexUrl,
		getEffectiveConvexUrl,
	);
}

export function useConvexUrlSource(): ConvexUrlSource {
	// Subscribe to URL changes so pills re-render on save/reset.
	useConvexUrl();
	return getConvexUrlSource();
}

let cachedUrl: string | null = null;
let cachedClient: ConvexReactClient | null = null;

function resetCachedClient() {
	detachClerkListener?.();
	detachClerkListener = null;
	if (cachedClient) {
		try {
			void cachedClient.close();
		} catch {
			// Closing a half-opened websocket must never break a URL switch.
		}
	}
	cachedClient = null;
	cachedUrl = null;
}

/**
 * Attach the Clerk session token so Convex functions see an authenticated
 * identity (`ctx.auth.getUserIdentity()`). The Clerk dashboard needs a JWT
 * template named `convex` (see paperite-server README); without it the
 * fetch returns null and mutations fail loudly with not_authenticated
 * instead of silently acting as a stranger.
 */
async function fetchConvexToken({
	forceRefreshToken,
}: {
	forceRefreshToken: boolean;
}): Promise<string | null> {
	try {
		await loadClerk();
		const session = clerk.session;
		if (!session) return null;
		return await session.getToken({
			template: "convex",
			skipCache: forceRefreshToken,
		});
	} catch {
		// Signed out, template missing, or network down — Convex treats
		// null as unauthenticated and throws not_authenticated per call.
		return null;
	}
}

let detachClerkListener: (() => void) | null = null;

function attachClerkAuth(client: ConvexReactClient) {
	if (!isClerkConfigured()) return;

	client.setAuth(fetchConvexToken);

	// Re-fetch the token when the session changes (sign in/out, refresh).
	try {
		detachClerkListener?.();
		detachClerkListener = clerk.addListener(() => {
			try {
				client.setAuth(fetchConvexToken);
			} catch {
				// Auth refresh is best-effort; the next call re-fetches anyway.
			}
		});
	} catch {
		// Older clerk-js without addListener — token still refreshes per call.
	}
}

export function getConvexClient(): ConvexReactClient | null {
	const url = getEffectiveConvexUrl();
	if (!url) return null;

	if (!cachedClient || cachedUrl !== url) {
		resetCachedClient();
		cachedClient = new ConvexReactClient(url);
		cachedUrl = url;
		attachClerkAuth(cachedClient);
	}
	return cachedClient;
}

export async function createSharedSpace(name: string) {
	const client = getConvexClient();
	if (!client) {
		throw new Error(
			"Convex is not configured. Set the URL in Settings → Sync.",
		);
	}

	return client.mutation(api.sharedSpaces.create, { name });
}

export type SharedSpaceListEntry = {
	membership: {
		_id: string;
		spaceId: string;
		userId: string;
		role: "owner" | "editor" | "viewer";
		createdAt: number;
	};
	space: {
		_id: string;
		name: string;
		ownerUserId: string;
		createdAt: number;
		updatedAt: number;
	} | null;
};

/**
 * Plan 020 Step 6: same-account join picker. Lists the spaces this account
 * already owns/can access so device B can attach to an existing `spaceId`
 * (no invite UI — that's 016 territory).
 */
export async function listSharedSpaces(): Promise<SharedSpaceListEntry[]> {
	const client = requireConvexClient();
	return client.query(api.sharedSpaces.list, {});
}

/** Human message for known Convex share errors (plan 019: free-tier limit). */
export function humanizeShareError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes("shared_space_limit_reached")) {
		return "Free plan allows 2 cloud spaces. Remove one before saving another.";
	}
	if (message.includes("not_authenticated")) {
		return "Sign in first — cloud save needs your Paperite account.";
	}
	if (message.includes("not_space_member")) {
		return "You no longer have access to this cloud space.";
	}
	if (
		message.includes("Failed to fetch") ||
		message.includes("NetworkError") ||
		message.includes("network") ||
		message.includes("offline") ||
		message.includes("Failed to connect") ||
		message.includes("CONVEX_URL") ||
		message.includes("not configured")
	) {
		return "You're offline — edits are queued and will send when you reconnect.";
	}
	return message || "Cloud save failed.";
}

function requireConvexClient() {
	const client = getConvexClient();
	if (!client) {
		throw new Error(
			"Convex is not configured. Set the URL in Settings → Sync.",
		);
	}
	return client;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.length);
	copy.set(bytes);
	return copy.buffer as ArrayBuffer;
}

function fromBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
	return value instanceof Uint8Array
		? value
		: new Uint8Array(value as ArrayBuffer);
}

export async function upsertSharedNote(args: {
	spaceId: string;
	noteId: string;
	path: string;
	title: string;
}) {
	const client = requireConvexClient();
	return client.mutation(api.sharedSpaces.upsertNote, {
		spaceId: args.spaceId as never,
		noteId: args.noteId,
		path: args.path,
		title: args.title,
	});
}

export async function appendSharedUpdate(args: {
	spaceId: string;
	noteId: string;
	updateId: string;
	deviceId: string;
	data: Uint8Array;
}) {
	const client = requireConvexClient();
	return client.mutation(api.sharedSpaces.appendUpdate, {
		spaceId: args.spaceId as never,
		noteId: args.noteId,
		updateId: args.updateId,
		deviceId: args.deviceId,
		data: toArrayBuffer(args.data),
	});
}

export async function writeSharedSnapshot(args: {
	spaceId: string;
	noteId: string;
	data: Uint8Array;
	stateVector: Uint8Array;
}) {
	const client = requireConvexClient();
	return client.mutation(api.sharedSpaces.writeSnapshot, {
		spaceId: args.spaceId as never,
		noteId: args.noteId,
		data: toArrayBuffer(args.data),
		stateVector: toArrayBuffer(args.stateVector),
	});
}

export type SharedNoteRow = {
	_id: string;
	spaceId: string;
	noteId: string;
	path: string;
	title: string;
};

export type SharedUpdateRow = {
	_id: string;
	spaceId: string;
	noteId: string;
	updateId: string;
	deviceId: string;
	data: Uint8Array | ArrayBuffer;
	createdAt: number;
};

export async function listSharedNotes(
	spaceId: string,
): Promise<SharedNoteRow[]> {
	const client = requireConvexClient();
	return client.query(api.sharedSpaces.listNotes, {
		spaceId: spaceId as never,
	});
}

export async function removeSharedNote(args: {
	spaceId: string;
	noteId: string;
}) {
	const client = requireConvexClient();
	return client.mutation(api.sharedSpaces.removeNote, {
		spaceId: args.spaceId as never,
		noteId: args.noteId,
	});
}

/**
 * Plan 020 Step 3: live subscriptions. The plan shorthand says
 * `client.onUpdate` — the installed convex@1.41 client exposes it as
 * `client.watchQuery(query, args).onUpdate(cb)` (verified in
 * `node_modules/convex/dist/cjs/react/client.js`); reads come from
 * `watch.localQueryResult()`. If a future convex major removes `watchQuery`,
 * STOP per plan — do not silently fall back to polling.
 */
export function watchSharedNotes(
	spaceId: string,
	callback: (rows: SharedNoteRow[]) => void,
): () => void {
	const client = requireConvexClient();
	const watch = client.watchQuery(api.sharedSpaces.listNotes, {
		spaceId: spaceId as never,
	});
	const unsubscribe = watch.onUpdate(() => {
		const result = watch.localQueryResult();
		if (result !== undefined) callback(result as SharedNoteRow[]);
	});
	return () => {
		try {
			unsubscribe();
		} catch {
			// Unsubscribing a closed client must never throw into teardown.
		}
	};
}

export function watchSharedUpdates(
	spaceId: string,
	noteId: string,
	callback: (
		rows: Array<Omit<SharedUpdateRow, "data"> & { data: Uint8Array }>,
	) => void,
): () => void {
	const client = requireConvexClient();
	const watch = client.watchQuery(api.sharedSpaces.listUpdates, {
		spaceId: spaceId as never,
		noteId,
	});
	const unsubscribe = watch.onUpdate(() => {
		const result = watch.localQueryResult();
		if (result === undefined) return;
		const rows = result as SharedUpdateRow[];
		callback(rows.map((row) => ({ ...row, data: fromBytes(row.data) })));
	});
	return () => {
		try {
			unsubscribe();
		} catch {
			// Unsubscribing a closed client must never throw into teardown.
		}
	};
}

export async function listSharedUpdates(
	spaceId: string,
	noteId: string,
): Promise<Array<Omit<SharedUpdateRow, "data"> & { data: Uint8Array }>> {
	const client = requireConvexClient();
	const rows = (await client.query(api.sharedSpaces.listUpdates, {
		spaceId: spaceId as never,
		noteId,
	})) as SharedUpdateRow[];
	return rows.map((row) => ({ ...row, data: fromBytes(row.data) }));
}
