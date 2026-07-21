import { Clerk } from "@clerk/clerk-js";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
let clerkInstance: Clerk | undefined;

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

	const url = new URL(callbackUrl);
	const callbackPath = `/login${url.search}${url.hash}`;
	window.history.replaceState(null, "", callbackPath);

	await clerk.handleRedirectCallback(undefined, async () => undefined);
};
