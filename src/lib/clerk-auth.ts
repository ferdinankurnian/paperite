import { clerk, handleClerkRedirect, loadClerk } from "@/lib/clerk";

const envCallbackUrl = import.meta.env.VITE_CLERK_AUTH_CALLBACK_URL;

/**
 * Resolve the OAuth redirect URL to give Clerk.
 *
 * Clerk's API rejects non-http(s) schemes ("invalid_url_scheme"), so
 * `paperite://` can never be used here directly. In Electron we spin up
 * a throwaway loopback server in the main process and use its URL —
 * the callback is forwarded into the renderer over IPC, no OS deep-link
 * handler involved. (The `paperite://auth/callback?...` shape is still
 * used internally as the IPC payload format.)
 */
export async function resolveAuthCallbackUrl(): Promise<string> {
	const electronAuth = window.electron?.auth;

	if (electronAuth?.startCallbackServer) {
		// Electron deep-link flow: env first, then throwaway loopback server.
		if (envCallbackUrl) return envCallbackUrl;

		try {
			return await electronAuth.startCallbackServer();
		} catch {
			// Fall through to the page-based fallbacks below.
		}
	} else if (envCallbackUrl && /^https?:\/\//.test(envCallbackUrl)) {
		// Web/serve mode: only http(s) callbacks ever reach Clerk — it
		// rejects custom schemes (paperite://) with invalid_url_scheme.
		return envCallbackUrl;
	}

	// auth-callback.html deep-links paperite://, so it's Electron-only.
	// In web/serve the redirect must land back in this window itself.
	if (import.meta.env.DEV && electronAuth?.startCallbackServer)
		return "http://localhost:5173/auth-callback.html";
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
