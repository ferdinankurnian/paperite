const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
	workspaceMode: process.argv.includes("--paperite-attached-workspace")
		? "attached"
		: "local",
	platform: {
		isMacOS:
			process.platform === "darwin" ||
			process.argv.includes("--paperite-macos-layout=1"),
	},
	onAppMenuAction: (cb) => {
		const listener = (_, action) => cb(action);
		ipcRenderer.on("app-menu:action", listener);
		return () => ipcRenderer.removeListener("app-menu:action", listener);
	},
	onAppMenuFormat: (cb) => {
		const listener = (_, command) => cb(command);
		ipcRenderer.on("app-menu:format", listener);
		return () => ipcRenderer.removeListener("app-menu:format", listener);
	},
	onAuthCallback: (cb) => {
		const listener = (_, url) => cb(url);
		ipcRenderer.on("auth-callback", listener);
		return () => ipcRenderer.removeListener("auth-callback", listener);
	},
	onWorkspaceChanged: (cb) => {
		const listener = () => cb();
		ipcRenderer.on("workspace:changed", listener);
		return () => ipcRenderer.removeListener("workspace:changed", listener);
	},
	onPopoutClosed: (cb) => {
		const listener = (_, notePath) => cb(notePath);
		ipcRenderer.on("popout:closed", listener);
		return () => ipcRenderer.removeListener("popout:closed", listener);
	},
	onNotePathChanged: (cb) => {
		const listener = (_, data) => cb(data);
		ipcRenderer.on("note:path-changed", listener);
		return () => ipcRenderer.removeListener("note:path-changed", listener);
	},
	onSyncChanged: (cb) => {
		const listener = (_, data) => cb(data);
		ipcRenderer.on("sync:changed", listener);
		return () => ipcRenderer.removeListener("sync:changed", listener);
	},
	auth: {
		getPendingCallback: () => ipcRenderer.invoke("auth:get-pending-callback"),
		startCallbackServer: () => ipcRenderer.invoke("auth:start-callback-server"),
		onBridgeSessionRequest: (cb) => {
			const listener = (_, request) => cb(request);
			ipcRenderer.on("auth:bridge-session-request", listener);
			return () =>
				ipcRenderer.removeListener("auth:bridge-session-request", listener);
		},
		respondBridgeSession: (requestId, result) =>
			ipcRenderer.send("auth:bridge-session-response", requestId, result),
		onBridgeSessionsRequest: (cb) => {
			const listener = (_, request) => cb(request);
			ipcRenderer.on("auth:bridge-sessions-request", listener);
			return () =>
				ipcRenderer.removeListener("auth:bridge-sessions-request", listener);
		},
		respondBridgeSessions: (requestId, result) =>
			ipcRenderer.send("auth:bridge-sessions-response", requestId, result),
		onBridgeSignOutRequest: (cb) => {
			const listener = (_, request) => cb(request?.requestId ?? request);
			ipcRenderer.on("auth:bridge-sign-out-request", listener);
			return () =>
				ipcRenderer.removeListener("auth:bridge-sign-out-request", listener);
		},
		respondBridgeSignOut: (requestId, result) =>
			ipcRenderer.send("auth:bridge-sign-out-response", requestId, result),
		getDeviceStatus: () => ipcRenderer.invoke("device-auth:status"),
		claimDevice: (userId) => ipcRenderer.invoke("device-auth:claim", userId),
		clearDevice: () => ipcRenderer.invoke("device-auth:clear"),
		enableFileStorage: () => ipcRenderer.invoke("device-auth:enable-file"),
	},
	sync: {
		getStatus: () => ipcRenderer.invoke("sync:get-status"),
	},
	personalServer: {
		getCredential: (connectionId) =>
			ipcRenderer.invoke("personal-server:get-credential", connectionId),
		saveCredential: (connectionId, credential) =>
			ipcRenderer.invoke(
				"personal-server:save-credential",
				connectionId,
				credential,
			),
		deleteCredential: (connectionId) =>
			ipcRenderer.invoke("personal-server:delete-credential", connectionId),
	},
	openExternal: (url) => ipcRenderer.invoke("open-external", url),
	app: {
		setTitle: (title) => ipcRenderer.invoke("app:set-title", title),
		getDeviceInfo: () => ipcRenderer.invoke("app:get-device-info"),
	},
	window: {
		getState: () => ipcRenderer.invoke("window:get-state"),
		action: (action) => ipcRenderer.invoke("window:action", action),
	},
	notes: {
		getWorkspace: () => ipcRenderer.invoke("notes:get-workspace"),
		search: (query) => ipcRenderer.invoke("notes:search", query),
		readNote: (path) => ipcRenderer.invoke("notes:read-note", path),
		readYNote: (path) => ipcRenderer.invoke("notes:read-y-note", path),
		readYDiff: (path, stateVector) =>
			ipcRenderer.invoke("notes:read-y-note-diff", path, stateVector),
		writeYUpdate: (path, update) =>
			ipcRenderer.invoke("notes:write-y-update", path, update),
		writeDerivedNote: (path, content) =>
			ipcRenderer.invoke("notes:write-derived-note", path, content),
		writeNote: (path, content) =>
			ipcRenderer.invoke("notes:write-note", path, content),
		saveImage: (notePath, imageDataUrl, filename) =>
			ipcRenderer.invoke("notes:save-image", notePath, imageDataUrl, filename),
		getAssetUrl: (notePath, assetPath) =>
			ipcRenderer.invoke("notes:get-asset-url", notePath, assetPath),
		pruneAssets: (notePath) =>
			ipcRenderer.invoke("notes:prune-assets", notePath),
		setPinned: (notePath, pinned) =>
			ipcRenderer.invoke("notes:set-pinned", notePath, pinned),
		setPageFormat: (notePath, format) =>
			ipcRenderer.invoke("notes:set-page-format", notePath, format),
		createNote: (parentPath, title) =>
			ipcRenderer.invoke("notes:create-note", parentPath, title),
		createFolder: (parentPath, title) =>
			ipcRenderer.invoke("notes:create-folder", parentPath, title),
		createSpace: (title) => ipcRenderer.invoke("notes:create-space", title),
		renameItem: (path, nextName) =>
			ipcRenderer.invoke("notes:rename-item", path, nextName),
		moveItem: (path, nextParentPath) =>
			ipcRenderer.invoke("notes:move-item", path, nextParentPath),
		deleteItem: (path) => ipcRenderer.invoke("notes:delete-item", path),
		popoutNote: (path) => ipcRenderer.invoke("notes:popout-note", path),
		readAppState: () => ipcRenderer.invoke("notes:read-app-state"),
		writeAppState: (state) =>
			ipcRenderer.invoke("notes:write-app-state", state),
		exportFile: (content, format, defaultFilename) =>
			ipcRenderer.invoke("notes:export-file", {
				content,
				format,
				defaultFilename,
			}),
		getDefaultExportDir: () =>
			ipcRenderer.invoke("notes:get-default-export-dir"),
	},
	trash: {
		getContents: () => ipcRenderer.invoke("notes:get-trash-contents"),
		restoreItem: (trashNoteName) =>
			ipcRenderer.invoke("notes:restore-item", trashNoteName),
		permanentDeleteItem: (trashNoteName) =>
			ipcRenderer.invoke("notes:permanent-delete-item", trashNoteName),
		emptyTrash: () => ipcRenderer.invoke("notes:empty-trash"),
	},
});
