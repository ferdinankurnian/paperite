import {
	type PaperiteSessionList,
	type PaperiteSessionSummary,
	summarizeActivity,
} from "@/lib/auth-sessions";
import { clerk, isClerkConfigured, loadClerk } from "@/lib/clerk";

/**
 * Account session management, for the desktop surface.
 *
 * The browser cannot do this itself — it holds no Clerk session — so the
 * desktop answers over the loopback auth bridge. Both sides share the
 * `auth:sessions` channel: the desktop lists and revokes, the browser
 * renders the result.
 */

type ClerkSessionLike = {
	id: string;
	lastActiveAt: Date | string;
	latestActivity?: Record<string, unknown> | null;
	revoke?: () => Promise<unknown>;
};

const toSummary = (session: ClerkSessionLike): PaperiteSessionSummary => ({
	id: session.id,
	lastActiveAt:
		session.lastActiveAt instanceof Date
			? session.lastActiveAt.toISOString()
			: String(session.lastActiveAt),
	latestActivity: summarizeActivity(session.latestActivity),
});

/** List the account's active sessions. */
export async function listAccountSessions(): Promise<PaperiteSessionList> {
	if (!isClerkConfigured()) {
		throw new Error("Sign-in is not configured.");
	}
	await loadClerk();
	const user = clerk.user;
	if (!user) throw new Error("You're not signed in.");

	const list = (await user.getSessions()) as unknown as ClerkSessionLike[];
	const currentSessionId = clerk.session?.id ?? null;
	const sessions = [...list]
		.sort((a, b) => {
			if (a.id === currentSessionId) return -1;
			if (b.id === currentSessionId) return 1;
			return (
				new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
			);
		})
		.map(toSummary);

	return { sessions, currentSessionId };
}

/** Revoke one session by id. */
export async function revokeAccountSession(sessionId: string): Promise<void> {
	if (!isClerkConfigured()) {
		throw new Error("Sign-in is not configured.");
	}
	await loadClerk();
	const user = clerk.user;
	if (!user) throw new Error("You're not signed in.");

	const list = (await user.getSessions()) as unknown as ClerkSessionLike[];
	const target = list.find((session) => session.id === sessionId);
	if (!target?.revoke) {
		throw new Error("That session is no longer active.");
	}
	await target.revoke();
}

/** Revoke every session except the current one. */
export async function revokeOtherAccountSessions(): Promise<void> {
	if (!isClerkConfigured()) {
		throw new Error("Sign-in is not configured.");
	}
	await loadClerk();
	const user = clerk.user;
	if (!user) throw new Error("You're not signed in.");

	const currentSessionId = clerk.session?.id ?? null;
	const list = (await user.getSessions()) as unknown as ClerkSessionLike[];
	const others = list.filter((session) => session.id !== currentSessionId);
	await Promise.all(
		others.map(async (session) => {
			await session.revoke?.();
		}),
	);
}
