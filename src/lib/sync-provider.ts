import { ConvexReactClient } from "convex/react";
import { useSyncExternalStore } from "react";
// ---------------------------------------------------------------------------
// SyncProvider contract — client-side choke point (plan 018, Steps 1 + 5).
//
// - This module is the ONLY place that may import `convex/_generated`.
//   Nothing else in `src/` may import it directly. When the `paperite-server`
//   repo publishes `@paperite/server-api`, swap the ONE import below to:
//     import { api } from "@paperite/server-api";
//   (see `ServerApiSlot` below) — no other file changes.
// - Backend kinds: `"convex" | "local"` (plan 018 contract). `"convex"` is
//   the Convex cloud path (Avalid default or BYO deployment). `"local"` is
//   the own-machine Yjs websocket hub (`paperite serve --sync`, Step 3 —
//   NOT implemented yet; this file only reserves the slot so callers already
//   code against kind + URL instead of assuming Convex).
// - Priority: runtime setting (localStorage) > build-time env.
//   Empty (no URL + local kind) = local-only, cloud disabled.
// - Client cache: single live client keyed by effective URL. Switching URL
//   or kind closes the old websocket before opening the new one.
// - Version pins: `convex` (1.x), `yjs` (13.x), `y-websocket` (2.x when the
//   local backend lands) must stay on the SAME majors across desktop, mobile,
//   and paperite-server. Never bump one repo alone — bump together.
// ---------------------------------------------------------------------------
// TODO(paperite-server Step 1): replace with the published contract:
//   import type { SyncProvider } from "@paperite/server-api";
// Until then this local structural slot is what clients code against.
import { api } from "../../convex/_generated/api";
import { clerk, isClerkConfigured, loadClerk } from "./clerk";

export type SyncBackendKind = "convex" | "local";

/** Settings pill: Avalid (default Paperite+ deployment) / Convex BYO / Local. */
export type SyncBackendPill = "Avalid" | "Convex BYO" | "Local";

export type SyncUrlSource = "custom" | "default" | "none";

/** Legacy alias — prefer `SyncUrlSource` in new code. */
export type ConvexUrlSource = SyncUrlSource;

const customUrlStorageKey = "paperite.convex-url";
const backendKindStorageKey = "paperite.sync-kind";

type SyncSettingsListener = () => void;

const listeners = new Set<SyncSettingsListener>();

function notifySyncSettingsChanged() {
	for (const listener of listeners) listener();
}

export function subscribeSyncSettings(listener: SyncSettingsListener) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Legacy alias — prefer `subscribeSyncSettings` in new code. */
export const subscribeConvexUrl = subscribeSyncSettings;

/** Build-time default (the Paperite+ deployment), or null when not baked in. */
export function getDefaultSyncUrl(): string | null {
	const raw = import.meta.env.VITE_CONVEX_URL?.trim();
	return raw ? raw : null;
}

/** Legacy alias — prefer `getDefaultSyncUrl` in new code. */
export const getDefaultConvexUrl = getDefaultSyncUrl;

/** User override persisted in localStorage, or null when never set. */
export function getCustomSyncUrl(): string | null {
	try {
		const raw = window.localStorage.getItem(customUrlStorageKey)?.trim();
		return raw ? raw : null;
	} catch {
		return null;
	}
}

/** Legacy alias — prefer `getCustomSyncUrl` in new code. */
export const getCustomConvexUrl = getCustomSyncUrl;

/** Explicit kind override persisted in localStorage, or null when auto. */
export function getStoredSyncKind(): SyncBackendKind | null {
	try {
		const raw = window.localStorage.getItem(backendKindStorageKey)?.trim();
		if (raw === "convex" || raw === "local") return raw;
		return null;
	} catch {
		return null;
	}
}

function kindForUrl(url: string | null): SyncBackendKind {
	if (!url) return "local";
	try {
		const protocol = new URL(url).protocol;
		if (protocol === "ws:" || protocol === "wss:") return "local";
	} catch {
		return "local";
	}
	return "convex";
}

/**
 * Effective backend kind. Explicit stored kind wins; otherwise auto:
 * ws/wss URL → local, anything else present → convex, no URL → local.
 */
export function getEffectiveSyncKind(): SyncBackendKind {
	const stored = getStoredSyncKind();
	if (stored) return stored;
	return kindForUrl(getCustomSyncUrl() ?? getDefaultSyncUrl());
}

/**
 * Effective sync URL.
 * - convex kind: custom override ?? build-time default.
 * - local kind: custom override only (a BYO `ws(s)://` / `http(s)://`
 *   hub URL), or null when unset — local-only, cloud disabled.
 */
export function getEffectiveSyncUrl(): string | null {
	if (getEffectiveSyncKind() === "local") return getCustomSyncUrl();
	return getCustomSyncUrl() ?? getDefaultSyncUrl();
}

/** Legacy alias — prefer `getEffectiveSyncUrl` in new code. */
export const getEffectiveConvexUrl = getEffectiveSyncUrl;

export function getSyncUrlSource(): SyncUrlSource {
	if (getCustomSyncUrl()) return "custom";
	if (getDefaultSyncUrl()) return "default";
	return "none";
}

/** Legacy alias — prefer `getSyncUrlSource` in new code. */
export const getConvexUrlSource = getSyncUrlSource;

/**
 * Pill for Settings → Sync: Avalid (default deployment) / Convex BYO
 * (custom https URL) / Local (local kind or no URL — cloud disabled until
 * the paperite-server local backend lands).
 */
export function getSyncBackendPill(): SyncBackendPill {
	const kind = getEffectiveSyncKind();
	const url = getEffectiveSyncUrl();
	if (kind === "local" || !url) return "Local";
	return getSyncUrlSource() === "custom" ? "Convex BYO" : "Avalid";
}

/** Convex path is usable only when kind is convex with a URL. */
export function isConvexConfigured(): boolean {
	return getEffectiveSyncKind() === "convex" && getEffectiveSyncUrl() !== null;
}

/** Any cloud path usable (convex now; local hub once Step 3 lands). */
export function isCloudEnabled(): boolean {
	return getEffectiveSyncUrl() !== null;
}

function isLoopbackHost(host: string): boolean {
	const normalized = host.toLowerCase();
	if (normalized === "localhost" || normalized === "127.0.0.1") return true;
	if (normalized === "::1" || normalized === "[::1]") return true;
	return false;
}

/**
 * Normalize + validate a sync URL. Returns the clean URL, or null when
 * invalid. `https:`/`wss:` anywhere; `http:`/`ws:` only for loopback
 * (local `convex dev` or a LAN `paperite serve --sync` hub).
 */
export function normalizeSyncUrl(raw: string): string | null {
	const trimmed = raw.trim().replace(/\/+$/, "");
	if (!trimmed) return null;

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return null;
	}

	if (parsed.protocol === "https:" || parsed.protocol === "wss:") {
		return trimmed;
	}
	if (parsed.protocol === "http:" || parsed.protocol === "ws:") {
		if (isLoopbackHost(parsed.hostname)) return trimmed;
	}
	return null;
}

/**
 * Normalize + validate a Convex deployment URL (http/https only —
 * Convex cloud never speaks ws). Use `normalizeSyncUrl` for the
 * kind-agnostic Settings field.
 */
export function normalizeConvexUrl(raw: string): string | null {
	const normalized = normalizeSyncUrl(raw);
	if (!normalized) return null;
	try {
		const protocol = new URL(normalized).protocol;
		return protocol === "http:" || protocol === "https:" ? normalized : null;
	} catch {
		return null;
	}
}

export function setSyncKind(kind: SyncBackendKind) {
	try {
		window.localStorage.setItem(backendKindStorageKey, kind);
	} catch {
		throw new Error("Could not save the sync backend on this device.");
	}

	resetCachedClient();
	notifySyncSettingsChanged();
}

export function setCustomSyncUrl(raw: string) {
	const normalized = normalizeSyncUrl(raw);
	if (!normalized) {
		throw new Error(
			"That doesn't look like a sync URL. Use https://<deployment>.convex.cloud for Convex BYO, or ws://<host>:<port> for a local hub (http/ws only works for localhost).",
		);
	}

	try {
		window.localStorage.setItem(customUrlStorageKey, normalized);
		window.localStorage.setItem(backendKindStorageKey, kindForUrl(normalized));
	} catch {
		throw new Error("Could not save the sync URL on this device.");
	}

	resetCachedClient();
	notifySyncSettingsChanged();
}

/** Legacy Convex-only setter — prefer `setCustomSyncUrl` in new code. */
export function setCustomConvexUrl(raw: string) {
	const normalized = normalizeConvexUrl(raw);
	if (!normalized) {
		throw new Error(
			"That doesn't look like a Convex URL. Use https://<deployment>.convex.cloud (http only works for localhost dev).",
		);
	}
	setCustomSyncUrl(normalized);
}

/**
 * Empty URL = local-only, cloud disabled. Clears the custom URL and pins
 * kind to local so even a baked-in default is ignored.
 */
export function disableCloudSync() {
	try {
		window.localStorage.removeItem(customUrlStorageKey);
		window.localStorage.setItem(backendKindStorageKey, "local");
	} catch {
		// Storage unavailable — still drop the cached client below.
		try {
			window.localStorage.setItem(backendKindStorageKey, "local");
		} catch {
			// Best-effort; the in-memory client is still reset below.
		}
	}

	resetCachedClient();
	notifySyncSettingsChanged();
}

export function resetSyncUrl() {
	try {
		window.localStorage.removeItem(customUrlStorageKey);
		window.localStorage.removeItem(backendKindStorageKey);
	} catch {
		// Storage unavailable — still drop the cached client below.
	}

	resetCachedClient();
	notifySyncSettingsChanged();
}

/** Legacy alias — prefer `resetSyncUrl` in new code. */
export const resetConvexUrl = resetSyncUrl;

/** React binding for the effective URL; re-renders on Settings changes. */
export function useSyncUrl(): string | null {
	return useSyncExternalStore(
		subscribeSyncSettings,
		getEffectiveSyncUrl,
		getEffectiveSyncUrl,
	);
}

/** Legacy alias — prefer `useSyncUrl` in new code. */
export const useConvexUrl = useSyncUrl;

export function useSyncUrlSource(): SyncUrlSource {
	// Subscribe to settings changes so pills re-render on save/reset.
	useSyncUrl();
	return getSyncUrlSource();
}

/** Legacy alias — prefer `useSyncUrlSource` in new code. */
export const useConvexUrlSource = useSyncUrlSource;

/** React binding for the effective backend kind. */
export function useSyncKind(): SyncBackendKind {
	useSyncUrl();
	return getEffectiveSyncKind();
}

/** React binding for the Settings pill (Avalid / Convex BYO / Local). */
export function useSyncBackendPill(): SyncBackendPill {
	useSyncUrl();
	return getSyncBackendPill();
}

// --- Local-backend slot (paperite-server Step 3, NOT implemented yet) ---
//
// When the own-machine Yjs hub lands, this is where its `y-websocket`
// provider attaches (server URL + kind flag already flow through the
// getters above; auth rides an Authorization header / better-auth session
// instead of the Convex JWT template). Callers must keep gating on
// `getEffectiveSyncKind()` — never assume kind convex.

export type LocalSyncSlot = {
	kind: "local";
	url: string | null;
	note: "local Yjs hub not implemented yet — see plan 018 Step 3";
};

/** Describe the local slot without opening any socket (no `y-websocket` yet). */
export function getLocalSyncSlot(): LocalSyncSlot {
	return {
		kind: "local",
		url: getCustomSyncUrl(),
		note: "local Yjs hub not implemented yet — see plan 018 Step 3",
	};
}

// --- Convex wire client (kind === "convex" only) ---

let cachedUrl: string | null = null;
let cachedKind: SyncBackendKind | null = null;
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
	cachedKind = null;
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

/** Live Convex client for the effective URL, or null when not on convex. */
export function getConvexClient(): ConvexReactClient | null {
	if (getEffectiveSyncKind() !== "convex") return null;
	const url = getEffectiveSyncUrl();
	if (!url) return null;

	if (!cachedClient || cachedUrl !== url || cachedKind !== "convex") {
		resetCachedClient();
		cachedClient = new ConvexReactClient(url);
		cachedUrl = url;
		cachedKind = "convex";
		attachClerkAuth(cachedClient);
	}
	return cachedClient;
}

/** Kind-aware client accessor. Local kind has no client yet (Step 3). */
export function getSyncClient(): ConvexReactClient | null {
	if (getEffectiveSyncKind() === "local") return null;
	return getConvexClient();
}

export async function createSharedSpace(name: string) {
	const client = getConvexClient();
	if (!client) {
		throw new Error(
			getEffectiveSyncKind() === "local"
				? "Local sync hub is not implemented yet (plan 018 Step 3). Reconnect Convex in Settings → Sync to share spaces."
				: "Convex is not configured. Set the URL in Settings → Sync.",
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
		message.includes("local hub") ||
		message.includes("Local sync hub") ||
		message.includes("not implemented")
	) {
		return "Local sync hub isn't ready yet — reconnect Convex in Settings → Sync.";
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
			getEffectiveSyncKind() === "local"
				? "Local sync hub is not implemented yet (plan 018 Step 3)."
				: "Convex is not configured. Set the URL in Settings → Sync.",
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
