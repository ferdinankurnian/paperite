const onboardingCompleteKey = "paperite:onboarding-complete";

export function hasCompletedOnboarding() {
	try {
		return window.localStorage.getItem(onboardingCompleteKey) === "1";
	} catch {
		return false;
	}
}

export function completeOnboarding() {
	try {
		window.localStorage.setItem(onboardingCompleteKey, "1");
	} catch {
		// If storage is unavailable, the app can still continue for this session.
	}
}
