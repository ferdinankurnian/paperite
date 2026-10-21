import {
	readPersonalServerCredential,
	savePersonalServerCredential,
} from "@/lib/credential-store";
import type {
	ConnectionMetadata,
	ConnectionTransportHint,
	RemoteSyncTargetKind,
} from "@/lib/space-sync-targets";

export type ServerOperation =
	| "capabilities"
	| "get-session"
	| "pair-device"
	| "list-devices"
	| "revoke-device"
	| "list-spaces"
	| "read-notes"
	| "write-notes"
	| "delete-notes"
	| "read-snapshots"
	| "write-snapshots"
	| "read-updates"
	| "append-updates"
	| "subscribe-updates";

export type ServerCapabilities = {
	protocolVersion: string;
	serverId: string;
	identity?: ServerIdentity;
	supportedOperations: readonly ServerOperation[];
	authMode: "device-pairing";
	generatedAt: string;
};

export type ServerIdentity = { icon: string; name: string };

export type AuthSession = {
	sessionId: string;
	user: { userId: string; displayName?: string };
	issuedAt: string;
	expiresAt: string | null;
};

export type SpaceMembership = {
	space: {
		spaceId: string;
		name: string;
		ownerUserId: string;
		createdAt: string;
		updatedAt: string;
	};
	userId: string;
	role: "owner" | "editor" | "viewer";
	joinedAt: string;
};

export type NoteRef = { spaceId: string; noteId: string };

export type NoteMetadata = NoteRef & {
	path: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
};

export type YjsSnapshot = NoteRef & {
	data: Uint8Array;
	stateVector: Uint8Array;
	updatedAt: string;
};

export type YjsUpdateBatch = NoteRef & {
	updateBatchId: string;
	deviceId: string;
	updates: readonly Uint8Array[];
	createdAt: string;
};

export type RemoteNoteUpdate = { type: "update"; batch: YjsUpdateBatch };

export type NoteUpdateSubscription = { unsubscribe: () => void };

export type PairingRequest = {
	challengeId: string;
	challengeToken: string;
	deviceLabel: string;
};

export type PairingResult = {
	serverId: string;
	identity?: ServerIdentity;
	device: {
		deviceId: string;
		label: string;
		pairedAt: string;
		lastSeenAt: string | null;
		revokedAt: string | null;
	};
	deviceCredential: string;
	credentialIssuedAt: string;
	credentialExpiresAt: string | null;
};

export type PersonalServerConnectionResult = {
	connection: ConnectionMetadata;
	deviceId: string;
	serverId: string;
};

export class PersonalServerError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = "PersonalServerError";
		this.status = status;
		this.code = code;
	}
}

export function normalizePersonalServerEndpoint(input: string): string {
	const value = input.trim().replace(/\/+$/, "");
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("Enter a complete personal-server URL.");
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new Error(
			"Personal-server URLs cannot contain credentials or query data.",
		);
	}
	const host = url.hostname.toLowerCase();
	const loopback =
		host === "localhost" || host === "127.0.0.1" || host === "[::1]";
	if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
		throw new Error(
			"Use HTTPS for Tailscale/custom servers. HTTP is allowed only for localhost.",
		);
	}
	return url.toString().replace(/\/$/, "");
}

export function inferTransportHint(endpoint: string): ConnectionTransportHint {
	const host = new URL(endpoint).hostname.toLowerCase();
	if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
		return "localhost";
	}
	if (host.endsWith(".ts.net")) return "tailscale";
	return "custom";
}

export async function discoverPersonalServer(
	endpoint: string,
): Promise<ServerCapabilities> {
	const normalized = normalizePersonalServerEndpoint(endpoint);
	return requestJson<ServerCapabilities>(`${normalized}/v1/capabilities`);
}

export async function pairPersonalServer(args: {
	endpoint: string;
	connectionId: string;
	displayLabel: string;
	deviceLabel: string;
	challengeId: string;
	challengeToken: string;
}): Promise<PersonalServerConnectionResult> {
	const endpoint = normalizePersonalServerEndpoint(args.endpoint);
	const result = await requestJson<PairingResult>(`${endpoint}/v1/pairing`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			challengeId: args.challengeId,
			challengeToken: args.challengeToken,
			deviceLabel: args.deviceLabel,
		}),
	});
	const saved = await savePersonalServerCredential(
		args.connectionId,
		result.deviceCredential,
	);
	if (!saved.ok) throw new Error(saved.error);
	const identity = normalizeServerIdentity(result.identity, args.displayLabel);
	return {
		connection: {
			connectionId: args.connectionId,
			kind: "paperite-server" satisfies RemoteSyncTargetKind,
			displayLabel: args.displayLabel.trim() || identity.name,
			endpoint,
			transportHint: inferTransportHint(endpoint),
			serverId: result.serverId,
			serverIdentity: identity,
			deviceId: result.device.deviceId,
			status: "connected",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		},
		deviceId: result.device.deviceId,
		serverId: result.serverId,
	};
}

export function normalizeServerIdentity(
	identity: ServerIdentity | undefined,
	fallbackName = "Paperite server",
): ServerIdentity {
	return {
		icon: identity?.icon?.trim() || "🗃️",
		name: identity?.name?.trim() || fallbackName.trim() || "Paperite server",
	};
}

/**
 * Renderer-safe HTTP adapter for the personal-server wire protocol.
 *
 * The server uses base64 only at its JSON boundary. Do not replace these
 * helpers with Node's Buffer: this module also runs in the browser renderer.
 */
export class PersonalServerHttpProvider {
	private readonly endpoint: string;
	private readonly serverId: string;
	private deviceId: string;
	private readonly deviceCredential: string;

	constructor(options: {
		endpoint: string;
		serverId: string;
		deviceId: string;
		deviceCredential: string;
	}) {
		this.endpoint = normalizePersonalServerEndpoint(options.endpoint);
		this.serverId = options.serverId;
		this.deviceId = options.deviceId;
		this.deviceCredential = options.deviceCredential;
	}

	async getSession(): Promise<AuthSession | null> {
		try {
			const capabilities = await discoverPersonalServer(this.endpoint);
			if (capabilities.serverId !== this.serverId) {
				throw new PersonalServerError(
					409,
					"server_id_changed",
					"This endpoint is a different server than the saved connection.",
				);
			}
			const session = await this.request<AuthSession>("/v1/session");
			const sessionDeviceId = session.user.userId.startsWith("device:")
				? session.user.userId.slice("device:".length)
				: null;
			if (sessionDeviceId) this.deviceId = sessionDeviceId;
			return session;
		} catch (error) {
			if (error instanceof PersonalServerError && error.status === 401)
				return null;
			throw error;
		}
	}

	listSpaces(): Promise<readonly SpaceMembership[]> {
		return this.request<SpaceMembership[]>("/v1/spaces");
	}

	createSpace(name: string): Promise<SpaceMembership> {
		return this.request<SpaceMembership>(
			"/v1/spaces",
			jsonInit("POST", { name }),
		);
	}

	listNotes(spaceId: string): Promise<readonly NoteMetadata[]> {
		return this.request<NoteMetadata[]>(
			`/v1/spaces/${encodeURIComponent(spaceId)}/notes`,
		);
	}

	upsertNote(
		input: NoteMetadata | (NoteRef & { path: string; title: string }),
	): Promise<NoteMetadata> {
		return this.request<NoteMetadata>(
			notePath(input, ""),
			jsonInit("PUT", { path: input.path, title: input.title }),
		);
	}

	deleteNote(input: NoteRef): Promise<NoteMetadata | null> {
		return this.request<NoteMetadata | null>(notePath(input, ""), {
			method: "DELETE",
		});
	}

	async readSnapshot(note: NoteRef): Promise<YjsSnapshot | null> {
		const value = await this.request<WireSnapshot | null>(
			notePath(note, "/snapshot"),
		);
		return value ? decodeSnapshot(value) : null;
	}

	async writeSnapshot(
		input: NoteRef & {
			data: Uint8Array;
			stateVector: Uint8Array;
		},
	): Promise<YjsSnapshot> {
		const value = await this.request<WireSnapshot>(
			notePath(input, "/snapshot"),
			jsonInit("PUT", {
				data: encodeBase64(input.data),
				stateVector: encodeBase64(input.stateVector),
			}),
		);
		return decodeSnapshot(value);
	}

	async listUpdateBatches(note: NoteRef): Promise<readonly YjsUpdateBatch[]> {
		const values = await this.request<WireUpdateBatch[]>(
			notePath(note, "/updates"),
		);
		return values.map(decodeUpdateBatch);
	}

	async appendUpdateBatch(
		input: NoteRef & {
			updateBatchId: string;
			deviceId: string;
			updates: readonly Uint8Array[];
		},
	): Promise<YjsUpdateBatch> {
		if (input.deviceId !== this.deviceId) {
			throw new PersonalServerError(
				403,
				"device_id_mismatch",
				"The update device does not match this connection.",
			);
		}
		const value = await this.request<WireUpdateBatch>(
			notePath(input, "/updates"),
			jsonInit("POST", {
				updateBatchId: input.updateBatchId,
				deviceId: input.deviceId,
				updates: input.updates.map(encodeBase64),
			}),
		);
		return decodeUpdateBatch(value);
	}

	subscribeToNoteUpdates(
		input: NoteRef & {
			onUpdate: (update: RemoteNoteUpdate) => void;
			onError?: (error: unknown) => void;
		},
	): NoteUpdateSubscription {
		const controller = new AbortController();
		let active = true;
		void this.consumeUpdates(input, controller.signal).catch(
			(error: unknown) => {
				if (active && !controller.signal.aborted) input.onError?.(error);
			},
		);
		return {
			unsubscribe: () => {
				if (!active) return;
				active = false;
				controller.abort();
			},
		};
	}

	private async consumeUpdates(
		input: NoteRef & {
			onUpdate: (update: RemoteNoteUpdate) => void;
			onError?: (error: unknown) => void;
		},
		signal: AbortSignal,
	): Promise<void> {
		const response = await fetch(
			`${this.endpoint}${notePath(input, "/updates/subscribe")}`,
			{ headers: this.authHeaders(), signal },
		);
		if (!response.ok) throw await toPersonalServerError(response);
		if (!response.body) {
			throw new PersonalServerError(
				500,
				"internal_error",
				"The update stream has no body.",
			);
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		while (!signal.aborted) {
			const { done, value } = await reader.read();
			if (done) return;
			buffer += decoder.decode(value, { stream: true });
			const events = buffer.split("\n\n");
			buffer = events.pop() ?? "";
			for (const event of events) {
				const dataLine = event
					.split("\n")
					.find((line) => line.startsWith("data: "));
				if (!dataLine) continue;
				const parsed = JSON.parse(
					dataLine.slice("data: ".length),
				) as WireUpdateBatch;
				input.onUpdate({
					type: "update",
					batch: decodeUpdateBatch(parsed),
				});
			}
		}
	}

	private authHeaders(): HeadersInit {
		return {
			accept: "application/json",
			authorization: `Bearer ${this.deviceCredential}`,
		};
	}

	private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await fetch(`${this.endpoint}${path}`, {
			...init,
			cache: "no-store",
			headers: { ...this.authHeaders(), ...init.headers },
		});
		if (!response.ok) throw await toPersonalServerError(response);
		return (await response.json()) as T;
	}
}

type WireSnapshot = Omit<YjsSnapshot, "data" | "stateVector"> & {
	data: string;
	stateVector: string;
};

type WireUpdateBatch = Omit<YjsUpdateBatch, "updates"> & {
	updates: string[];
};

function notePath(note: NoteRef, suffix: string): string {
	return `/v1/spaces/${encodeURIComponent(note.spaceId)}/notes/${encodeURIComponent(note.noteId)}${suffix}`;
}

function jsonInit(method: string, body: unknown): RequestInit {
	return {
		method,
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	};
}

function encodeBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(
			...bytes.subarray(offset, offset + chunkSize),
		);
	}
	return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

function decodeSnapshot(value: WireSnapshot): YjsSnapshot {
	return {
		...value,
		data: decodeBase64(value.data),
		stateVector: decodeBase64(value.stateVector),
	};
}

function decodeUpdateBatch(value: WireUpdateBatch): YjsUpdateBatch {
	return { ...value, updates: value.updates.map(decodeBase64) };
}

export async function testPersonalServerConnection(args: {
	endpoint: string;
	serverId?: string;
	connectionId?: string;
}) {
	const endpoint = normalizePersonalServerEndpoint(args.endpoint);
	const capabilities = await discoverPersonalServer(endpoint);
	if (args.serverId && args.serverId !== capabilities.serverId) {
		throw new PersonalServerError(
			409,
			"server_id_changed",
			"This endpoint is a different server than the saved connection.",
		);
	}
	let paired = false;
	if (args.connectionId) {
		const credential = await readPersonalServerCredential(args.connectionId);
		if (credential) {
			const response = await fetch(`${endpoint}/v1/session`, {
				headers: { authorization: `Bearer ${credential}` },
			});
			paired = response.ok;
		}
	}
	return { capabilities, paired };
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(url, { ...init, cache: "no-store" });
	if (!response.ok) throw await toPersonalServerError(response);
	return (await response.json()) as T;
}

async function toPersonalServerError(
	response: Response,
): Promise<PersonalServerError> {
	try {
		const body = (await response.json()) as {
			error?: unknown;
			message?: unknown;
		};
		const code = typeof body.error === "string" ? body.error : "http_error";
		const message = typeof body.message === "string" ? body.message : code;
		return new PersonalServerError(response.status, code, message);
	} catch {
		return new PersonalServerError(
			response.status,
			"http_error",
			`Personal server request failed with HTTP ${response.status}.`,
		);
	}
}
