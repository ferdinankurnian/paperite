import { getBridgeSession, isBrowserRenderer } from "@/lib/auth-bridge";
import {
	clerk,
	handleClerkRedirect,
	isClerkConfigured,
	loadClerk,
} from "@/lib/clerk";

/**
 * Resolve the OAuth redirect URL to give Clerk.
 *
 * Per-mode, never env-shadowed:
 * - Electron (`window.electron` present): spin up the throwaway loopback
 *   server in the main process and use its URL. The callback is forwarded
 *   into the renderer over IPC — no OS deep-link handler involved.
 *   (`paperite://auth/callback?...` is still used internally as the IPC
 *   payload shape, but it is NEVER handed to Clerk: Clerk's API rejects
 *   non-http(s) schemes with `invalid_url_scheme`.)
 * - Web / `paperite serve`: the redirect must land back in this window
 *   itself — `window.location.origin + pathname`. Works on any custom
 *   port, but that exact serve origin must be allowlisted in the Clerk
 *   dashboard (see docs/sync.md), otherwise the redirect is rejected.
 */
export async function resolveAuthCallbackUrl(): Promise<string> {
	const electronAuth = window.electron?.auth;

	if (electronAuth?.startCallbackServer) {
		try {
			return await electronAuth.startCallbackServer();
		} catch {
			// Fall through to the page-based fallback below.
		}
	}

	return `${window.location.origin}${window.location.pathname}`;
}

/**
 * "Continue with Google" must work for both new and returning users.
 * Starting from the sign-UP attempt is the robust direction:
 * - new users complete the sign-up directly (no transfer needed);
 * - returning users are transferred sign-up -> sign-in automatically
 *   inside `handleRedirectCallback` (external_account_exists branch).
 * Starting from sign-IN instead fails first-timers with
 * `external_account_not_found` (see Clerk Logs: oauth_callback.failed).
 */
export async function continueWithGoogle() {
	if (isBrowserRenderer()) {
		throw new Error(
			"Sign in from the Paperite desktop app — the browser follows that session.",
		);
	}

	await loadClerk();
	const signUp = clerk.client?.signUp;
	if (!signUp) throw new Error("Clerk sign-up is unavailable.");

	const redirectUrl = await resolveAuthCallbackUrl();
	await signUp.authenticateWithRedirect({
		strategy: "oauth_google",
		redirectUrl,
		redirectUrlComplete: redirectUrl,
	});
}

export { handleClerkRedirect };

/**
 * Cloud gate (plan 016 revised 2026-10-15): local notes always work, but
 * Paperite+ / BYO require a Clerk session. Clicking one while
 * signed out must NOT fail silently into guest mode — it stores the
 * intent, opens the sign-in dialog, and the caller resumes the flow
 * after `paperite:auth-success` via `takePendingCloudIntent()`.
 */
export type PendingCloudAction = "paperite-join" | "byo-save";

export type PendingCloudIntent = {
	action: PendingCloudAction;
	/** BYO Convex URL draft, or the Paperite+ shared-space name. */
	payload?: string;
};

const pendingCloudIntentKey = "paperite:pending-cloud-action";

export function setPendingCloudIntent(intent: PendingCloudIntent) {
	try {
		window.localStorage.setItem(pendingCloudIntentKey, JSON.stringify(intent));
	} catch {
		// Storage unavailable — the sign-in still proceeds, the user just
		// re-clicks the cloud button afterwards.
	}
}

export function takePendingCloudIntent(): PendingCloudIntent | null {
	try {
		const raw = window.localStorage.getItem(pendingCloudIntentKey);
		window.localStorage.removeItem(pendingCloudIntentKey);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as PendingCloudIntent;
		if (parsed?.action === "paperite-join" || parsed?.action === "byo-save") {
			return parsed;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Returns true when a Clerk session is present. Otherwise stashes the
 * intent, dispatches `paperite:open-auth`, and returns false — the
 * caller must show a "sign in first" message, not proceed as guest.
 * Returns false (without opening auth) when Clerk isn't configured at
 * all: that's local-only mode, cloud stays disabled with a clear message.
 */
export async function ensureSignedInForCloud(
	intent: PendingCloudIntent,
): Promise<boolean> {
	if (!isClerkConfigured()) return false;

	if (isBrowserRenderer()) {
		const bridge = await getBridgeSession();
		if (bridge?.signedIn) return true;
		setPendingCloudIntent(intent);
		window.dispatchEvent(new Event("paperite:open-auth"));
		return false;
	}

	try {
		await loadClerk();
	} catch {
		return false;
	}

	if (clerk.session && clerk.user) return true;

	setPendingCloudIntent(intent);
	window.dispatchEvent(new Event("paperite:open-auth"));
	return false;
}
