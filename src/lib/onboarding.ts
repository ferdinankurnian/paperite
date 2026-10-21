import type { SyncTargetKind } from "@/lib/space-sync-targets";

export const ONBOARDING_VERSION = 2;
const onboardingStateKey = "paperite:onboarding-state";
const legacyOnboardingCompleteKey = "paperite:onboarding-complete";

export type OnboardingStep =
	| "welcome"
	| "choose-target"
	| "configure-target"
	| "pair-device"
	| "select-space"
	| "confirm"
	| "complete";

export type OnboardingState = {
	version: typeof ONBOARDING_VERSION;
	step: OnboardingStep;
	selectedTarget: SyncTargetKind | null;
	connectionId: string | null;
	spacePath: string | null;
	remoteSpaceId: string | null;
	lastError: string | null;
	updatedAt: number;
};

const freshState = (): OnboardingState => ({
	version: ONBOARDING_VERSION,
	step: "welcome",
	selectedTarget: null,
	connectionId: null,
	spacePath: null,
	remoteSpaceId: null,
	lastError: null,
	updatedAt: Date.now(),
});

function persist(state: OnboardingState): OnboardingState {
	const next: OnboardingState = {
		...state,
		version: ONBOARDING_VERSION,
		updatedAt: Date.now(),
	};
	try {
		window.localStorage.setItem(onboardingStateKey, JSON.stringify(next));
	} catch {
		// Setup remains usable for this session if browser storage is unavailable.
	}
	return next;
}

function readStored(): OnboardingState | null {
	try {
		const raw = window.localStorage.getItem(onboardingStateKey);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<OnboardingState>;
			if (
				parsed.version === ONBOARDING_VERSION &&
				isStep(parsed.step) &&
				(isTarget(parsed.selectedTarget) || parsed.selectedTarget === null)
			) {
				return {
					...freshState(),
					...parsed,
					connectionId: parsed.connectionId ?? null,
					spacePath: parsed.spacePath ?? null,
					remoteSpaceId: parsed.remoteSpaceId ?? null,
					lastError: parsed.lastError ?? null,
				};
			}
		}
		// Existing users already completed the old gate. Preserve that fact as
		// a completed local setup, but never infer completion from Clerk later.
		if (window.localStorage.getItem(legacyOnboardingCompleteKey) === "1") {
			return persist({
				...freshState(),
				step: "complete",
				selectedTarget: "local",
			});
		}
	} catch {
		return null;
	}
	return null;
}

export function readOnboardingState(): OnboardingState {
	return readStored() ?? freshState();
}

export function hasCompletedOnboarding(): boolean {
	return readOnboardingState().step === "complete";
}

export function beginOnboarding(): OnboardingState {
	return persist({ ...freshState(), step: "choose-target" });
}

export function selectOnboardingTarget(
	target: SyncTargetKind,
): OnboardingState {
	const state = readOnboardingState();
	return persist({
		...state,
		step: "configure-target",
		selectedTarget: target,
		connectionId: null,
		remoteSpaceId: null,
		lastError: null,
	});
}

export function setOnboardingProgress(
	progress: Partial<
		Pick<
			OnboardingState,
			"step" | "connectionId" | "spacePath" | "remoteSpaceId" | "lastError"
		>
	>,
): OnboardingState {
	return persist({ ...readOnboardingState(), ...progress });
}

export function recordPairingFailure(message: string): OnboardingState {
	return setOnboardingProgress({ step: "pair-device", lastError: message });
}

export function cancelOnboarding(): OnboardingState {
	return persist({ ...freshState(), step: "welcome" });
}

export function completeSelectedOnboarding(args?: {
	spacePath?: string;
	connectionId?: string;
	remoteSpaceId?: string;
}): OnboardingState {
	const state = readOnboardingState();
	if (!state.selectedTarget) {
		throw new Error("Choose a setup target before completing onboarding.");
	}
	if (
		state.selectedTarget !== "local" &&
		!args?.connectionId &&
		!state.connectionId
	) {
		throw new Error("Configure the selected sync target before continuing.");
	}
	return persist({
		...state,
		step: "complete",
		spacePath: args?.spacePath ?? state.spacePath ?? "Inbox",
		connectionId: args?.connectionId ?? state.connectionId,
		remoteSpaceId: args?.remoteSpaceId ?? state.remoteSpaceId,
		lastError: null,
	});
}

/** Backwards-compatible local-only completion for existing callers. */
export function completeOnboarding(): OnboardingState {
	const current = readOnboardingState();
	if (current.selectedTarget && current.selectedTarget !== "local") {
		return completeSelectedOnboarding();
	}
	return persist({
		...current,
		step: "complete",
		selectedTarget: "local",
		spacePath: current.spacePath ?? "Inbox",
		lastError: null,
	});
}

function isStep(value: unknown): value is OnboardingStep {
	return (
		value === "welcome" ||
		value === "choose-target" ||
		value === "configure-target" ||
		value === "pair-device" ||
		value === "select-space" ||
		value === "confirm" ||
		value === "complete"
	);
}

function isTarget(value: unknown): value is SyncTargetKind {
	return (
		value === "local" ||
		value === "paperite-cloud" ||
		value === "paperite-server"
	);
}
