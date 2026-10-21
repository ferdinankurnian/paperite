export type DeviceAuthStatus =
	| { status: "unbound"; storage?: "keychain" | "file" }
	| {
			status: "bound" | "claimed";
			userId: string;
			deviceId: string;
			storage?: "keychain" | "file";
	  }
	| { status: "account-mismatch"; userId: string }
	| {
			status:
				| "keychain-unavailable"
				| "invalid-record"
				| "invalid-user"
				| "file-storage-unavailable";
			storage?: "keychain" | "file";
	  };

async function request(
	path: string,
	init?: RequestInit,
): Promise<DeviceAuthStatus> {
	const response = await fetch(`/api/device-auth/${path}`, {
		...init,
		headers: { "content-type": "application/json", ...init?.headers },
	});
	if (!response.ok)
		throw new Error(`Device auth request failed (${response.status})`);
	return (await response.json()) as DeviceAuthStatus;
}

export function getDeviceAuthStatus(): Promise<DeviceAuthStatus> {
	if (window.electron?.auth.getDeviceStatus) {
		return window.electron.auth.getDeviceStatus();
	}
	return request("status");
}

export function claimDeviceAccount(userId: string): Promise<DeviceAuthStatus> {
	if (window.electron?.auth.claimDevice) {
		return window.electron.auth.claimDevice(userId);
	}
	return request("claim", {
		method: "POST",
		body: JSON.stringify({ userId }),
	});
}

export function clearDeviceAccount(): Promise<DeviceAuthStatus> {
	if (window.electron?.auth.clearDevice) {
		return window.electron.auth.clearDevice();
	}
	return request("clear", { method: "POST" });
}

export function enableInsecureFileStorage(): Promise<DeviceAuthStatus> {
	if (window.electron?.auth.enableFileStorage) {
		return window.electron.auth.enableFileStorage();
	}
	return request("enable-file", { method: "POST" });
}

export async function ensureDeviceAccount(userId: string): Promise<void> {
	const current = await getDeviceAuthStatus();
	if (
		current.status === "keychain-unavailable" ||
		current.status === "invalid-record"
	) {
		throw new Error("Paperite cannot access its device account binding.");
	}
	if (current.status === "bound" || current.status === "account-mismatch") {
		if (current.userId !== userId) {
			throw new Error(
				"This Paperite installation is already connected to another account. Log out of the other session first.",
			);
		}
		return;
	}
	const claimed = await claimDeviceAccount(userId);
	if (claimed.status === "claimed" || claimed.status === "bound") return;
	if (claimed.status === "account-mismatch") {
		throw new Error(
			"This Paperite installation is already connected to another account. Log out of the other session first.",
		);
	}
	throw new Error("Paperite could not claim this device account.");
}

/** Validate an already-restored session without claiming an unbound device. */
export async function validateDeviceAccount(userId: string): Promise<void> {
	const current = await getDeviceAuthStatus();
	if (
		current.status === "keychain-unavailable" ||
		current.status === "invalid-record"
	) {
		throw new Error("Paperite cannot access its device account binding.");
	}
	if (current.status === "bound" || current.status === "account-mismatch") {
		if (current.userId !== userId) {
			throw new Error(
				"This Paperite installation is already connected to another account. Log out of the other session first.",
			);
		}
		return;
	}
	throw new Error("Paperite was logged out on another surface. Sign in again.");
}
