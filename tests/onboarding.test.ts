import { beforeEach, describe, expect, test } from "bun:test";
import {
	beginOnboarding,
	cancelOnboarding,
	completeSelectedOnboarding,
	readOnboardingState,
	recordPairingFailure,
	selectOnboardingTarget,
} from "@/lib/onboarding";

function installStorage() {
	const values = new Map<string, string>();
	(globalThis as typeof globalThis & { window: Window }).window = {
		localStorage: {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key),
			clear: () => values.clear(),
			key: (index: number) => [...values.keys()][index] ?? null,
			length: values.size,
		},
	} as unknown as Window;
}

describe("onboarding state", () => {
	beforeEach(installStorage);

	test("fresh setup is resumable and local-only completion is explicit", () => {
		expect(readOnboardingState().step).toBe("welcome");
		beginOnboarding();
		selectOnboardingTarget("local");
		const state = completeSelectedOnboarding({ spacePath: "Inbox" });
		expect(state.step).toBe("complete");
		expect(state.selectedTarget).toBe("local");
	});

	test("Clerk target does not complete until confirmed", () => {
		beginOnboarding();
		selectOnboardingTarget("paperite-cloud");
		expect(readOnboardingState().step).toBe("configure-target");
		const state = completeSelectedOnboarding({ connectionId: "paperite-plus" });
		expect(state.step).toBe("complete");
	});

	test("pairing failure can retry and cancellation is safe", () => {
		beginOnboarding();
		selectOnboardingTarget("paperite-server");
		expect(recordPairingFailure("offline").lastError).toBe("offline");
		expect(readOnboardingState().step).toBe("pair-device");
		expect(cancelOnboarding().step).toBe("welcome");
	});
});
