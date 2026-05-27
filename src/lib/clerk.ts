import { Clerk } from "@clerk/clerk-js";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!publishableKey) {
	throw new Error("missing VITE_CLERK_PUBLISHABLE_KEY");
}

export const clerk = new Clerk(publishableKey);

let clerkLoadPromise: Promise<void> | undefined;

export const loadClerk = () => {
	clerkLoadPromise ??= clerk.load();
	return clerkLoadPromise;
};

export const handleClerkRedirect = async (callbackUrl: string) => {
	await loadClerk();

	const url = new URL(callbackUrl);
	const callbackPath = `/login${url.search}${url.hash}`;
	window.history.replaceState(null, "", callbackPath);

	await clerk.handleRedirectCallback(undefined, async () => undefined);
};
