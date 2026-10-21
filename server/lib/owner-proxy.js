const http = require("node:http");

const OWNER_PROTOCOL_VERSION = 1;

const isBinary = (value) =>
	value instanceof Uint8Array || Buffer.isBuffer(value);

const encodeValue = (value) => {
	if (isBinary(value)) {
		return { __paperiteBinary: Buffer.from(value).toString("base64") };
	}
	if (Array.isArray(value)) return value.map(encodeValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, child]) => [key, encodeValue(child)]),
		);
	}
	return value;
};

const decodeValue = (value) => {
	if (value && typeof value === "object" && value.__paperiteBinary) {
		return Uint8Array.from(Buffer.from(value.__paperiteBinary, "base64"));
	}
	if (Array.isArray(value)) return value.map(decodeValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, child]) => [key, decodeValue(child)]),
		);
	}
	return value;
};

const readBody = async (request) => {
	const chunks = [];
	for await (const chunk of request) chunks.push(chunk);
	return Buffer.concat(chunks);
};

const requestOwner = async (owner, channel, args = []) => {
	const body = Buffer.from(
		JSON.stringify({
			protocolVersion: OWNER_PROTOCOL_VERSION,
			channel,
			args: encodeValue(args),
		}),
	);
	return new Promise((resolve, reject) => {
		const request = http.request(
			{
				host: "127.0.0.1",
				port: owner.ownerPort,
				path: "/__paperite_owner/rpc",
				method: "POST",
				headers: {
					"content-type": "application/json",
					"content-length": body.length,
					"x-paperite-owner-secret": owner.ownerSecret,
				},
				timeout: 5000,
			},
			(response) => {
				const chunks = [];
				response.on("data", (chunk) => chunks.push(chunk));
				response.on("end", () => {
					const raw = Buffer.concat(chunks).toString("utf8");
					let payload;
					try {
						payload = JSON.parse(raw || "{}");
					} catch {
						reject(new Error("workspace owner returned invalid data"));
						return;
					}
					if (response.statusCode !== 200 || payload.error) {
						reject(
							new Error(payload.error || `owner error ${response.statusCode}`),
						);
						return;
					}
					resolve(decodeValue(payload.result));
				});
			},
		);
		request.on("timeout", () =>
			request.destroy(new Error("workspace owner timeout")),
		);
		request.on("error", reject);
		request.end(body);
	});
};

const parsePath = (request) => {
	const url = new URL(
		request.originalUrl || request.url || "/",
		"http://paperite.local",
	);
	return { pathname: url.pathname, searchParams: url.searchParams };
};

const decodeSegment = (segment) => decodeURIComponent(segment);

const notePathFromApi = (pathname, suffix) => {
	const prefix = "/api/notes/";
	if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return null;
	return decodeSegment(pathname.slice(prefix.length, -suffix.length));
};

const ownerRequestFor = async (request) => {
	const { pathname, searchParams } = parsePath(request);
	const method = request.method || "GET";
	const bodyBuffer = Buffer.isBuffer(request.body)
		? request.body
		: await readBody(request);
	let body = request.body && !Buffer.isBuffer(request.body) ? request.body : {};
	if (
		bodyBuffer.length > 0 &&
		request.headers["content-type"]?.includes("json")
	) {
		body = JSON.parse(bodyBuffer.toString("utf8"));
	}

	if (method === "GET" && pathname === "/api/workspace") {
		return { channel: "notes:get-workspace" };
	}
	if (method === "GET" && pathname === "/api/search") {
		return { channel: "notes:search", args: [searchParams.get("q") || ""] };
	}
	if (method === "GET" && pathname === "/api/state") {
		return { channel: "notes:read-app-state" };
	}
	if (method === "PUT" && pathname === "/api/state") {
		return { channel: "notes:write-app-state", args: [body] };
	}
	if (method === "GET" && pathname === "/api/trash") {
		return { channel: "notes:get-trash-contents" };
	}
	if (method === "DELETE" && pathname === "/api/trash") {
		return { channel: "notes:empty-trash" };
	}
	if (method === "POST" && pathname === "/api/trash/restore") {
		return { channel: "notes:restore-item", args: [body.name] };
	}
	if (method === "DELETE" && pathname.startsWith("/api/trash/")) {
		return {
			channel: "notes:permanent-delete-item",
			args: [decodeSegment(pathname.slice("/api/trash/".length))],
		};
	}
	if (method === "POST" && pathname === "/api/notes") {
		return {
			channel: "notes:create-note",
			args: [body.parentPath || "", body.title || ""],
		};
	}
	if (method === "POST" && pathname === "/api/folders") {
		return {
			channel: "notes:create-folder",
			args: [body.parentPath || "", body.title || ""],
		};
	}
	if (method === "POST" && pathname === "/api/spaces") {
		return { channel: "notes:create-space", args: [body.title || ""] };
	}
	if (method === "PATCH" && pathname === "/api/rename") {
		return {
			channel: "notes:rename-item",
			args: [body.path, body.nextName ?? body.name],
		};
	}
	if (method === "POST" && pathname === "/api/move") {
		return { channel: "notes:move-item", args: [body.path, body.parentPath] };
	}

	const yDiffPath = notePathFromApi(pathname, "/yjs/diff");
	if (method === "GET" && yDiffPath !== null) {
		const stateVector = Uint8Array.from(
			Buffer.from(searchParams.get("sv") || "", "base64url"),
		);
		return {
			channel: "notes:read-y-note-diff",
			args: [yDiffPath, stateVector],
			binaryResponse: "diff",
		};
	}
	const yUpdatePath = notePathFromApi(pathname, "/yjs/update");
	if (method === "POST" && yUpdatePath !== null) {
		return {
			channel: "notes:write-y-update",
			args: [yUpdatePath, Uint8Array.from(bodyBuffer)],
		};
	}
	const yNotePath = notePathFromApi(pathname, "/yjs");
	if (method === "GET" && yNotePath !== null) {
		return {
			channel: "notes:read-y-note",
			args: [yNotePath],
			binaryResponse: "snapshot",
		};
	}
	const pageFormatPath = notePathFromApi(pathname, "/page-format");
	if (method === "PUT" && pageFormatPath !== null) {
		return { channel: "notes:set-page-format", args: [pageFormatPath, body] };
	}
	const pinnedPath = notePathFromApi(pathname, "/pinned");
	if (method === "PUT" && pinnedPath !== null) {
		return {
			channel: "notes:set-pinned",
			args: [pinnedPath, body.pinned === true],
		};
	}
	const derivedPath = notePathFromApi(pathname, "/derived");
	if (method === "PUT" && derivedPath !== null) {
		return { channel: "notes:write-derived-note", args: [derivedPath, body] };
	}
	const assetPath = notePathFromApi(pathname, "/assets");
	if (method === "POST" && assetPath !== null) {
		return {
			channel: "notes:save-image",
			args: [assetPath, body.imageDataUrl, body.filename],
		};
	}
	const notePath = pathname.startsWith("/api/notes/")
		? decodeSegment(pathname.slice("/api/notes/".length))
		: null;
	if (notePath !== null && method === "GET") {
		return { channel: "notes:read-note", args: [notePath] };
	}
	if (notePath !== null && method === "PUT") {
		return { channel: "notes:write-note", args: [notePath, body] };
	}
	if (notePath !== null && method === "DELETE") {
		return { channel: "notes:delete-item", args: [notePath] };
	}
	return null;
};

const createOwnerProxyMiddleware =
	(owner) => async (request, response, next) => {
		try {
			const operation = await ownerRequestFor(request);
			if (!operation) return next();
			const result = await requestOwner(
				owner,
				operation.channel,
				operation.args,
			);
			if (operation.binaryResponse === "snapshot") {
				response.type("application/octet-stream");
				response.send(
					Buffer.concat([
						Buffer.from(result.noteId, "utf8"),
						Buffer.from([0]),
						Buffer.from(result.snapshot),
					]),
				);
				return;
			}
			if (operation.binaryResponse === "diff") {
				response.type("application/octet-stream");
				response.set("X-Note-Id", result.noteId);
				response.send(Buffer.from(result.diff));
				return;
			}
			response
				.status(
					operation.channel === "notes:create-note" ||
						operation.channel === "notes:create-folder" ||
						operation.channel === "notes:create-space"
						? 201
						: 200,
				)
				.json(result);
		} catch (error) {
			response.status(500).json({ error: error.message });
		}
	};

module.exports = {
	OWNER_PROTOCOL_VERSION,
	createOwnerProxyMiddleware,
	requestOwner,
	readBody,
	encodeValue,
	decodeValue,
};
