import type { PaperiteAppState } from "@/lib/storage/types";

export type SyncTargetKind =
	| "local"
	| "paperite-cloud"
	| "paperite-server";

export type RemoteSyncTargetKind = Exclude<SyncTargetKind, "local">;
export type ConnectionTransportHint = "localhost" | "tailscale" | "custom";

/** Non-secret connection metadata. Credentials never belong in this record. */
export type ConnectionMetadata = {
	connectionId: string;
	kind: RemoteSyncTargetKind;
	displayLabel: string;
	endpoint?: string;
	transportHint?: ConnectionTransportHint;
	serverId?: string;
	/** Friendly identity advertised by the personal server; never a secret. */
	serverIdentity?: { icon: string; name: string };
	/** Non-secret paired-device identity; the credential stays in the keychain. */
	deviceId?: string;
	status?: "connected" | "needs-auth" | "unavailable";
	createdAt: number;
	updatedAt: number;
};

/** One space has one target. There is intentionally no targets array. */
export type SpaceSyncTarget = {
	kind: SyncTargetKind;
	connectionId?: string;
	remoteSpaceId?: string;
	updatedAt: number;
};

export const LOCAL_ONLY_TARGET: SpaceSyncTarget = {
	kind: "local",
	updatedAt: 0,
};

export function isSyncTargetKind(value: unknown): value is SyncTargetKind {
	return (
		value === "local" ||
		value === "paperite-cloud" ||
		value === "paperite-server"
	);
}

export function normalizeSpaceSyncTargets(
	targets: unknown,
	legacyCloudSpaceLinks: unknown,
): Record<string, SpaceSyncTarget> {
	const next: Record<string, SpaceSyncTarget> = {};
	if (targets && typeof targets === "object" && !Array.isArray(targets)) {
		for (const [spacePath, raw] of Object.entries(targets)) {
			const target = normalizeTarget(raw);
			if (target) next[spacePath] = target;
		}
	}

	// Compatibility is deliberately one-way: old cloud links fill an empty
	// generalized binding, but never overwrite a newer explicit target.
	if (
		legacyCloudSpaceLinks &&
		typeof legacyCloudSpaceLinks === "object" &&
		!Array.isArray(legacyCloudSpaceLinks)
	) {
		for (const [spacePath, remoteSpaceId] of Object.entries(
			legacyCloudSpaceLinks,
		)) {
			if (
				next[spacePath] ||
				typeof remoteSpaceId !== "string" ||
				remoteSpaceId.length === 0
			)
				continue;
			next[spacePath] = {
				kind: "paperite-cloud",
				remoteSpaceId,
				updatedAt: 0,
			};
		}
	}

	return next;
}

function normalizeTarget(value: unknown): SpaceSyncTarget | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const raw = value as Record<string, unknown>;
	if (raw.kind === "gdrive") {
		return { kind: "local", updatedAt: numberOrZero(raw.updatedAt) };
	}
	if (!isSyncTargetKind(raw.kind)) return null;
	if (raw.connectionId !== undefined && typeof raw.connectionId !== "string") {
		return null;
	}
	if (
		raw.remoteSpaceId !== undefined &&
		typeof raw.remoteSpaceId !== "string"
	) {
		return null;
	}
	if (raw.kind === "local" && (raw.connectionId || raw.remoteSpaceId)) {
		return { kind: "local", updatedAt: numberOrZero(raw.updatedAt) };
	}
	return {
		kind: raw.kind,
		...(raw.connectionId ? { connectionId: raw.connectionId } : {}),
		...(raw.remoteSpaceId ? { remoteSpaceId: raw.remoteSpaceId } : {}),
		updatedAt: numberOrZero(raw.updatedAt),
	};
}

function numberOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export type TargetStateShape = Pick<
	PaperiteAppState,
	"spaceSyncTargets" | "cloudSpaceLinks"
>;

export function getSpaceSyncTarget(
	state: TargetStateShape,
	spacePath: string,
): SpaceSyncTarget {
	return (
		state.spaceSyncTargets?.[spacePath] ??
		normalizeSpaceSyncTargets(undefined, state.cloudSpaceLinks)[spacePath] ??
		LOCAL_ONLY_TARGET
	);
}

export function getCloudSpaceId(
	state: TargetStateShape,
	spacePath: string,
): string | null {
	const target = getSpaceSyncTarget(state, spacePath);
	return target.kind === "paperite-cloud" && target.remoteSpaceId
		? target.remoteSpaceId
		: null;
}

/** Remote identity for any target implemented by the shared sync adapter. */
export function getRemoteSpaceId(
	state: TargetStateShape,
	spacePath: string,
): string | null {
	const target = getSpaceSyncTarget(state, spacePath);
	return target.kind !== "local" && target.remoteSpaceId
		? target.remoteSpaceId
		: null;
}

/** A compatibility view for existing cloud-space pickers; never persist it. */
export function getCloudSpaceLinksForUi(
	state: TargetStateShape,
): Record<string, string> {
	const next: Record<string, string> = {};
	const targets = normalizeSpaceSyncTargets(
		state.spaceSyncTargets,
		state.cloudSpaceLinks,
	);
	for (const [spacePath, target] of Object.entries(targets)) {
		if (target.kind === "paperite-cloud" && target.remoteSpaceId) {
			next[spacePath] = target.remoteSpaceId;
		}
	}
	return next;
}

/** Replaces the active target atomically; this is the one-target invariant. */
export function bindSpaceToTarget(
	state: TargetStateShape,
	spacePath: string,
	target: Omit<SpaceSyncTarget, "updatedAt">,
	now = Date.now(),
): Record<string, SpaceSyncTarget> {
	if (!spacePath.trim()) throw new Error("A space path is required.");
	if (
		target.kind === "local" &&
		(target.connectionId || target.remoteSpaceId)
	) {
		throw new Error("Local-only spaces cannot have a remote identity.");
	}
	if (target.kind === "paperite-server" && !target.connectionId) {
		throw new Error("A personal-server connection is required.");
	}
	if (target.kind !== "local" && target.remoteSpaceId === "") {
		throw new Error("A remote space identity cannot be empty.");
	}
	return {
		...(state.spaceSyncTargets ?? {}),
		[spacePath]: { ...target, updatedAt: now },
	};
}

export function disconnectConnection(
	state: TargetStateShape,
	connectionId: string,
	strategy: "keep-local" | "rebind" = "keep-local",
): { targets: Record<string, SpaceSyncTarget>; affectedSpaces: string[] } {
	const affected = affectedSpaces(state, connectionId);
	if (
		affected.length > 0 &&
		strategy !== "keep-local" &&
		strategy !== "rebind"
	) {
		throw new Error("Choose what to do with spaces using this connection.");
	}
	const targets = { ...(state.spaceSyncTargets ?? {}) };
	if (strategy === "keep-local") {
		for (const spacePath of affected)
			targets[spacePath] = { ...LOCAL_ONLY_TARGET, updatedAt: Date.now() };
	}
	return { targets, affectedSpaces: affected };
}

export function unbindSpace(state: TargetStateShape, spacePath: string) {
	const next = { ...(state.spaceSyncTargets ?? {}) };
	delete next[spacePath];
	return next;
}

export function affectedSpaces(
	state: TargetStateShape,
	connectionId: string,
): string[] {
	return Object.keys(state.spaceSyncTargets ?? {}).filter(
		(spacePath) =>
			getSpaceSyncTarget(state, spacePath).connectionId === connectionId,
	);
}

/** Duplicates only target metadata; the remote identity must be created by the upload. */
export function prepareDuplicateTarget(
	state: TargetStateShape,
	sourceSpacePath: string,
	destinationSpacePath: string,
	now = Date.now(),
) {
	const source = getSpaceSyncTarget(state, sourceSpacePath);
	return bindSpaceToTarget(
		state,
		destinationSpacePath,
		{
			kind: source.kind,
			...(source.connectionId ? { connectionId: source.connectionId } : {}),
		},
		now,
	);
}

export type TransferVerification = {
	verified: boolean;
	noteCount: number;
	verifiedNoteCount: number;
	identityCoverage: number;
};

export function applyVerifiedMove(
	state: TargetStateShape,
	spacePath: string,
	nextTarget: Omit<SpaceSyncTarget, "updatedAt">,
	verification: TransferVerification,
	now = Date.now(),
) {
	if (
		!verification.verified ||
		verification.noteCount !== verification.verifiedNoteCount ||
		verification.identityCoverage < 1
	) {
		throw new Error("Move verification did not cover every local note.");
	}
	return bindSpaceToTarget(state, spacePath, nextTarget, now);
}
