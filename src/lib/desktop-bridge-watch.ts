import {
	getBridgeSession,
	isBrowserRenderer,
	type PaperiteAuthUser,
} from "@/lib/auth-bridge";

/**
 * One shared poll of the desktop bridge.
 *
 * A browser surface can only mirror the desktop's session, so the desktop
 * being closed is a real loss of capability — not a cosmetic blip. This
 * module keeps a single poller running and publishes the latest answer so
 * every consumer (the sidebar, the sync settings, the blocking dialog)
 * reacts to the same state instead of each polling on its own.
 */

export type DesktopBridgeSnapshot = {
	/** A desktop app is reachable right now. */
	attached: boolean;
	/** The desktop (or the server's cached view of it) has a session. */
	signedIn: boolean;
	user: PaperiteAuthUser | null;
	/**
	 * The desktop was signed in and has since gone away. The session is
	 * still intact on the desktop — we just cannot reach it.
	 */
	desktopOffline: boolean;
	/**
	 * Shorthand for "the desktop had a session but is gone", as opposed to
	 * "there was never a desktop".
	 */
	offline: boolean;
	/** False until the first poll has completed. */
	ready: boolean;
};

const EMPTY: DesktopBridgeSnapshot = {
	attached: false,
	signedIn: false,
	user: null,
	desktopOffline: false,
	offline: false,
	ready: false,
};

let snapshot: DesktopBridgeSnapshot = EMPTY;
const listeners = new Set<() => void>();
let timer: number | null = null;
let inFlight = false;

const notify = () => {
	for (const listener of listeners) listener();
};

const poll = async (): Promise<DesktopBridgeSnapshot> => {
	if (inFlight) return snapshot;
	if (!isBrowserRenderer()) return snapshot;
	inFlight = true;
	try {
		const bridge = await getBridgeSession();
		if (bridge) {
			snapshot = {
				attached: bridge.attached,
				signedIn: bridge.signedIn,
				user: bridge.user,
				desktopOffline: bridge.desktopOffline === true,
				offline: bridge.desktopOffline === true,
				ready: true,
			};
			notify();
		}
	} catch {
		// Keep the last known snapshot — a failed poll is not a state change.
	} finally {
		inFlight = false;
	}
	return snapshot;
};

/** The latest known desktop bridge state. */
export const getDesktopBridgeSnapshot = (): DesktopBridgeSnapshot => snapshot;

/**
 * True when a browser surface has nothing at all to show: no desktop
 * attached and no session to mirror. The workspace must not load behind the
 * blocking dialog in that state — an empty page that says "open the desktop"
 * is honest, while a half-built shell with no account is not.
 *
 * A browser that still has a session (the desktop was closed but the server
 * remembers it) keeps rendering the app behind the dialog, so the notes
 * stay reachable.
 */
export const shouldBlankBrowser = (state: DesktopBridgeSnapshot): boolean =>
	state.ready && !state.attached && !state.signedIn;

/**
 * Subscribe to desktop bridge changes. Starts the shared poller and stops it
 * again once nobody is listening.
 */
export const subscribeDesktopBridge = (listener: () => void): (() => void) => {
	listeners.add(listener);
	if (timer === null && isBrowserRenderer()) {
		void poll();
		timer = window.setInterval(() => void poll(), 2000);
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0 && timer !== null) {
			window.clearInterval(timer);
			timer = null;
		}
	};
};

/** Resolve once the first poll has completed. */
export const ensureDesktopBridgeReady =
	async (): Promise<DesktopBridgeSnapshot> => {
		if (snapshot.ready) return snapshot;
		return poll();
	};

/** Force an immediate refresh. */
export const refreshDesktopBridge = (): Promise<DesktopBridgeSnapshot> =>
	poll();
