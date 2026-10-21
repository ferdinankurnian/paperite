import {
	getBridgeUser,
	isBrowserRenderer,
	updateBridgeMetadata,
} from "@/lib/auth-bridge";
import { clerk } from "@/lib/clerk";

export const deviceAliasesChangedEvent = "paperite:device-aliases-changed";

const localKey = "paperite:device-aliases";
const installationKey = "paperite:installation-name";
const maxNameLength = 40;

export function notifyDeviceAliasesChanged() {
	window.dispatchEvent(new Event(deviceAliasesChangedEvent));
}

/**
 * The shared source of truth for device names is the Clerk user's
 * `unsafeMetadata`. A browser holds no Clerk session, so it reads the
 * metadata the desktop published over the bridge instead.
 */
function readSharedMetadata(): Record<string, unknown> | undefined {
	try {
		if (isBrowserRenderer()) {
			return getBridgeUser()?.unsafeMetadata as
				| Record<string, unknown>
				| undefined;
		}
		return clerk.user?.unsafeMetadata as Record<string, unknown> | undefined;
	} catch {
		return undefined;
	}
}

/** Write shared user metadata — directly on the desktop, via the bridge in a browser. */
async function writeSharedMetadata(
	metadata: Record<string, unknown>,
): Promise<void> {
	if (isBrowserRenderer()) {
		const ok = await updateBridgeMetadata(metadata);
		if (!ok) throw new Error("Could not reach the Paperite desktop app.");
		return;
	}
	const user = clerk.user;
	if (!user) throw new Error("You're not signed in.");
	await user.updateMetadata({
		unsafeMetadata: { ...user.unsafeMetadata, ...metadata },
	});
}

function readLocalAliases(): Record<string, string> {
	try {
		const raw = window.localStorage.getItem(localKey);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return {};
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof v === "string" && v.trim())
				out[k] = v.trim().slice(0, maxNameLength);
		}
		return out;
	} catch {
		return {};
	}
}

function readRemoteAliases(): Record<string, string> {
	try {
		const names = readSharedMetadata()?.deviceNames;
		if (typeof names !== "object" || names === null) return {};
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(names as Record<string, unknown>)) {
			if (typeof v === "string" && v.trim())
				out[k] = v.trim().slice(0, maxNameLength);
		}
		return out;
	} catch {
		return {};
	}
}

export function getInstallationAlias(): string | null {
	try {
		const remote = readSharedMetadata()?.installationName;
		if (typeof remote === "string" && remote.trim())
			return remote.trim().slice(0, maxNameLength);
		const local = window.localStorage.getItem(installationKey)?.trim();
		return local ? local.slice(0, maxNameLength) : null;
	} catch {
		return null;
	}
}

export async function renameInstallationAlias(name: string): Promise<void> {
	const trimmed = name.trim().slice(0, maxNameLength);
	try {
		if (trimmed) window.localStorage.setItem(installationKey, trimmed);
		else window.localStorage.removeItem(installationKey);
	} catch {
		// Local cache is best-effort — Clerk remains the shared source of truth.
	}
	notifyDeviceAliasesChanged();
	await writeSharedMetadata({
		installationName: trimmed ? trimmed : null,
	});
	notifyDeviceAliasesChanged();
}

/** Local aliases overlaid with the shared Clerk ones (shared wins). */
export function getDeviceAliases(): Record<string, string> {
	return { ...readLocalAliases(), ...readRemoteAliases() };
}

/**
 * Rename a session/device. Saved locally first (works offline), then synced
 * to Clerk `unsafeMetadata.deviceNames` so every device sees the same name.
 * An empty name clears the alias. Throws when the remote sync fails — the
 * local copy is still kept.
 */
export async function renameDeviceAlias(
	sessionId: string,
	name: string,
): Promise<void> {
	const trimmed = name.trim().slice(0, maxNameLength);

	try {
		const local = readLocalAliases();
		if (trimmed) local[sessionId] = trimmed;
		else delete local[sessionId];
		window.localStorage.setItem(localKey, JSON.stringify(local));
	} catch {
		// Local cache is best-effort — the remote sync below still runs.
	}
	notifyDeviceAliasesChanged();

	await writeSharedMetadata({
		deviceNames: { [sessionId]: trimmed ? trimmed : null },
	});
	notifyDeviceAliasesChanged();
}
