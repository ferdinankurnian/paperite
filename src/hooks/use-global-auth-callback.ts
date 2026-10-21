import { useEffect } from "react";
import {
	listAccountSessions,
	revokeAccountSession,
	revokeOtherAccountSessions,
} from "@/lib/account-sessions";
import { isBrowserRenderer } from "@/lib/auth-bridge";
import {
	clerk,
	handleClerkRedirect,
	isClerkConfigured,
	loadClerk,
} from "@/lib/clerk";
import { clearDeviceAccount, validateDeviceAccount } from "@/lib/device-auth";

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

	window.dispatchEvent(new CustomEvent("paperite:auth-success"));
}

/** Always-on auth callback handler. Mount once in RootLayout. */
export function useGlobalAuthCallback() {
	useEffect(() => {
		if (!isClerkConfigured()) return;

		// A browser attached to `paperite serve` mirrors the desktop session
		// and never runs a Clerk OAuth round-trip of its own — there is no
		// second login, so there is no second callback to complete.
		if (isBrowserRenderer()) return;

		// Serve/web mode has no Electron bridge — the __clerk_ URL fallback
		// below IS the flow there, so don't bail.
		if (
			!window.electron?.auth &&
			!window.electron?.onAuthCallback &&
			!import.meta.env.PAPERITE_WEB
		)
			return;

		let cancelled = false;

		const respondToBridgeSession = async (request: {
			requestId: string;
			includeToken: boolean;
		}) => {
			try {
				await loadClerk();
				const user = clerk.user;
				const session = clerk.session;
				const result: Record<string, unknown> = {
					signedIn: Boolean(user && session),
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
				};
				if (request.includeToken) {
					result.token = session
						? await session.getToken({ template: "convex" })
						: null;
				}
				window.electron?.auth.respondBridgeSession(request.requestId, result);
			} catch (error) {
				window.electron?.auth.respondBridgeSession(request.requestId, {
					error: error instanceof Error ? error.message : "Auth unavailable",
				});
			}
		};

		// The browser holds no Clerk session, so it cannot list or revoke
		// sessions itself. The desktop answers on its behalf over the same
		// loopback bridge.
		const respondToBridgeSessions = async (request: { requestId: string }) => {
			try {
				const result = await listAccountSessions();
				window.electron?.auth.respondBridgeSessions(request.requestId, result);
			} catch (error) {
				window.electron?.auth.respondBridgeSessions(request.requestId, {
					error:
						error instanceof Error
							? error.message
							: "Couldn't load your sessions.",
				});
			}
		};

		const respondToBridgeRevokeSession = async (request: {
			requestId: string;
			sessionId: string;
		}) => {
			try {
				await revokeAccountSession(request.sessionId);
				window.electron?.auth.respondBridgeSessions(request.requestId, {
					ok: true,
				});
			} catch (error) {
				window.electron?.auth.respondBridgeSessions(request.requestId, {
					error:
						error instanceof Error
							? error.message
							: "Couldn't sign out that device.",
				});
			}
		};

		const respondToBridgeRevokeOthers = async (request: {
			requestId: string;
		}) => {
			try {
				await revokeOtherAccountSessions();
				window.electron?.auth.respondBridgeSessions(request.requestId, {
					ok: true,
				});
			} catch (error) {
				window.electron?.auth.respondBridgeSessions(request.requestId, {
					error:
						error instanceof Error
							? error.message
							: "Couldn't sign out other devices.",
				});
			}
		};

		// Shared user metadata (device names) also has to be written by the
		// desktop — the browser cannot call Clerk's updateMetadata.
		const respondToBridgeMetadata = async (request: {
			requestId: string;
			metadata: Record<string, unknown>;
		}) => {
			try {
				await loadClerk();
				const user = clerk.user;
				if (!user) throw new Error("You're not signed in.");
				await user.updateMetadata({
					unsafeMetadata: {
						...user.unsafeMetadata,
						...request.metadata,
					},
				});
				window.electron?.auth.respondBridgeSessions(request.requestId, {
					ok: true,
				});
			} catch (error) {
				window.electron?.auth.respondBridgeSessions(request.requestId, {
					error:
						error instanceof Error
							? error.message
							: "Couldn't update account metadata.",
				});
			}
		};

		const respondToBridgeSignOut = async (requestId: string) => {
			try {
				const binding = await clearDeviceAccount();
				if (binding.status !== "unbound") {
					throw new Error(
						"Could not clear the Paperite device account binding.",
					);
				}
				await clerk.signOut();
				window.electron?.auth.respondBridgeSignOut(requestId, { ok: true });
			} catch (error) {
				window.electron?.auth.respondBridgeSignOut(requestId, {
					error: error instanceof Error ? error.message : "Could not sign out",
				});
			}
		};

		const stopBridgeSessionRequests =
			window.electron?.auth.onBridgeSessionRequest((request) => {
				void respondToBridgeSession(request);
			});
		const stopBridgeSessionsRequests =
			window.electron?.auth.onBridgeSessionsRequest((request) => {
				if (request.action === "revoke-session" && request.sessionId) {
					void respondToBridgeRevokeSession({
						requestId: request.requestId,
						sessionId: request.sessionId,
					});
					return;
				}
				if (request.action === "revoke-others") {
					void respondToBridgeRevokeOthers(request);
					return;
				}
				if (request.action === "update-metadata" && request.metadata) {
					void respondToBridgeMetadata({
						requestId: request.requestId,
						metadata: request.metadata,
					});
					return;
				}
				void respondToBridgeSessions(request);
			});
		const stopBridgeSignOutRequests =
			window.electron?.auth.onBridgeSignOutRequest((requestId) => {
				void respondToBridgeSignOut(requestId);
			});

		const checkSharedSession = async () => {
			const userId = clerk.user?.id;
			if (!userId || cancelled) return;
			try {
				await validateDeviceAccount(userId);
			} catch (error) {
				if (cancelled) return;
				await clerk.signOut().catch(() => undefined);
				window.dispatchEvent(
					new CustomEvent("paperite:auth-error", {
						detail:
							error instanceof Error
								? error.message
								: "Paperite signed out on another surface.",
					}),
				);
			}
		};

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
		void loadClerk()
			.then(checkSharedSession)
			.catch(() => undefined);
		const sessionCheck = window.setInterval(() => {
			void checkSharedSession();
		}, 2000);
		window.addEventListener("focus", checkSharedSession);

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
			window.clearInterval(sessionCheck);
			window.removeEventListener("focus", checkSharedSession);
			stopBridgeSessionRequests?.();
			stopBridgeSessionsRequests?.();
			stopBridgeSignOutRequests?.();
			unsubscribe?.();
		};
	}, []);
}
