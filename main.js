const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const http = require("node:http");
const nodeCrypto = require("node:crypto");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const Y = require("yjs");

let keytar;

try {
	keytar = require("keytar");
} catch {
	keytar = null;
}

const loadLocalEnv = () => {
	const loadEnvFile = (fileName, override = false) => {
		const envPath = path.join(__dirname, fileName);

		try {
			const env = fsSync.readFileSync(envPath, "utf8");

			for (const line of env.split(/\r?\n/)) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith("#")) continue;

				const separatorIndex = trimmed.indexOf("=");
				if (separatorIndex === -1) continue;

				const key = trimmed.slice(0, separatorIndex).trim();
				const rawValue = trimmed.slice(separatorIndex + 1).trim();
				const value = rawValue.replace(/^(['"])(.*)\1$/, "$2");

				if (key && (override || process.env[key] === undefined)) {
					process.env[key] = value;
				}
			}
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
	};

	loadEnvFile(".env");
	loadEnvFile(".env.local", true);
};

loadLocalEnv();

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
let mainWindow; // hoist ke luar
const popoutWindows = new Map(); // key: notePath, value: BrowserWindow
let pendingAuthCallbackUrl;
let workspaceWatchTimer;
const workspaceWatchers = new Map();
let indexDb;
let legacyMigrationPromise;
const legacyPathMigrations = new Map();

const workspaceRoot = () => path.join(app.getPath("documents"), "Paperite");
const statePath = () => path.join(workspaceRoot(), ".paperite", "state.json");
const indexPath = () => path.join(workspaceRoot(), ".paperite", "index.sqlite");
const revisionsRoot = () =>
	path.join(workspaceRoot(), ".paperite", "revisions");
const syncRoot = () => path.join(workspaceRoot(), ".paperite", "sync");
const syncNotesRoot = () => path.join(syncRoot(), "notes");
const googleDriveTokenPath = () =>
	path.join(syncRoot(), "google-drive-token.json");
const syncPreferencesPath = () => path.join(syncRoot(), "preferences.json");
const tombstonesPath = () =>
	path.join(workspaceRoot(), ".paperite", "tombstones.jsonl");

const googleDriveScope = "https://www.googleapis.com/auth/drive.appdata";
const googleOauthSessions = new Map();
const keychainService = "dev.iydheko.paperite";
const googleDriveTokenAccount = "google-drive-token";

const normalizeRelativePath = (relativePath = "") => {
	const normalized = path
		.normalize(relativePath)
		.replace(/^(\.\.(\/|\\|$))+/, "");
	if (path.isAbsolute(normalized)) {
		throw new Error("absolute paths are not allowed");
	}
	return normalized === "." ? "" : normalized;
};

const resolveWorkspacePath = (relativePath = "") => {
	const root = workspaceRoot();
	const target = path.resolve(root, normalizeRelativePath(relativePath));

	if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
		throw new Error("path escapes workspace");
	}

	return target;
};

const ensureWorkspace = async () => {
	await fs.mkdir(path.join(workspaceRoot(), "Inbox"), { recursive: true });
	await fs.mkdir(path.dirname(statePath()), { recursive: true });
	await fs.mkdir(revisionsRoot(), { recursive: true });
	await fs.mkdir(syncNotesRoot(), { recursive: true });
};

const writeFileAtomic = async (targetPath, content) => {
	const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;

	try {
		await fs.writeFile(
			temporaryPath,
			content,
			typeof content === "string" ? "utf8" : undefined,
		);
		await fs.rename(temporaryPath, targetPath);
	} catch (error) {
		await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
		throw error;
	}
};

const noteFileExtension = ".json";
const noteManifestFilename = "note.json";
const noteAssetsDirectoryName = "assets";
const toPosixRelativePath = (relativePath = "") =>
	normalizeRelativePath(relativePath).replaceAll(path.sep, "/");
const isNoteManifestPath = (itemPath) =>
	path.posix.basename(itemPath) === noteManifestFilename;
const noteContentPath = (notePath) =>
	path.posix.join(toPosixRelativePath(notePath), noteManifestFilename);
const resolveNoteContentPath = (notePath) =>
	resolveWorkspacePath(noteContentPath(notePath));
const noteAssetsPath = (notePath) =>
	path.posix.join(toPosixRelativePath(notePath), noteAssetsDirectoryName);
const currentNotePath = (notePath) => {
	const normalized = toPosixRelativePath(notePath);
	return legacyPathMigrations.get(normalized) ?? normalized;
};
const isNoteFilePath = (itemPath) =>
	/\.json$/i.test(itemPath) && !isNoteManifestPath(itemPath);
const isLegacyMarkdownPath = (itemPath) => /\.md$/i.test(itemPath);
const isMigratableNotePath = (itemPath) =>
	isNoteFilePath(itemPath) || isLegacyMarkdownPath(itemPath);
const toNoteTitle = (filename) => filename.replace(/\.(?:json|md)$/i, "");

const createEmptyNoteContent = (title) => ({
	id: crypto.randomUUID(),
	type: "doc",
	...(title ? { title } : {}),
	content: [{ type: "paragraph" }],
});

const isUuidFilename = (notePath) =>
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.json)?$/i.test(
		path.posix.basename(notePath),
	);

const readNoteTitle = (content) => {
	const normalized = normalizeNoteContent(content);
	return typeof normalized.title === "string" ? normalized.title : "";
};

const isNoteDirectory = async (notePath) => {
	try {
		const stats = await fs.stat(resolveNoteContentPath(notePath));
		return stats.isFile();
	} catch (error) {
		if (error?.code === "ENOENT") return false;
		throw error;
	}
};

const ensureNoteDirectory = async (notePath) => {
	await fs.mkdir(resolveWorkspacePath(notePath), { recursive: true });
	await fs.mkdir(resolveWorkspacePath(noteAssetsPath(notePath)), {
		recursive: true,
	});
};

const isPlainObject = (value) =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const textToNoteContent = (text) => ({
	type: "doc",
	content: text.split(/\r?\n/).map((line) => ({
		type: "paragraph",
		content: line ? [{ type: "text", text: line }] : undefined,
	})),
});

const normalizeNoteContent = (content) => {
	if (isPlainObject(content) && typeof content.type === "string") {
		return content;
	}

	if (typeof content === "string") return textToNoteContent(content);

	return createEmptyNoteContent();
};

const serializeNoteContent = (content) =>
	JSON.stringify(normalizeNoteContent(content), null, 2);

const collectNoteText = (node, chunks) => {
	if (typeof node?.text === "string") chunks.push(node.text);

	for (const child of node?.content ?? []) collectNoteText(child, chunks);

	if (
		node?.type === "paragraph" ||
		node?.type === "heading" ||
		node?.type === "blockquote" ||
		node?.type === "codeBlock" ||
		node?.type === "listItem" ||
		node?.type === "taskItem"
	) {
		if (chunks.at(-1) !== "\n") chunks.push("\n");
	}
};

const noteContentText = (content) => {
	const chunks = [];
	collectNoteText(normalizeNoteContent(content), chunks);
	return chunks.join("").replace(/\n+$/g, "");
};

const toNotePreviewFromContent = (content) =>
	noteContentText(content)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find(Boolean) ?? "";

const readNoteContent = async (notePath, ensureId) => {
	const normalizedPath = currentNotePath(notePath);
	const rawContent = await fs.readFile(
		isMigratableNotePath(normalizedPath)
			? resolveWorkspacePath(normalizedPath)
			: resolveNoteContentPath(normalizedPath),
		"utf8",
	);
	const trimmedContent = rawContent.trim();

	if (!trimmedContent) return createEmptyNoteContent();

	if (isLegacyMarkdownPath(normalizedPath)) {
		const content = textToNoteContent(rawContent);
		if (ensureId && !content.id) content.id = crypto.randomUUID();
		return content;
	}

	try {
		const content = normalizeNoteContent(JSON.parse(rawContent));
		if (ensureId && !content.id) content.id = crypto.randomUUID();
		return content;
	} catch {
		const content = textToNoteContent(rawContent);
		if (ensureId && !content.id) content.id = crypto.randomUUID();
		return content;
	}
};

const syncNoteId = (notePath, content) => {
	const normalized = normalizeNoteContent(content);
	return typeof normalized.id === "string" && normalized.id
		? normalized.id
		: revisionKey(currentNotePath(notePath));
};

const syncNoteDirectory = (noteId) => path.join(syncNotesRoot(), noteId);
const syncNoteSnapshotPath = (noteId) =>
	path.join(syncNoteDirectory(noteId), "snapshot.bin");
const syncNoteStateVectorPath = (noteId) =>
	path.join(syncNoteDirectory(noteId), "state-vector.bin");
const syncNoteManifestPath = (noteId) =>
	path.join(syncNoteDirectory(noteId), "manifest.json");
const syncNoteUpdatesDirectory = (noteId) =>
	path.join(syncNoteDirectory(noteId), "updates");

const writeYNoteContent = (doc, content) => {
	const normalized = normalizeNoteContent(content);
	const { id, title, ...body } = normalized;
	const metadata = doc.getMap("metadata");
	const noteContent = doc.getMap("content");

	doc.transact(() => {
		if (typeof id === "string") metadata.set("id", id);
		if (typeof title === "string") metadata.set("title", title);
		metadata.set("updatedAt", Date.now());
		noteContent.set("body", body);
	});
};

const encodeYNoteFromContent = (content) => {
	const doc = new Y.Doc();
	writeYNoteContent(doc, content);

	return {
		state: Buffer.from(Y.encodeStateAsUpdate(doc)),
		stateVector: Buffer.from(Y.encodeStateVector(doc)),
	};
};

const writeLocalYNoteSnapshot = async (notePath, content) => {
	const normalizedContent = normalizeNoteContent(content);
	if (!normalizedContent.id) normalizedContent.id = crypto.randomUUID();

	const noteId = syncNoteId(notePath, normalizedContent);
	const noteDirectory = syncNoteDirectory(noteId);
	const updatesDirectory = syncNoteUpdatesDirectory(noteId);
	const encoded = encodeYNoteFromContent(normalizedContent);
	const now = Date.now();

	await fs.mkdir(updatesDirectory, { recursive: true });
	await writeFileAtomic(syncNoteSnapshotPath(noteId), encoded.state);
	await writeFileAtomic(syncNoteStateVectorPath(noteId), encoded.stateVector);
	await writeFileAtomic(
		path.join(updatesDirectory, `${now}-${process.pid}.bin`),
		encoded.state,
	);
	await writeFileAtomic(
		syncNoteManifestPath(noteId),
		JSON.stringify(
			{
				format: "yjs-v1",
				noteId,
				path: currentNotePath(notePath),
				updatedAt: now,
				snapshot: path.relative(noteDirectory, syncNoteSnapshotPath(noteId)),
				stateVector: path.relative(
					noteDirectory,
					syncNoteStateVectorPath(noteId),
				),
			},
			null,
			2,
		),
	);

	return { noteId, updatedAt: now };
};

const ensureLocalYNoteSnapshot = async (notePath, content) => {
	const noteId = syncNoteId(notePath, content);

	try {
		await fs.access(syncNoteSnapshotPath(noteId));
		return;
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}

	await writeLocalYNoteSnapshot(notePath, content);
};

const readLocalYNoteState = async (notePath) => {
	const normalizedPath = currentNotePath(notePath);
	const content = await readNoteContent(normalizedPath, true);
	await ensureLocalYNoteSnapshot(normalizedPath, content);

	const noteId = syncNoteId(normalizedPath, content);
	const snapshot = await fs.readFile(syncNoteSnapshotPath(noteId));

	return {
		noteId,
		format: "yjs-v1",
		snapshot: new Uint8Array(snapshot),
	};
};

const appendLocalYNoteUpdate = async (notePath, update) => {
	const normalizedPath = currentNotePath(notePath);
	const content = await readNoteContent(normalizedPath, true);
	await ensureLocalYNoteSnapshot(normalizedPath, content);

	const noteId = syncNoteId(normalizedPath, content);
	const noteDirectory = syncNoteDirectory(noteId);
	const updatesDirectory = syncNoteUpdatesDirectory(noteId);
	const updateBuffer = Buffer.from(update);
	const now = Date.now();
	const doc = new Y.Doc();
	const existingSnapshot = await fs.readFile(syncNoteSnapshotPath(noteId));

	Y.applyUpdate(doc, existingSnapshot);
	Y.applyUpdate(doc, updateBuffer);

	const snapshot = Buffer.from(Y.encodeStateAsUpdate(doc));
	const stateVector = Buffer.from(Y.encodeStateVector(doc));

	await fs.mkdir(updatesDirectory, { recursive: true });
	await writeFileAtomic(
		path.join(updatesDirectory, `${now}-${process.pid}.bin`),
		updateBuffer,
	);
	await writeFileAtomic(syncNoteSnapshotPath(noteId), snapshot);
	await writeFileAtomic(syncNoteStateVectorPath(noteId), stateVector);
	await writeFileAtomic(
		syncNoteManifestPath(noteId),
		JSON.stringify(
			{
				format: "yjs-v1",
				noteId,
				path: normalizedPath,
				updatedAt: now,
				snapshot: path.relative(noteDirectory, syncNoteSnapshotPath(noteId)),
				stateVector: path.relative(
					noteDirectory,
					syncNoteStateVectorPath(noteId),
				),
			},
			null,
			2,
		),
	);

	return { ok: true, noteId, updatedAt: now };
};

const writeDerivedNoteContent = async (notePath, content) => {
	const normalizedPath = currentNotePath(notePath);
	const normalizedContent = normalizeNoteContent(content);

	if (!normalizedContent.id || !normalizedContent.title) {
		try {
			const existingContent = await readNoteContent(normalizedPath, true);
			if (!normalizedContent.id && existingContent.id) {
				normalizedContent.id = existingContent.id;
			}
			if (!normalizedContent.title && existingContent.title) {
				normalizedContent.title = existingContent.title;
			}
		} catch {
			// Keep the derived payload as-is when the manifest is missing.
		}
	}

	if (!normalizedContent.id) normalizedContent.id = crypto.randomUUID();

	await ensureNoteDirectory(normalizedPath);
	await writeRevisionSnapshot(normalizedPath, normalizedContent);
	await writeFileAtomic(
		resolveNoteContentPath(normalizedPath),
		serializeNoteContent(normalizedContent),
	);
	const stats = await fs.stat(resolveNoteContentPath(normalizedPath));
	await getIndexedNote(normalizedPath, stats);

	return { ok: true };
};

const googleDriveClientId = () =>
	process.env.PAPERITE_GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;

const googleDriveClientSecret = () => process.env.PAPERITE_GOOGLE_CLIENT_SECRET;

const base64Url = (buffer) =>
	Buffer.from(buffer)
		.toString("base64")
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/g, "");

const createPkceVerifier = () => base64Url(nodeCrypto.randomBytes(32));

const createPkceChallenge = (verifier) =>
	base64Url(nodeCrypto.createHash("sha256").update(verifier).digest());

const readGoogleDriveToken = async () => {
	if (keytar) {
		const keychainToken = await keytar.getPassword(
			keychainService,
			googleDriveTokenAccount,
		);
		if (keychainToken) return JSON.parse(keychainToken);
	}

	try {
		const legacyToken = JSON.parse(
			await fs.readFile(googleDriveTokenPath(), "utf8"),
		);
		if (!keytar) return legacyToken;

		await keytar.setPassword(
			keychainService,
			googleDriveTokenAccount,
			JSON.stringify(legacyToken),
		);
		await fs.rm(googleDriveTokenPath(), { force: true });
		return legacyToken;
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw error;
	}
};

const defaultSyncPreferences = {
	googleDriveEnabled: false,
};

const readSyncPreferences = async () => {
	try {
		const preferences = JSON.parse(
			await fs.readFile(syncPreferencesPath(), "utf8"),
		);
		return {
			...defaultSyncPreferences,
			...(isPlainObject(preferences) ? preferences : {}),
			googleDriveEnabled: preferences?.googleDriveEnabled === true,
		};
	} catch (error) {
		if (error?.code === "ENOENT") return defaultSyncPreferences;
		throw error;
	}
};

const writeSyncPreferences = async (preferences) => {
	const nextPreferences = {
		...defaultSyncPreferences,
		...preferences,
		googleDriveEnabled: preferences?.googleDriveEnabled === true,
	};
	await fs.mkdir(path.dirname(syncPreferencesPath()), { recursive: true });
	await writeFileAtomic(
		syncPreferencesPath(),
		JSON.stringify(nextPreferences, null, 2),
	);
	mainWindow?.webContents.send("sync:changed");
	return nextPreferences;
};

const writeGoogleDriveToken = async (token) => {
	if (!keytar) {
		throw new Error(
			"OS keychain is unavailable for Google Drive token storage",
		);
	}

	await keytar.setPassword(
		keychainService,
		googleDriveTokenAccount,
		JSON.stringify(token),
	);
	await fs.rm(googleDriveTokenPath(), { force: true });
};

const deleteGoogleDriveToken = async () => {
	if (keytar) {
		await keytar.deletePassword(keychainService, googleDriveTokenAccount);
	}
	await fs.rm(googleDriveTokenPath(), { force: true });
};

const getGoogleDriveStatus = async () => {
	const token = await readGoogleDriveToken();
	const preferences = await readSyncPreferences();
	return {
		configured: Boolean(googleDriveClientId()),
		connected: Boolean(token?.refresh_token || token?.access_token),
		enabled: preferences.googleDriveEnabled,
		expiresAt: token?.expires_at ?? null,
	};
};

const exchangeGoogleToken = async (body) => {
	const response = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(body),
	});

	if (!response.ok) {
		let details = "";
		try {
			const errorBody = await response.json();
			details = errorBody.error_description || errorBody.error || "";
		} catch {
			details = await response.text().catch(() => "");
		}

		throw new Error(
			`google token request failed: ${response.status}${details ? ` (${details})` : ""}`,
		);
	}

	const token = await response.json();
	return {
		...token,
		expires_at: token.expires_in
			? Date.now() + token.expires_in * 1000
			: undefined,
	};
};

const startGoogleDriveConnection = async () => {
	const clientId = googleDriveClientId();
	if (!clientId) {
		return { ok: false, error: "missing_google_client_id" };
	}

	const state = base64Url(nodeCrypto.randomBytes(24));
	const verifier = createPkceVerifier();
	const challenge = createPkceChallenge(verifier);
	const server = http.createServer((request, response) => {
		const requestUrl = new URL(
			request.url ?? "/",
			`http://${request.headers.host}`,
		);

		if (requestUrl.pathname !== "/callback") {
			response.writeHead(404);
			response.end("Not found");
			return;
		}

		completeGoogleDriveConnection(requestUrl.toString())
			.then(() => {
				response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
				response.end(
					"<h1>Paperite connected to Google Drive</h1><p>You can close this tab.</p>",
				);
			})
			.catch((error) => {
				mainWindow?.webContents.send("sync:changed", {
					error: error instanceof Error ? error.message : "Unknown error",
				});
				response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
				response.end(
					`<h1>Paperite Google Drive connection failed</h1><p>${error instanceof Error ? error.message : "Unknown error"}</p>`,
				);
			})
			.finally(() => server.close());
	});

	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		server.close();
		throw new Error("could not start google oauth callback server");
	}

	const redirectUri = `http://127.0.0.1:${address.port}/callback`;
	googleOauthSessions.set(state, {
		verifier,
		redirectUri,
		createdAt: Date.now(),
	});

	const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
	url.searchParams.set("client_id", clientId);
	url.searchParams.set("redirect_uri", redirectUri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", googleDriveScope);
	url.searchParams.set("access_type", "offline");
	url.searchParams.set("prompt", "consent");
	url.searchParams.set("code_challenge", challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", state);

	await shell.openExternal(url.toString());
	return { ok: true };
};

const completeGoogleDriveConnection = async (callbackUrl) => {
	const clientId = googleDriveClientId();
	if (!clientId) throw new Error("missing google client id");

	const url = new URL(callbackUrl);
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const session = state ? googleOauthSessions.get(state) : null;

	if (!code || !state || !session)
		throw new Error("invalid google oauth state");
	googleOauthSessions.delete(state);

	const tokenRequest = {
		client_id: clientId,
		code,
		code_verifier: session.verifier,
		grant_type: "authorization_code",
		redirect_uri: session.redirectUri,
	};
	const clientSecret = googleDriveClientSecret();
	if (clientSecret) tokenRequest.client_secret = clientSecret;

	const token = await exchangeGoogleToken(tokenRequest);

	await writeGoogleDriveToken(token);
	mainWindow?.webContents.send("sync:changed");
};

const getGoogleDriveAccessToken = async () => {
	const clientId = googleDriveClientId();
	if (!clientId) throw new Error("missing google client id");

	const token = await readGoogleDriveToken();
	if (!token) throw new Error("google drive is not connected");
	if (
		token.access_token &&
		token.expires_at &&
		token.expires_at > Date.now() + 60_000
	) {
		return token.access_token;
	}
	if (!token.refresh_token) throw new Error("google refresh token is missing");

	const refreshRequest = {
		client_id: clientId,
		grant_type: "refresh_token",
		refresh_token: token.refresh_token,
	};
	const clientSecret = googleDriveClientSecret();
	if (clientSecret) refreshRequest.client_secret = clientSecret;

	const refreshed = await exchangeGoogleToken(refreshRequest);
	const nextToken = {
		...token,
		...refreshed,
		refresh_token: refreshed.refresh_token ?? token.refresh_token,
	};
	await writeGoogleDriveToken(nextToken);
	return nextToken.access_token;
};

const googleDriveRequest = async (url, options = {}) => {
	const accessToken = await getGoogleDriveAccessToken();
	const response = await fetch(url, {
		...options,
		headers: {
			...(options.headers ?? {}),
			authorization: `Bearer ${accessToken}`,
		},
	});

	if (!response.ok) {
		throw new Error(`google drive request failed: ${response.status}`);
	}

	return response;
};

const listGoogleDriveFiles = async (noteId) => {
	const query = [
		"trashed = false",
		"'appDataFolder' in parents",
		`appProperties has { key='noteId' and value='${noteId.replaceAll("'", "\\'")}' }`,
	].join(" and ");
	const url = new URL("https://www.googleapis.com/drive/v3/files");
	url.searchParams.set("spaces", "appDataFolder");
	url.searchParams.set("fields", "files(id,name,appProperties,modifiedTime)");
	url.searchParams.set("q", query);

	const response = await googleDriveRequest(url.toString());
	return (await response.json()).files ?? [];
};

const listAllGoogleDriveSyncFiles = async () => {
	const query = [
		"trashed = false",
		"'appDataFolder' in parents",
		"appProperties has { key='provider' and value='paperite' }",
	].join(" and ");
	const url = new URL("https://www.googleapis.com/drive/v3/files");
	url.searchParams.set("spaces", "appDataFolder");
	url.searchParams.set("fields", "files(id,name,appProperties,modifiedTime)");
	url.searchParams.set("q", query);

	const response = await googleDriveRequest(url.toString());
	return (await response.json()).files ?? [];
};

const groupGoogleDriveFilesByNote = (files) => {
	const groups = new Map();

	for (const file of files) {
		const noteId = file.appProperties?.noteId;
		if (!noteId) continue;

		groups.set(noteId, [...(groups.get(noteId) ?? []), file]);
	}

	return groups;
};

const uploadGoogleDriveFile = async ({ name, appProperties, content }) => {
	const files = await listGoogleDriveFiles(appProperties.noteId);
	const existing = files.find((file) => file.name === name);
	if (existing) return existing;

	const boundary = `paperite-${nodeCrypto.randomUUID()}`;
	const metadata = {
		name,
		parents: ["appDataFolder"],
		appProperties,
	};
	const body = Buffer.concat([
		Buffer.from(
			`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n`,
		),
		Buffer.from(content),
		Buffer.from(`\r\n--${boundary}--`),
	]);

	const response = await googleDriveRequest(
		"https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,appProperties,modifiedTime",
		{
			method: "POST",
			headers: { "content-type": `multipart/related; boundary=${boundary}` },
			body,
		},
	);
	return response.json();
};

const downloadGoogleDriveFile = async (fileId) => {
	const response = await googleDriveRequest(
		`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
	);
	return Buffer.from(await response.arrayBuffer());
};

const listLocalSyncNotes = async () => {
	await ensureWorkspace();
	const entries = await fs.readdir(syncNotesRoot(), { withFileTypes: true });
	const notes = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		try {
			const manifest = JSON.parse(
				await fs.readFile(syncNoteManifestPath(entry.name), "utf8"),
			);
			notes.push({ noteId: entry.name, manifest });
		} catch {
			// Ignore partial local sync directories.
		}
	}

	return notes;
};

const applyRemoteYjsFile = async ({
	noteId,
	notePath,
	updateName,
	content,
}) => {
	await ensureNoteDirectory(notePath);

	try {
		await fs.access(resolveNoteContentPath(notePath));
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
		const content = createEmptyNoteContent(path.posix.basename(notePath));
		content.id = noteId;
		await writeFileAtomic(
			resolveNoteContentPath(notePath),
			serializeNoteContent(content),
		);
	}

	const syncDirectory = syncNoteDirectory(noteId);
	const updatesDirectory = syncNoteUpdatesDirectory(noteId);
	await fs.mkdir(updatesDirectory, { recursive: true });

	const doc = new Y.Doc();
	try {
		Y.applyUpdate(doc, await fs.readFile(syncNoteSnapshotPath(noteId)));
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
	Y.applyUpdate(doc, content);

	await writeFileAtomic(path.join(updatesDirectory, updateName), content);
	await writeFileAtomic(
		syncNoteSnapshotPath(noteId),
		Buffer.from(Y.encodeStateAsUpdate(doc)),
	);
	await writeFileAtomic(
		syncNoteStateVectorPath(noteId),
		Buffer.from(Y.encodeStateVector(doc)),
	);
	await writeFileAtomic(
		syncNoteManifestPath(noteId),
		JSON.stringify(
			{
				format: "yjs-v1",
				noteId,
				path: notePath,
				updatedAt: Date.now(),
				snapshot: path.relative(syncDirectory, syncNoteSnapshotPath(noteId)),
				stateVector: path.relative(
					syncDirectory,
					syncNoteStateVectorPath(noteId),
				),
			},
			null,
			2,
		),
	);
};

const syncGoogleDrive = async () => {
	const status = await getGoogleDriveStatus();
	if (!status.enabled) return { ok: false, error: "google_drive_disabled" };
	if (!status.configured)
		return { ok: false, error: "missing_google_client_id" };
	if (!status.connected)
		return { ok: false, error: "google_drive_not_connected" };

	const localNotes = await listLocalSyncNotes();
	const localNoteIds = new Set(localNotes.map((note) => note.noteId));
	const remoteFilesByNote = groupGoogleDriveFilesByNote(
		await listAllGoogleDriveSyncFiles(),
	);
	let uploaded = 0;
	let downloaded = 0;

	for (const { noteId, manifest } of localNotes) {
		const remoteFiles = remoteFilesByNote.get(noteId) ?? [];
		const remoteNames = new Set(remoteFiles.map((file) => file.name));
		const baseProperties = { provider: "paperite", noteId };

		const snapshot = await fs.readFile(syncNoteSnapshotPath(noteId));
		if (!remoteNames.has("snapshot.bin")) {
			await uploadGoogleDriveFile({
				name: "snapshot.bin",
				appProperties: {
					...baseProperties,
					kind: "snapshot",
					path: manifest.path,
				},
				content: snapshot,
			});
			uploaded += 1;
		}

		const updatesDirectory = syncNoteUpdatesDirectory(noteId);
		const updateEntries = await fs
			.readdir(updatesDirectory, { withFileTypes: true })
			.catch(() => []);
		for (const entry of updateEntries) {
			if (!entry.isFile() || remoteNames.has(entry.name)) continue;
			await uploadGoogleDriveFile({
				name: entry.name,
				appProperties: {
					...baseProperties,
					kind: "update",
					path: manifest.path,
				},
				content: await fs.readFile(path.join(updatesDirectory, entry.name)),
			});
			uploaded += 1;
		}

		for (const file of remoteFiles.filter(
			(remote) => remote.appProperties?.kind === "update",
		)) {
			const localPath = path.join(updatesDirectory, file.name);
			try {
				await fs.access(localPath);
				continue;
			} catch (error) {
				if (error?.code !== "ENOENT") throw error;
			}

			await applyRemoteYjsFile({
				noteId,
				notePath: manifest.path,
				updateName: file.name,
				content: await downloadGoogleDriveFile(file.id),
			});
			downloaded += 1;
		}
	}

	for (const [noteId, remoteFiles] of remoteFilesByNote) {
		if (localNoteIds.has(noteId)) continue;

		const notePath =
			remoteFiles.find((file) => file.appProperties?.path)?.appProperties
				?.path ?? path.posix.join("Inbox", noteId);
		const orderedFiles = [
			...remoteFiles.filter((file) => file.appProperties?.kind === "snapshot"),
			...remoteFiles.filter((file) => file.appProperties?.kind === "update"),
		];

		for (const file of orderedFiles) {
			await applyRemoteYjsFile({
				noteId,
				notePath,
				updateName: file.name === "snapshot.bin" ? `${file.id}.bin` : file.name,
				content: await downloadGoogleDriveFile(file.id),
			});
			downloaded += 1;
		}
	}

	return { ok: true, uploaded, downloaded };
};

const revisionKey = (notePath) => Buffer.from(notePath).toString("base64url");

const writeRevisionSnapshot = async (notePath, nextContent) => {
	const normalizedPath = currentNotePath(notePath);

	try {
		const currentContent = await readNoteContent(normalizedPath);
		const currentSerialized = serializeNoteContent(currentContent);
		const nextSerialized = serializeNoteContent(nextContent);
		if (currentSerialized === nextSerialized) return;

		const revisionDirectory = path.join(
			revisionsRoot(),
			revisionKey(normalizedPath),
		);
		await fs.mkdir(revisionDirectory, { recursive: true });
		await writeFileAtomic(
			path.join(revisionDirectory, `${Date.now()}${noteFileExtension}`),
			currentSerialized,
		);
	} catch (error) {
		if (error?.code === "ENOENT") return;
		throw error;
	}
};

const collectDeletedNotes = async (itemPath) => {
	const normalizedPath = currentNotePath(itemPath);
	const absolutePath = resolveWorkspacePath(normalizedPath);

	try {
		const stats = await fs.stat(absolutePath);

		if (stats.isFile()) {
			return isMigratableNotePath(normalizedPath) ? [normalizedPath] : [];
		}

		if (!stats.isDirectory()) return [];
		if (await isNoteDirectory(normalizedPath)) return [normalizedPath];

		const entries = await fs.readdir(absolutePath, { withFileTypes: true });
		const deletedNotes = [];

		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;

			deletedNotes.push(
				...(await collectDeletedNotes(
					path.posix.join(normalizedPath, entry.name),
				)),
			);
		}

		return deletedNotes;
	} catch (error) {
		if (error?.code === "ENOENT") return [];
		throw error;
	}
};

const appendTombstones = async (notePaths) => {
	if (notePaths.length === 0) return;

	const deletedAt = Date.now();
	const lines = notePaths
		.map((notePath) => JSON.stringify({ path: notePath, deletedAt }))
		.join("\n");

	await fs.appendFile(tombstonesPath(), `${lines}\n`, "utf8");
};

const createNoteId = (notePath) => revisionKey(notePath);

const createAvailableNoteId = (db, notePath) => {
	const baseId = createNoteId(notePath);
	let candidate = baseId;
	let suffix = 1;

	while (db.prepare("SELECT 1 FROM notes WHERE id = ?").get(candidate)) {
		candidate = `${baseId}-${suffix}`;
		suffix += 1;
	}

	return candidate;
};

const nodeTextContent = (node) => {
	const chunks = [];
	collectNoteText(node, chunks);
	return chunks.join("").replace(/\n+$/g, "").trim();
};

const extractNoteMetadata = (content) => {
	const headings = [];
	const tasks = [];
	const tags = new Set();
	const backlinks = new Set();
	let line = 1;

	const visit = (node) => {
		if (!node) return;

		if (node.type === "heading") {
			headings.push({
				depth: Number(node.attrs?.level) || 1,
				text: nodeTextContent(node),
				line,
			});
		}

		if (node.type === "taskItem") {
			tasks.push({
				checked: node.attrs?.checked === true,
				text: nodeTextContent(node),
				line,
			});
		}

		for (const child of node.content ?? []) visit(child);

		if (
			node.type === "paragraph" ||
			node.type === "heading" ||
			node.type === "blockquote" ||
			node.type === "codeBlock" ||
			node.type === "listItem" ||
			node.type === "taskItem"
		) {
			line += 1;
		}
	};

	visit(normalizeNoteContent(content));

	for (const textLine of noteContentText(content).split(/\r?\n/)) {
		for (const match of textLine.matchAll(/(?:^|[\s(])#([A-Za-z0-9_/-]+)/g)) {
			tags.add(match[1]);
		}

		for (const match of textLine.matchAll(
			/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g,
		)) {
			backlinks.add(match[1].trim());
		}
	}

	return {
		headings,
		tasks,
		tags: [...tags],
		backlinks: [...backlinks],
	};
};

const addColumnIfMissing = (db, table, column, definition) => {
	const columns = db.prepare(`PRAGMA table_info(${table})`).all();

	if (columns.some((existingColumn) => existingColumn.name === column)) return;

	db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
};

const getIndexDb = async () => {
	if (indexDb) return indexDb;

	await ensureWorkspace();
	indexDb = new DatabaseSync(indexPath());
	indexDb.exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA synchronous = NORMAL;
		CREATE TABLE IF NOT EXISTS notes (
			id TEXT NOT NULL UNIQUE,
			path TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			preview TEXT NOT NULL,
			mtime_ms REAL NOT NULL,
			size INTEGER NOT NULL,
			indexed_at INTEGER NOT NULL,
			sync_status TEXT NOT NULL DEFAULT 'local',
			sync_version INTEGER NOT NULL DEFAULT 0,
			remote_id TEXT,
			last_synced_at INTEGER
		);
		CREATE TABLE IF NOT EXISTS note_headings (
			note_id TEXT NOT NULL,
			depth INTEGER NOT NULL,
			text TEXT NOT NULL,
			line INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS note_tags (
			note_id TEXT NOT NULL,
			tag TEXT NOT NULL,
			PRIMARY KEY (note_id, tag)
		);
		CREATE TABLE IF NOT EXISTS note_tasks (
			note_id TEXT NOT NULL,
			text TEXT NOT NULL,
			checked INTEGER NOT NULL,
			line INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS note_backlinks (
			note_id TEXT NOT NULL,
			target TEXT NOT NULL,
			PRIMARY KEY (note_id, target)
		);
		CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5(
			path UNINDEXED,
			title,
			content
		);
	`);
	addColumnIfMissing(indexDb, "notes", "id", "id TEXT");
	addColumnIfMissing(
		indexDb,
		"notes",
		"sync_status",
		"sync_status TEXT NOT NULL DEFAULT 'local'",
	);
	addColumnIfMissing(
		indexDb,
		"notes",
		"sync_version",
		"sync_version INTEGER NOT NULL DEFAULT 0",
	);
	addColumnIfMissing(indexDb, "notes", "remote_id", "remote_id TEXT");
	addColumnIfMissing(
		indexDb,
		"notes",
		"last_synced_at",
		"last_synced_at INTEGER",
	);
	indexDb.exec("CREATE UNIQUE INDEX IF NOT EXISTS notes_id_idx ON notes(id)");

	return indexDb;
};

const getIndexedNote = async (notePath, stats) => {
	const normalizedPath = currentNotePath(notePath);
	const db = await getIndexDb();
	const existing = db
		.prepare(
			"SELECT id, title, preview, mtime_ms AS mtimeMs, size FROM notes WHERE path = ?",
		)
		.get(normalizedPath);

	if (
		existing?.id &&
		existing.mtimeMs === stats.mtimeMs &&
		existing.size === stats.size
	) {
		return {
			title: existing.title,
			preview: existing.preview,
			updatedAt: existing.mtimeMs,
		};
	}

	const content = await readNoteContent(normalizedPath);
	const plainText = noteContentText(content);
	const id = existing?.id || createAvailableNoteId(db, normalizedPath);
	const title =
		readNoteTitle(content) || toNoteTitle(path.posix.basename(normalizedPath));
	const preview = toNotePreviewFromContent(content);
	const metadata = extractNoteMetadata(content);

	db.prepare(`
		INSERT INTO notes (id, path, title, preview, mtime_ms, size, indexed_at, sync_status, sync_version)
		VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT sync_status FROM notes WHERE path = ?), 'local'), COALESCE((SELECT sync_version FROM notes WHERE path = ?), 0) + 1)
		ON CONFLICT(path) DO UPDATE SET
			id = excluded.id,
			title = excluded.title,
			preview = excluded.preview,
			mtime_ms = excluded.mtime_ms,
			size = excluded.size,
			indexed_at = excluded.indexed_at,
			sync_status = excluded.sync_status,
			sync_version = excluded.sync_version
	`).run(
		id,
		normalizedPath,
		title,
		preview,
		stats.mtimeMs,
		stats.size,
		Date.now(),
		normalizedPath,
		normalizedPath,
	);
	db.prepare("DELETE FROM note_headings WHERE note_id = ?").run(id);
	db.prepare("DELETE FROM note_tags WHERE note_id = ?").run(id);
	db.prepare("DELETE FROM note_tasks WHERE note_id = ?").run(id);
	db.prepare("DELETE FROM note_backlinks WHERE note_id = ?").run(id);

	const insertHeading = db.prepare(
		"INSERT INTO note_headings (note_id, depth, text, line) VALUES (?, ?, ?, ?)",
	);
	const insertTag = db.prepare(
		"INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)",
	);
	const insertTask = db.prepare(
		"INSERT INTO note_tasks (note_id, text, checked, line) VALUES (?, ?, ?, ?)",
	);
	const insertBacklink = db.prepare(
		"INSERT OR IGNORE INTO note_backlinks (note_id, target) VALUES (?, ?)",
	);

	for (const heading of metadata.headings) {
		insertHeading.run(id, heading.depth, heading.text, heading.line);
	}

	for (const tag of metadata.tags) {
		insertTag.run(id, tag);
	}

	for (const task of metadata.tasks) {
		insertTask.run(id, task.text, task.checked ? 1 : 0, task.line);
	}

	for (const backlink of metadata.backlinks) {
		insertBacklink.run(id, backlink);
	}

	db.prepare("DELETE FROM note_fts WHERE path = ?").run(normalizedPath);
	db.prepare(
		"INSERT INTO note_fts (path, title, content) VALUES (?, ?, ?)",
	).run(normalizedPath, title, plainText);

	return {
		title,
		preview,
		updatedAt: stats.mtimeMs,
	};
};

const deleteIndexedPath = async (itemPath) => {
	if (!indexDb) return;

	const normalized = currentNotePath(itemPath);
	const rows = indexDb.prepare("SELECT id, path FROM notes").all();

	for (const row of rows) {
		if (!isDescendantPath(normalized, row.path)) continue;

		indexDb.prepare("DELETE FROM notes WHERE path = ?").run(row.path);
		indexDb.prepare("DELETE FROM note_headings WHERE note_id = ?").run(row.id);
		indexDb.prepare("DELETE FROM note_tags WHERE note_id = ?").run(row.id);
		indexDb.prepare("DELETE FROM note_tasks WHERE note_id = ?").run(row.id);
		indexDb.prepare("DELETE FROM note_backlinks WHERE note_id = ?").run(row.id);
		indexDb.prepare("DELETE FROM note_fts WHERE path = ?").run(row.path);
	}
};

const moveIndexedPath = async (fromPath, toPath) => {
	if (!indexDb) return;
	const normalizedFromPath = currentNotePath(fromPath);
	const normalizedToPath = toPosixRelativePath(toPath);

	const rows = indexDb
		.prepare(
			"SELECT id, path, title, preview, mtime_ms AS mtimeMs, size, indexed_at AS indexedAt, sync_status AS syncStatus, sync_version AS syncVersion, remote_id AS remoteId, last_synced_at AS lastSyncedAt FROM notes",
		)
		.all();

	for (const row of rows) {
		if (!isDescendantPath(normalizedFromPath, row.path)) continue;

		const nextPath =
			row.path === normalizedFromPath
				? normalizedToPath
				: `${normalizedToPath}/${row.path.slice(normalizedFromPath.length + 1)}`;
		let nextTitle;
		try {
			const content = await readNoteContent(nextPath);
			nextTitle =
				readNoteTitle(content) || toNoteTitle(path.posix.basename(nextPath));
		} catch {
			nextTitle = toNoteTitle(path.posix.basename(nextPath));
		}

		indexDb.prepare("DELETE FROM notes WHERE path = ?").run(row.path);
		indexDb
			.prepare(
				"INSERT INTO notes (id, path, title, preview, mtime_ms, size, indexed_at, sync_status, sync_version, remote_id, last_synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			)
			.run(
				row.id || createNoteId(nextPath),
				nextPath,
				nextTitle,
				row.preview,
				row.mtimeMs,
				row.size,
				row.indexedAt,
				row.syncStatus,
				row.syncVersion,
				row.remoteId,
				row.lastSyncedAt,
			);
		indexDb
			.prepare("UPDATE note_fts SET path = ?, title = ? WHERE path = ?")
			.run(nextPath, nextTitle, row.path);
	}
};

const pruneIndex = async (knownNotePaths) => {
	const db = await getIndexDb();
	const rows = db.prepare("SELECT id, path FROM notes").all();

	for (const row of rows) {
		if (knownNotePaths.has(row.path)) continue;

		db.prepare("DELETE FROM notes WHERE path = ?").run(row.path);
		db.prepare("DELETE FROM note_headings WHERE note_id = ?").run(row.id);
		db.prepare("DELETE FROM note_tags WHERE note_id = ?").run(row.id);
		db.prepare("DELETE FROM note_tasks WHERE note_id = ?").run(row.id);
		db.prepare("DELETE FROM note_backlinks WHERE note_id = ?").run(row.id);
		db.prepare("DELETE FROM note_fts WHERE path = ?").run(row.path);
	}
};

const migrateLegacyNoteFile = async (itemPath) => {
	const normalizedPath = toPosixRelativePath(itemPath);
	const parentDirectory = path.posix.dirname(normalizedPath);
	const parentPath = parentDirectory === "." ? "" : parentDirectory;
	const title = toNoteTitle(path.posix.basename(normalizedPath)) || "Untitled";
	const notePath = await uniquePath(parentPath, title);
	let content;

	if (isLegacyMarkdownPath(normalizedPath)) {
		const markdown = await fs.readFile(
			resolveWorkspacePath(normalizedPath),
			"utf8",
		);
		content = textToNoteContent(markdown);
	} else {
		content = await readNoteContent(normalizedPath, true);
	}

	const normalizedContent = normalizeNoteContent(content);
	if (!normalizedContent.id) normalizedContent.id = crypto.randomUUID();
	if (!readNoteTitle(normalizedContent)) normalizedContent.title = title;

	await ensureNoteDirectory(notePath);
	await writeFileAtomic(
		resolveNoteContentPath(notePath),
		serializeNoteContent(normalizedContent),
	);
	await writeLocalYNoteSnapshot(notePath, normalizedContent);
	await fs.rm(resolveWorkspacePath(normalizedPath), { force: true });
	await moveIndexedPath(normalizedPath, notePath);

	return notePath;
};

const migrateAppStateNotePaths = async (migrations) => {
	if (migrations.size === 0) return;

	let state;
	try {
		state = JSON.parse(await fs.readFile(statePath(), "utf8"));
	} catch {
		return;
	}

	const migratePath = (value) =>
		typeof value === "string" ? (migrations.get(value) ?? value) : value;
	const migrateDecorations = (record) => {
		if (!record || typeof record !== "object" || Array.isArray(record))
			return record;

		return Object.fromEntries(
			Object.entries(record).map(([key, value]) => [migratePath(key), value]),
		);
	};

	const nextState = {
		...state,
		activeNotePath: migratePath(state.activeNotePath),
		openTabs: Array.isArray(state.openTabs)
			? state.openTabs.map((tab) => ({
					...tab,
					path: migratePath(tab.path),
				}))
			: state.openTabs,
		readOnlyNotes: migrateDecorations(state.readOnlyNotes),
	};

	await writeFileAtomic(statePath(), JSON.stringify(nextState, null, 2));
};

const migrateLegacyNotesInDirectory = async (relativePath = "", migrations) => {
	const absolutePath = resolveWorkspacePath(relativePath);
	const entries = await fs.readdir(absolutePath, { withFileTypes: true });

	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;

		const itemPath = path.posix.join(
			toPosixRelativePath(relativePath),
			entry.name,
		);

		if (entry.isDirectory()) {
			if (await isNoteDirectory(itemPath)) continue;

			await migrateLegacyNotesInDirectory(itemPath, migrations);
			continue;
		}

		if (!entry.isFile() || !isMigratableNotePath(entry.name)) continue;

		const notePath = await migrateLegacyNoteFile(itemPath);
		migrations.set(itemPath, notePath);
		legacyPathMigrations.set(itemPath, notePath);
	}
};

const migrateLegacyNotes = async () => {
	if (legacyMigrationPromise) return legacyMigrationPromise;

	legacyMigrationPromise = (async () => {
		const migrations = new Map();
		await migrateLegacyNotesInDirectory("", migrations);
		await migrateAppStateNotePaths(migrations);
		return migrations;
	})().finally(() => {
		legacyMigrationPromise = undefined;
	});

	return legacyMigrationPromise;
};

const scanDirectory = async (relativePath = "", knownNotePaths = new Set()) => {
	const absolutePath = resolveWorkspacePath(relativePath);
	const entries = await fs.readdir(absolutePath, { withFileTypes: true });
	const visibleEntries = entries.filter((entry) => !entry.name.startsWith("."));
	const folders = [];
	const notes = [];

	for (const entry of visibleEntries
		.filter((entry) => entry.isDirectory())
		.sort((first, second) => first.name.localeCompare(second.name))) {
		const childPath = path.posix.join(
			toPosixRelativePath(relativePath),
			entry.name,
		);

		if (await isNoteDirectory(childPath)) {
			const stats = await fs.stat(resolveNoteContentPath(childPath));
			knownNotePaths.add(childPath);
			const indexedNote = await getIndexedNote(childPath, stats);

			notes.push({
				type: "note",
				title: indexedNote.title,
				path: childPath,
				preview: indexedNote.preview,
				updatedAt: indexedNote.updatedAt,
			});
			continue;
		}

		folders.push({
			type: "folder",
			title: entry.name,
			path: childPath,
			children: await scanDirectory(childPath, knownNotePaths),
		});
	}

	for (const entry of visibleEntries
		.filter((entry) => entry.isFile() && isMigratableNotePath(entry.name))
		.sort((first, second) => first.name.localeCompare(second.name))) {
		const notePath = path.posix.join(
			toPosixRelativePath(relativePath),
			entry.name,
		);
		const stats = await fs.stat(resolveWorkspacePath(notePath));
		knownNotePaths.add(notePath);
		const indexedNote = await getIndexedNote(notePath, stats);

		notes.push({
			type: "note",
			title: indexedNote.title,
			path: notePath,
			preview: indexedNote.preview,
			updatedAt: indexedNote.updatedAt,
		});
	}
	notes.sort((first, second) => second.updatedAt - first.updatedAt);

	return [...folders, ...notes];
};

const listWorkspace = async () => {
	const start = performance.now();
	await ensureWorkspace();
	await migrateLegacyNotes();
	const knownNotePaths = new Set();

	const rootEntries = await fs.readdir(workspaceRoot(), {
		withFileTypes: true,
	});
	const spaces = await Promise.all(
		rootEntries
			.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
			.sort((first, second) => {
				if (first.name === "Inbox") return -1;
				if (second.name === "Inbox") return 1;
				return first.name.localeCompare(second.name);
			})
			.map(async (entry) => ({
				title: entry.name,
				path: entry.name,
				children: await scanDirectory(entry.name, knownNotePaths),
			})),
	);
	await pruneIndex(knownNotePaths);
	const duration = performance.now() - start;

	if (duration > 50) {
		console.info(`[paperite perf] getWorkspace ${duration.toFixed(1)}ms`);
	}

	return {
		rootPath: workspaceRoot(),
		spaces,
	};
};

const searchNotes = async (query) => {
	const start = performance.now();
	await ensureWorkspace();
	await migrateLegacyNotes();
	const trimmed = typeof query === "string" ? query.trim() : "";

	if (!trimmed) return [];

	const db = await getIndexDb();
	const safeQuery = trimmed
		.split(/\s+/)
		.map((term) => `"${term.replaceAll('"', '""')}"*`)
		.join(" ");

	const results = db
		.prepare(`
			SELECT
				notes.path,
				notes.title,
				notes.preview,
				notes.mtime_ms AS updatedAt,
				bm25(note_fts) AS rank
			FROM note_fts
			JOIN notes ON notes.path = note_fts.path
			WHERE note_fts MATCH ?
			ORDER BY rank
			LIMIT 50
		`)
		.all(safeQuery);

	const duration = performance.now() - start;
	console.info(
		`[paperite perf] search ${duration.toFixed(1)}ms ${results.length} results`,
	);

	return results;
};

const scanWorkspaceDirectories = async (relativePath = "") => {
	const absolutePath = resolveWorkspacePath(relativePath);
	const entries = await fs.readdir(absolutePath, { withFileTypes: true });
	const directories = [relativePath];

	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

		const childPath = path.posix.join(
			toPosixRelativePath(relativePath),
			entry.name,
		);
		if (await isNoteDirectory(childPath)) {
			directories.push(childPath);
			continue;
		}

		directories.push(...(await scanWorkspaceDirectories(childPath)));
	}

	return directories;
};

const ensureNoteExtension = (name) => {
	const trimmed = name.trim() || "Untitled";
	const base = toNoteTitle(trimmed) || "Untitled";
	return `${base}${noteFileExtension}`;
};

const isDescendantPath = (parentPath, childPath) =>
	childPath === parentPath || childPath.startsWith(`${parentPath}/`);

const uniquePath = async (parentPath, filename) => {
	const parsed = path.parse(filename);
	let candidate = filename;
	let index = 1;

	while (true) {
		try {
			await fs.access(
				resolveWorkspacePath(path.posix.join(parentPath, candidate)),
			);
			candidate = `${parsed.name} ${index}${parsed.ext}`;
			index += 1;
		} catch {
			return path.posix.join(parentPath, candidate);
		}
	}
};

const writeNoteTitle = async (notePath, title) => {
	const normalizedPath = currentNotePath(notePath);
	const normalizedContent = normalizeNoteContent(
		await readNoteContent(normalizedPath, true),
	);

	if (!normalizedContent.id) normalizedContent.id = crypto.randomUUID();
	normalizedContent.title = title;

	await writeRevisionSnapshot(normalizedPath, normalizedContent);
	await writeFileAtomic(
		resolveNoteContentPath(normalizedPath),
		serializeNoteContent(normalizedContent),
	);
	await writeLocalYNoteSnapshot(normalizedPath, normalizedContent);
	const stats = await fs.stat(resolveNoteContentPath(normalizedPath));
	await getIndexedNote(normalizedPath, stats);
};

const isAppUrl = (url) => {
	if (url.startsWith("paperite://")) return true;
	if (devServerUrl && url.startsWith(devServerUrl)) return true;
	return url.startsWith("file://");
};

const createWindow = () => {
	mainWindow = new BrowserWindow({
		width: 800,
		height: 600,
		minWidth: 420,
		minHeight: 520,
		frame: false,
		title: "Paperite",
		backgroundColor: "#171717",
		webPreferences: {
			preload: require("node:path").join(__dirname, "preload.js"),
		},
	});

	mainWindow.webContents.on("will-navigate", (event, url) => {
		if (isAppUrl(url)) return;

		event.preventDefault();
		shell.openExternal(url);
	});

	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (isAppUrl(url)) return { action: "allow" };

		shell.openExternal(url);
		return { action: "deny" };
	});

	if (devServerUrl) {
		mainWindow.loadURL(devServerUrl);
	} else {
		mainWindow.loadFile("dist/index.html");
	}
};

const notifyWorkspaceChanged = () => {
	if (workspaceWatchTimer) clearTimeout(workspaceWatchTimer);

	workspaceWatchTimer = setTimeout(() => {
		refreshWorkspaceWatchers().catch(() => undefined);
		mainWindow?.webContents.send("workspace:changed");
	}, 150);
};

const refreshWorkspaceWatchers = async () => {
	await ensureWorkspace();

	const directories = await scanWorkspaceDirectories();
	const nextDirectories = new Set(directories);

	for (const [directory, watcher] of workspaceWatchers) {
		if (nextDirectories.has(directory)) continue;

		watcher.close();
		workspaceWatchers.delete(directory);
	}

	for (const directory of directories) {
		if (workspaceWatchers.has(directory)) continue;

		const watcher = fsSync.watch(
			resolveWorkspacePath(directory),
			(_eventType, filename) => {
				if (filename?.toString().startsWith(".")) return;
				notifyWorkspaceChanged();
			},
		);
		watcher.on("error", () => {
			workspaceWatchers.delete(directory);
		});
		workspaceWatchers.set(directory, watcher);
	}
};

const getFocusedWindow = (event) =>
	BrowserWindow.fromWebContents(event.sender) ?? mainWindow;

const windowActions = {
	minimize: (window) => window?.minimize(),
	toggleMaximize: (window) => {
		if (!window) return;
		if (window.isMaximized()) {
			window.unmaximize();
			return;
		}
		window.maximize();
	},
	close: (window) => window?.close(),
	quit: () => app.quit(),
	reload: (window) => window?.webContents.reload(),
	forceReload: (window) => window?.webContents.reloadIgnoringCache(),
	toggleDevTools: (window) => window?.webContents.toggleDevTools(),
	undo: (window) => window?.webContents.undo(),
	redo: (window) => window?.webContents.redo(),
	cut: (window) => window?.webContents.cut(),
	copy: (window) => window?.webContents.copy(),
	paste: (window) => window?.webContents.paste(),
	selectAll: (window) => window?.webContents.selectAll(),
};

const registerProtocolClient = () => {
	if (process.defaultApp) {
		app.setAsDefaultProtocolClient("paperite", process.execPath, [
			app.getAppPath(),
		]);
		return;
	}

	app.setAsDefaultProtocolClient("paperite");
};

registerProtocolClient();

const isAuthCallbackUrl = (url) =>
	url.startsWith("paperite://auth/") || url.startsWith("paperite://callback");

const getProtocolCallbackArg = (argv) =>
	argv.find((url) => isAuthCallbackUrl(url));

const handleProtocolCallback = (url) => {
	if (isAuthCallbackUrl(url)) sendAuthCallback(url);
};

const sendAuthCallback = (url) => {
	pendingAuthCallbackUrl = url;
	mainWindow?.webContents.send("auth-callback", url);
	mainWindow?.focus();
};

ipcMain.handle("open-external", async (_event, url) => {
	await shell.openExternal(url);
});

ipcMain.handle("auth:get-pending-callback", () => {
	const url = pendingAuthCallbackUrl ?? null;
	pendingAuthCallbackUrl = undefined;
	return url;
});

ipcMain.handle("sync:get-status", async () => ({
	googleDrive: await getGoogleDriveStatus(),
	convex: {
		configured: Boolean(process.env.VITE_CONVEX_URL),
	},
}));

ipcMain.handle("sync:set-google-drive-enabled", async (_event, enabled) => {
	await ensureWorkspace();
	const preferences = await writeSyncPreferences({
		googleDriveEnabled: enabled === true,
	});
	return { ok: true, googleDriveEnabled: preferences.googleDriveEnabled };
});

ipcMain.handle("sync:connect-google-drive", async () => {
	await ensureWorkspace();
	return startGoogleDriveConnection();
});

ipcMain.handle("sync:run-google-drive", async () => {
	await ensureWorkspace();
	return syncGoogleDrive();
});

ipcMain.handle("sync:disconnect-google-drive", async () => {
	await deleteGoogleDriveToken();
	mainWindow?.webContents.send("sync:changed");
	return { ok: true };
});

ipcMain.handle("app:set-title", (event, title) => {
	const window = getFocusedWindow(event);
	const nextTitle =
		typeof title === "string" && title.trim() ? title : "Paperite";
	window?.setTitle(nextTitle);
	return { ok: true };
});

ipcMain.handle("window:get-state", (event) => {
	const window = getFocusedWindow(event);
	return { isMaximized: window?.isMaximized() ?? false };
});

ipcMain.handle("window:action", (event, action) => {
	const handler = windowActions[action];
	if (!handler) return { ok: false };

	handler(getFocusedWindow(event));
	return { ok: true };
});

ipcMain.handle("notes:get-workspace", async () => listWorkspace());

ipcMain.handle("notes:search", async (_event, query) => searchNotes(query));

ipcMain.handle("notes:read-note", async (_event, notePath) => {
	await ensureWorkspace();
	await migrateLegacyNotes();
	const normalizedPath = currentNotePath(notePath);
	const content = await readNoteContent(normalizedPath, true);
	await ensureLocalYNoteSnapshot(normalizedPath, content);
	return content;
});

ipcMain.handle("notes:read-y-note", async (_event, notePath) => {
	await ensureWorkspace();
	await migrateLegacyNotes();
	return readLocalYNoteState(notePath);
});

ipcMain.handle("notes:write-y-update", async (_event, notePath, update) => {
	await ensureWorkspace();
	await migrateLegacyNotes();
	return appendLocalYNoteUpdate(notePath, update);
});

ipcMain.handle(
	"notes:write-derived-note",
	async (_event, notePath, content) => {
		await ensureWorkspace();
		await migrateLegacyNotes();
		return writeDerivedNoteContent(notePath, content);
	},
);

ipcMain.handle("notes:write-note", async (_event, notePath, content) => {
	await ensureWorkspace();
	await migrateLegacyNotes();
	const normalizedPath = currentNotePath(notePath);
	const normalizedContent = normalizeNoteContent(content);
	let existingContent;

	// Preserve persisted metadata stripped by the editor body payload.
	if (!normalizedContent.id || !normalizedContent.title) {
		try {
			existingContent = await readNoteContent(normalizedPath, true);
			if (!normalizedContent.id && existingContent.id) {
				normalizedContent.id = existingContent.id;
			}
			if (!normalizedContent.title && existingContent.title) {
				normalizedContent.title = existingContent.title;
			}
		} catch {
			// new note or missing file — id already set by createEmptyNoteContent
		}
	}

	if (!normalizedContent.id) {
		normalizedContent.id = crypto.randomUUID();
	}

	// sync title from index for UUID-named files
	if (isUuidFilename(normalizedPath) && !normalizedContent.title && indexDb) {
		const row = indexDb
			.prepare("SELECT title FROM notes WHERE path = ?")
			.get(normalizedPath);
		if (row?.title) normalizedContent.title = row.title;
	}

	await ensureNoteDirectory(normalizedPath);
	await writeRevisionSnapshot(normalizedPath, normalizedContent);
	await writeFileAtomic(
		resolveNoteContentPath(normalizedPath),
		serializeNoteContent(normalizedContent),
	);
	await writeLocalYNoteSnapshot(normalizedPath, normalizedContent);
	const stats = await fs.stat(resolveNoteContentPath(normalizedPath));
	await getIndexedNote(normalizedPath, stats);
	return { ok: true };
});

ipcMain.handle("notes:create-note", async (_event, parentPath, title) => {
	await ensureWorkspace();
	const noteTitle = title?.trim() || "Untitled";
	const notePath = path.posix.join(
		toPosixRelativePath(parentPath),
		crypto.randomUUID(),
	);
	await ensureNoteDirectory(notePath);
	const content = createEmptyNoteContent(noteTitle);
	await writeFileAtomic(
		resolveNoteContentPath(notePath),
		serializeNoteContent(content),
	);
	await writeLocalYNoteSnapshot(notePath, content);
	return { path: notePath, title: noteTitle };
});

ipcMain.handle("notes:create-folder", async (_event, parentPath, title) => {
	await ensureWorkspace();
	const folderName = title.trim() || "Untitled";
	const folderPath = await uniquePath(parentPath, folderName);
	await fs.mkdir(resolveWorkspacePath(folderPath), { recursive: true });
	return { path: folderPath, title: path.basename(folderPath) };
});

ipcMain.handle("notes:create-space", async (_event, title) => {
	await ensureWorkspace();
	const spaceName = title.trim() || "Untitled";
	const spacePath = await uniquePath("", spaceName);
	await fs.mkdir(resolveWorkspacePath(spacePath), { recursive: true });
	return { path: spacePath, title: path.basename(spacePath) };
});

ipcMain.handle("notes:rename-item", async (_event, itemPath, nextName) => {
	await ensureWorkspace();
	await migrateLegacyNotes();
	const current = currentNotePath(itemPath);

	if (await isNoteDirectory(current)) {
		const nextTitle = nextName?.trim() || "Untitled";
		await writeNoteTitle(current, nextTitle);
		return { path: current };
	}

	const extension = isMigratableNotePath(current) ? noteFileExtension : "";
	const nextBase = extension ? ensureNoteExtension(nextName) : nextName.trim();
	const nextPath = path.posix.join(
		path.posix.dirname(current),
		nextBase || "Untitled",
	);
	await fs.rename(
		resolveWorkspacePath(current),
		resolveWorkspacePath(nextPath),
	);
	await moveIndexedPath(current, nextPath);
	if (popoutWindows.has(current)) {
		const win = popoutWindows.get(current);
		popoutWindows.delete(current);
		popoutWindows.set(nextPath, win);
		win.webContents.send("note:path-changed", { from: current, to: nextPath });
	}
	return { path: nextPath };
});

ipcMain.handle("notes:move-item", async (_event, itemPath, nextParentPath) => {
	await ensureWorkspace();
	await migrateLegacyNotes();
	const current = currentNotePath(itemPath);
	const nextParent = toPosixRelativePath(nextParentPath);
	const basename = path.posix.basename(current);

	if (isDescendantPath(current, nextParent)) {
		throw new Error("cannot move an item into itself");
	}

	const nextPath = await uniquePath(nextParent, basename);
	await fs.rename(
		resolveWorkspacePath(current),
		resolveWorkspacePath(nextPath),
	);
	await moveIndexedPath(current, nextPath);
	if (popoutWindows.has(current)) {
		const win = popoutWindows.get(current);
		popoutWindows.delete(current);
		popoutWindows.set(nextPath, win);
		win.webContents.send("note:path-changed", { from: current, to: nextPath });
	}
	return { path: nextPath };
});

ipcMain.handle("notes:delete-item", async (_event, itemPath) => {
	await ensureWorkspace();
	await migrateLegacyNotes();
	const current = currentNotePath(itemPath);
	const deletedNotes = await collectDeletedNotes(current);
	await appendTombstones(deletedNotes);
	await fs.rm(resolveWorkspacePath(current), { recursive: true, force: true });
	await deleteIndexedPath(current);
	return { ok: true };
});

ipcMain.handle("notes:read-app-state", async () => {
	await ensureWorkspace();
	await migrateLegacyNotes();
	try {
		return JSON.parse(await fs.readFile(statePath(), "utf8"));
	} catch {
		return {};
	}
});

ipcMain.handle("notes:write-app-state", async (_event, state) => {
	await ensureWorkspace();
	await writeFileAtomic(statePath(), JSON.stringify(state, null, 2));
	return { ok: true };
});

ipcMain.handle("notes:popout-note", async (_event, notePath) => {
	await ensureWorkspace();
	await migrateLegacyNotes();
	const normalizedPath = currentNotePath(notePath);

	if (popoutWindows.has(normalizedPath)) {
		const existing = popoutWindows.get(normalizedPath);
		if (!existing.isDestroyed()) {
			existing.focus();
			return { ok: true };
		}
	}

	const popout = new BrowserWindow({
		width: 600,
		height: 700,
		minWidth: 380,
		minHeight: 400,
		frame: false,
		title: "Paperite",
		backgroundColor: "#171717",
		webPreferences: {
			preload: require("node:path").join(__dirname, "preload.js"),
		},
	});

	popoutWindows.set(normalizedPath, popout);

	popout.on("closed", () => {
		popoutWindows.delete(normalizedPath);
		mainWindow?.webContents.send("popout:closed", normalizedPath);
	});

	popout.webContents.on("will-navigate", (event, url) => {
		if (isAppUrl(url)) return;
		event.preventDefault();
		shell.openExternal(url);
	});

	const encodedPath = encodeURIComponent(normalizedPath);

	if (devServerUrl) {
		await popout.loadURL(
			`${devServerUrl}/popout.html?popout=1&note=${encodedPath}`,
		);
	} else {
		await popout.loadFile("dist/popout.html", {
			query: { popout: "1", note: encodedPath },
		});
	}

	return { ok: true };
});

app.whenReady().then(() => {
	refreshWorkspaceWatchers().catch(() => undefined);
	createWindow();
	const startupAuthCallback = getProtocolCallbackArg(process.argv);
	if (startupAuthCallback) handleProtocolCallback(startupAuthCallback);
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

// linux: second-instance bukan open-url
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
} else {
	app.on("second-instance", (_event, argv) => {
		const url = getProtocolCallbackArg(argv);
		if (url) handleProtocolCallback(url);
	});
}

// mac
app.on("open-url", (event, url) => {
	event.preventDefault();
	if (isAuthCallbackUrl(url)) {
		handleProtocolCallback(url);
	}
});

app.on("window-all-closed", () => {
	for (const watcher of workspaceWatchers.values()) watcher.close();
	workspaceWatchers.clear();
	indexDb?.close();
	indexDb = undefined;
	if (process.platform !== "darwin") app.quit();
});
