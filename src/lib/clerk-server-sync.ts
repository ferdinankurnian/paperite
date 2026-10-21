import { clerk } from "@/lib/clerk";
import type { ConnectionMetadata } from "@/lib/space-sync-targets";

const localKey = "paperite:clerk-synced-servers";

export interface SyncedServerMetadata {
	connectionId: string;
	endpoint: string;
	serverId?: string;
	displayLabel: string;
	serverIdentity?: { icon: string; name: string };
	transportHint?: "localhost" | "tailscale" | "custom";
	updatedAt: number;
}

/** Read servers synced from Clerk user metadata */
export function getClerkPersonalServers(): Record<string, SyncedServerMetadata> {
	try {
		const meta = clerk.user?.unsafeMetadata as
			| { personalServers?: Record<string, SyncedServerMetadata> }
			| undefined;
		if (meta?.personalServers && typeof meta.personalServers === "object") {
			return meta.personalServers;
		}
	} catch {
		// Clerk not loaded or signed out
	}
	return {};
}

/** Sync a paired server connection into Clerk user metadata so all devices inherit it */
export async function syncPersonalServerToClerk(connection: ConnectionMetadata): Promise<void> {
	if (!connection.endpoint || connection.kind !== "paperite-server") return;

	const record: SyncedServerMetadata = {
		connectionId: connection.connectionId,
		endpoint: connection.endpoint,
		serverId: connection.serverId,
		displayLabel: connection.displayLabel,
		serverIdentity: connection.serverIdentity,
		transportHint: connection.transportHint,
		updatedAt: Date.now(),
	};

	// Save to local cache first
	try {
		const existing = JSON.parse(window.localStorage.getItem(localKey) || "{}");
		existing[connection.connectionId] = record;
		window.localStorage.setItem(localKey, JSON.stringify(existing));
	} catch {
		// Ignore local storage error
	}

	// Sync to Clerk
	const user = clerk.user;
	if (!user) return;

	try {
		const current = getClerkPersonalServers();
		await user.updateMetadata({
			unsafeMetadata: {
				...user.unsafeMetadata,
				personalServers: {
					...current,
					[connection.connectionId]: record,
				},
			},
		});
	} catch (err) {
		console.warn("Failed to sync personal server to Clerk metadata:", err);
	}
}

/** Remove a server from Clerk user metadata */
export async function removePersonalServerFromClerk(connectionId: string): Promise<void> {
	try {
		const existing = JSON.parse(window.localStorage.getItem(localKey) || "{}");
		delete existing[connectionId];
		window.localStorage.setItem(localKey, JSON.stringify(existing));
	} catch {
		// Ignore local storage error
	}

	const user = clerk.user;
	if (!user) return;

	try {
		const current = { ...getClerkPersonalServers() };
		delete current[connectionId];
		await user.updateMetadata({
			unsafeMetadata: {
				...user.unsafeMetadata,
				personalServers: current,
			},
		});
	} catch (err) {
		console.warn("Failed to remove personal server from Clerk metadata:", err);
	}
}
