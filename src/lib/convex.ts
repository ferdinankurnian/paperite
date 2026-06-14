import { ConvexReactClient } from "convex/react";

let convexClient: ConvexReactClient | null = null;

export function getConvexClient() {
	const url = import.meta.env.VITE_CONVEX_URL;
	if (!url) return null;

	convexClient ??= new ConvexReactClient(url);
	return convexClient;
}
