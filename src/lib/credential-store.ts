/**
 * Personal-server credentials cross this boundary only in Electron. Browser
 * mode deliberately has no persistence fallback: localStorage is not a
 * keychain and must never be presented as one.
 */
export const browserCredentialLimitation =
	"Browser mode cannot provide keychain-level security for personal-server credentials. Pairing is available only in the desktop app.";

export type CredentialStoreResult = { ok: true } | { ok: false; error: string };

export async function readPersonalServerCredential(
	connectionId: string,
): Promise<string | null> {
	return window.electron?.personalServer.getCredential(connectionId) ?? null;
}

export async function savePersonalServerCredential(
	connectionId: string,
	credential: string,
): Promise<CredentialStoreResult> {
	if (!window.electron?.personalServer) {
		return { ok: false, error: browserCredentialLimitation };
	}
	if (!credential)
		return { ok: false, error: "The server returned no credential." };
	return window.electron.personalServer.saveCredential(
		connectionId,
		credential,
	);
}

export async function deletePersonalServerCredential(
	connectionId: string,
): Promise<CredentialStoreResult> {
	if (!window.electron?.personalServer) return { ok: true };
	return window.electron.personalServer.deleteCredential(connectionId);
}
