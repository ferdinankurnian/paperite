const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
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
	},
	sync: {
		getStatus: () => ipcRenderer.invoke("sync:get-status"),
		setGoogleDriveEnabled: (enabled) =>
			ipcRenderer.invoke("sync:set-google-drive-enabled", enabled),
		connectGoogleDrive: () => ipcRenderer.invoke("sync:connect-google-drive"),
		runGoogleDrive: () => ipcRenderer.invoke("sync:run-google-drive"),
		disconnectGoogleDrive: () =>
			ipcRenderer.invoke("sync:disconnect-google-drive"),
	},
	openExternal: (url) => ipcRenderer.invoke("open-external", url),
	app: {
		setTitle: (title) => ipcRenderer.invoke("app:set-title", title),
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
		writeYUpdate: (path, update) =>
			ipcRenderer.invoke("notes:write-y-update", path, update),
		writeDerivedNote: (path, content) =>
			ipcRenderer.invoke("notes:write-derived-note", path, content),
		writeNote: (path, content) =>
			ipcRenderer.invoke("notes:write-note", path, content),
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
	},
});
