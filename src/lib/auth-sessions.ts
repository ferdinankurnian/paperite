/**
 * Wire shapes for the account's active sessions.
 *
 * The browser never holds a Clerk session, so it cannot call
 * `clerk.user.getSessions()` itself — the desktop does that on its behalf
 * and ships the result over the loopback auth bridge. These types are the
 * shared contract between the desktop renderer, the serve server, and the
 * browser.
 *
 * Kept free of imports on purpose: this module is imported by both the
 * browser-side bridge client and the desktop-side Clerk helpers, and an
 * import cycle here would drag the Clerk SDK into the browser bundle.
 */

export type PaperiteSessionActivity = {
	browserName: string | null;
	browserVersion: string | null;
	deviceType: string | null;
	isMobile: boolean | null;
	city: string | null;
	country: string | null;
	ipAddress: string | null;
};

export type PaperiteSessionSummary = {
	id: string;
	/** ISO timestamp — the wire format is JSON, not a Date. */
	lastActiveAt: string;
	latestActivity: PaperiteSessionActivity | null;
};

export type PaperiteSessionList = {
	sessions: PaperiteSessionSummary[];
	/** The desktop's own session id, so the UI can mark it. */
	currentSessionId: string | null;
};

/** Normalize a Clerk activity object into the wire shape. */
export function summarizeActivity(
	activity: Record<string, unknown> | null | undefined,
): PaperiteSessionActivity | null {
	if (!activity) return null;
	const read = (key: string): string | null => {
		const value = activity[key];
		return typeof value === "string" ? value : null;
	};
	const isMobile = activity.isMobile;
	return {
		browserName: read("browserName"),
		browserVersion: read("browserVersion"),
		deviceType: read("deviceType"),
		isMobile: typeof isMobile === "boolean" ? isMobile : null,
		city: read("city"),
		country: read("country"),
		ipAddress: read("ipAddress"),
	};
}
