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
	auth: {
		getPendingCallback: () => ipcRenderer.invoke("auth:get-pending-callback"),
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
		readAppState: () => ipcRenderer.invoke("notes:read-app-state"),
		writeAppState: (state) =>
			ipcRenderer.invoke("notes:write-app-state", state),
	},
});
