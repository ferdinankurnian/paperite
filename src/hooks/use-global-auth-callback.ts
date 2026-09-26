import { useEffect } from "react";
import {
	clerk,
	handleClerkRedirect,
	isClerkConfigured,
	loadClerk,
} from "@/lib/clerk";
import { completeOnboarding } from "@/lib/onboarding";

const processedUrls = new Set<string>();

export async function completeAuthCallbackUrl(url: string): Promise<void> {
	if (processedUrls.has(url)) return;
	processedUrls.add(url);

	await handleClerkRedirect(url);

	// Never fail silently back to guest mode: if Clerk didn't establish
	// a session (transfer failed, sign-up restricted, ...), say so loudly
	// instead of leaving the sidebar on "Paperite user".
	if (!clerk.user) {
		throw new Error(
			"Sign in finished but no session was created. Check Clerk Logs (oauth_callback.failed) for the reason.",
		);
	}

	completeOnboarding();
	window.dispatchEvent(new CustomEvent("paperite:auth-success"));
}

/** Always-on auth callback handler. Mount once in RootLayout. */
export function useGlobalAuthCallback() {
	useEffect(() => {
		if (!isClerkConfigured()) return;
		if (!window.electron?.auth && !window.electron?.onAuthCallback) return;

		let cancelled = false;

		const handleUrl = async (url: string) => {
			try {
				await completeAuthCallbackUrl(url);
			} catch (error) {
				if (!cancelled) {
					window.dispatchEvent(
						new CustomEvent("paperite:auth-error", {
							detail:
								error instanceof Error
									? error.message
									: "Could not complete sign in.",
						}),
					);
				}
			}
		};

		// Warm up clerk so the session is ready when the callback lands.
		void loadClerk().catch(() => undefined);

		// Pure-web fallback: if the OAuth redirect landed back in this
		// window itself (browser mode, no Electron IPC involved), the
		// callback params are sitting in the current URL.
		if (/[?#&]__clerk_/.test(window.location.href)) {
			void handleUrl(window.location.href);
		}

		// Consume anything that arrived before the renderer subscribed
		// (e.g. deep link clicked while the app was running but no dialog open).
		void window.electron?.auth
			.getPendingCallback()
			?.then((url) => {
				if (!url || cancelled) return;
				return handleUrl(url);
			})
			.catch((error) => {
				if (!cancelled) {
					window.dispatchEvent(
						new CustomEvent("paperite:auth-error", {
							detail:
								error instanceof Error
									? error.message
									: "Could not read the sign-in callback.",
						}),
					);
				}
			});

		const unsubscribe = window.electron?.onAuthCallback((url) => {
			if (cancelled) return;
			void handleUrl(url);
		});

		return () => {
			cancelled = true;
			unsubscribe?.();
		};
	}, []);
}
