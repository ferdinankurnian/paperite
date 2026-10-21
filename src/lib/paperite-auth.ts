import { isBrowserRenderer } from "./auth-bridge";
import { clerk, isClerkConfigured, loadClerk } from "./clerk";
import { ensureDesktopBridgeReady } from "./desktop-bridge-watch";

export type PaperiteSession = {
	source: "desktop-bridge" | "clerk" | "none";
	signedIn: boolean;
	user: {
		id: string;
		fullName: string | null;
		username: string | null;
		imageUrl: string;
		email: string;
		unsafeMetadata?: Record<string, unknown>;
	} | null;
	sessionId: string | null;
	/**
	 * True when a desktop app is reachable but has no session yet. The
	 * browser can only ever mirror the desktop, so this is the "go sign in
	 * on the desktop" state — not an error.
	 */
	awaitingDesktop: boolean;
	/**
	 * True when the desktop is not running, but the server still remembers
	 * the account. The session is intact on the desktop; we just cannot
	 * reach it for a fresh token.
	 */
	desktopOffline: boolean;
};

/**
 * Resolve the auth surface for this UI.
 *
 * A browser attached to `paperite serve` mirrors the desktop owner's
 * identity and never holds a Clerk session of its own — one installation,
 * one account, one session. The desktop surfaces (Electron app, and the
 * Electron window attached to a serve instance) own their Clerk session
 * directly.
 */
export async function getPaperiteSession(): Promise<PaperiteSession> {
	if (isBrowserRenderer()) {
		// Read the shared bridge snapshot rather than fetching again — one
		// poller serves the whole app.
		const bridge = await ensureDesktopBridgeReady();
		return {
			source: "desktop-bridge",
			signedIn: bridge.signedIn,
			user: bridge.user,
			sessionId: null,
			awaitingDesktop: !bridge.attached && !bridge.signedIn,
			desktopOffline: bridge.desktopOffline,
		};
	}

	if (!isClerkConfigured()) {
		return {
			source: "none",
			signedIn: false,
			user: null,
			sessionId: null,
			awaitingDesktop: false,
			desktopOffline: false,
		};
	}

	try {
		await loadClerk();
		const user = clerk.user;
		return {
			source: "clerk",
			signedIn: Boolean(user && clerk.session),
			user: user
				? {
						id: user.id,
						fullName: user.fullName,
						username: user.username,
						imageUrl: user.imageUrl,
						email:
							user.primaryEmailAddress?.emailAddress ??
							user.emailAddresses[0]?.emailAddress ??
							"",
						unsafeMetadata: user.unsafeMetadata,
					}
				: null,
			sessionId: clerk.session?.id ?? null,
			awaitingDesktop: false,
			desktopOffline: false,
		};
	} catch {
		return {
			source: "clerk",
			signedIn: false,
			user: null,
			sessionId: null,
			awaitingDesktop: false,
			desktopOffline: false,
		};
	}
}
