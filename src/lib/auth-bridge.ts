import type {
	PaperiteSessionList,
	PaperiteSessionSummary,
} from "@/lib/auth-sessions";

export type PaperiteAuthUser = {
	id: string;
	fullName: string | null;
	username: string | null;
	imageUrl: string;
	email: string;
	unsafeMetadata?: Record<string, unknown>;
};

export type PaperiteBridgeSession = {
	/** True when a Paperite desktop app is attached to this serve instance. */
	attached: boolean;
	signedIn: boolean;
	user: PaperiteAuthUser | null;
	token?: string | null;
	/**
	 * True when the identity came from the server's cache because the
	 * desktop app is not running. The account is still signed in on the
	 * desktop — we just cannot reach it for a fresh token right now.
	 */
	desktopOffline?: boolean;
};

/** True for the browser build served by `paperite serve`. */
export function isPaperiteWeb(): boolean {
	return Boolean(import.meta.env.PAPERITE_WEB);
}

/**
 * True when this renderer runs inside the Paperite desktop app.
 *
 * The desktop app is the single auth authority for an installation: only it
 * may hold a Clerk session. A plain browser opened against `paperite serve`
 * is a *mirror* of that session and must never create one of its own —
 * otherwise the same installation could end up with two sessions on two
 * accounts.
 *
 * Note this is deliberately NOT the same as `isPaperiteWeb()`: when serve
 * owns the workspace, the desktop app attaches to it and loads the very same
 * web bundle over http://localhost. The only reliable signal that we are the
 * desktop is the Electron preload bridge.
 */
export function isDesktopRenderer(): boolean {
	return Boolean(window.electron);
}

/**
 * True for a plain browser attached to `paperite serve` — a surface that can
 * only mirror the desktop's session, never own one.
 */
export function isBrowserRenderer(): boolean {
	return isPaperiteWeb() && !isDesktopRenderer();
}

/**
 * The last identity the desktop published. The desktop's `unsafeMetadata`
 * carries the shared device names, so a browser can read them without
 * holding a Clerk session of its own.
 */
let lastBridgeUser: PaperiteAuthUser | null = null;

/** The desktop identity last seen over the bridge, or null. */
export function getBridgeUser(): PaperiteAuthUser | null {
	return lastBridgeUser;
}

/**
 * Read the desktop owner's Clerk identity through the serve bridge.
 *
 * Returns null when this surface is not a browser mirror (the desktop reads
 * its own Clerk session directly). Otherwise the result always describes the
 * attached desktop: `attached` tells whether a desktop is connected at all,
 * `signedIn` whether that desktop currently holds a session.
 */
export async function getBridgeSession(
	includeToken = false,
): Promise<PaperiteBridgeSession | null> {
	if (!isBrowserRenderer()) return null;

	try {
		const response = await fetch(
			`/api/auth/session${includeToken ? "?token=1" : ""}`,
			{ cache: "no-store" },
		);
		if (!response.ok) {
			return { attached: false, signedIn: false, user: null };
		}
		const result = (await response.json()) as Partial<PaperiteBridgeSession>;
		const user = result.user ?? null;
		if (user) lastBridgeUser = user;
		return {
			attached: result.attached === true,
			signedIn: result.signedIn === true,
			user,
			token: result.token ?? null,
			desktopOffline: result.desktopOffline === true,
		};
	} catch {
		return { attached: false, signedIn: false, user: null };
	}
}

/**
 * Sign out through the desktop owner so the device binding and the Clerk
 * session are cleared in one place. A browser mirror can only ask the
 * desktop to do it.
 */
export async function signOutBridge(): Promise<boolean> {
	if (!isBrowserRenderer()) return false;
	try {
		const response = await fetch("/api/auth/sign-out", {
			method: "POST",
			headers: { "content-type": "application/json" },
		});
		return response.ok;
	} catch {
		return false;
	}
}

/**
 * List the account's active sessions. The browser cannot call Clerk's
 * session API itself, so the desktop does it and ships the list over.
 */
export async function getBridgeSessions(): Promise<PaperiteSessionList | null> {
	if (!isBrowserRenderer()) return null;
	try {
		const response = await fetch("/api/auth/sessions", { cache: "no-store" });
		if (!response.ok) return null;
		return (await response.json()) as PaperiteSessionList;
	} catch {
		return null;
	}
}

/** Revoke one session through the desktop. */
export async function revokeBridgeSession(sessionId: string): Promise<boolean> {
	if (!isBrowserRenderer()) return false;
	try {
		const response = await fetch("/api/auth/sessions/revoke", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ sessionId }),
		});
		return response.ok;
	} catch {
		return false;
	}
}

/** Revoke every session except the desktop's own, through the desktop. */
export async function revokeOtherBridgeSessions(): Promise<boolean> {
	if (!isBrowserRenderer()) return false;
	try {
		const response = await fetch("/api/auth/sessions/revoke-others", {
			method: "POST",
			headers: { "content-type": "application/json" },
		});
		return response.ok;
	} catch {
		return false;
	}
}

/**
 * Write shared user metadata (device names) through the desktop. The browser
 * holds no Clerk session, so it cannot call `updateMetadata` itself.
 */
export async function updateBridgeMetadata(
	metadata: Record<string, unknown>,
): Promise<boolean> {
	if (!isBrowserRenderer()) return false;
	try {
		const response = await fetch("/api/auth/metadata", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ metadata }),
		});
		return response.ok;
	} catch {
		return false;
	}
}

export type { PaperiteSessionList, PaperiteSessionSummary };
