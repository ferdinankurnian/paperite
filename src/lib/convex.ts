import { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";

let convexClient: ConvexReactClient | null = null;

export function getConvexClient() {
	const url = import.meta.env.VITE_CONVEX_URL;
	if (!url) return null;

	convexClient ??= new ConvexReactClient(url);
	return convexClient;
}

export async function createSharedSpace(name: string) {
	const client = getConvexClient();
	if (!client) throw new Error("Convex is not configured.");

	return client.mutation(api.sharedSpaces.create, { name });
}
