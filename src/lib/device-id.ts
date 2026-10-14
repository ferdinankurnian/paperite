const deviceKey = "paperite.device-id";

/** Stable per-device id for the `updateId` wire contract (plan 020). */
export function getDeviceId(): string {
	try {
		const existing = window.localStorage.getItem(deviceKey);
		if (existing) return existing;
		const next =
			typeof crypto.randomUUID === "function"
				? crypto.randomUUID()
				: `device-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
		window.localStorage.setItem(deviceKey, next);
		return next;
	} catch {
		return `device-${Date.now()}`;
	}
}
