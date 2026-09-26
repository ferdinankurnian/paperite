import { Clerk } from "@clerk/clerk-js";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
let clerkInstance: Clerk | undefined;

export const isClerkConfigured = () => Boolean(publishableKey);

const getClerk = () => {
	if (!publishableKey) {
		throw new Error("missing VITE_CLERK_PUBLISHABLE_KEY");
	}

	clerkInstance ??= new Clerk(publishableKey);
	return clerkInstance;
};

export const clerk = new Proxy({} as Clerk, {
	get(_target, property, receiver) {
		return Reflect.get(getClerk(), property, receiver);
	},
});

let clerkLoadPromise: Promise<void> | undefined;

export const loadClerk = () => {
	clerkLoadPromise ??= getClerk().load();
	return clerkLoadPromise;
};

export const handleClerkRedirect = async (callbackUrl: string) => {
	await loadClerk();

	// Capture BEFORE replaceState below: after replacing, href points at
	// a /login?... path that doesn't exist as a file.
	const safeHref = window.location.href;

	const url = new URL(callbackUrl);
	const callbackPath = `/login${url.search}${url.hash}`;
	window.history.replaceState(null, "", callbackPath);

	// Clerk's post-session navigation assumes a hosted web app. In
	// Electron it navigates the window away (e.g. to file:/// which
	// renders a blank page), so neutralize it: routing here is owned by
	// the hash router + explicit navigates on paperite:auth-success.
	// The force redirect URLs are a second net for the same thing.
	getClerk().navigate = async () => undefined;

	// The in-memory client was fetched BEFORE the OAuth round-trip in the
	// external browser, so without a reload the SDK sees a stale sign-up
	// attempt (no verifications) and silently does nothing — no transfer,
	// no session, no error. Reloading first is what makes both completion
	// (new users) and the sign-up -> sign-in transfer (returning users)
	// work.
	await clerk.handleRedirectCallback(
		{
			reloadResource: "signUp",
			signInForceRedirectUrl: safeHref,
			signUpForceRedirectUrl: safeHref,
		},
		async () => undefined,
	);
};
