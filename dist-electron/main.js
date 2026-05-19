// electron/main.ts
import { app, BrowserWindow, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
var __dirname2 = path.dirname(fileURLToPath(import.meta.url));
var isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
function createWindow() {
	const window = new BrowserWindow({
		width: 1200,
		height: 800,
		minWidth: 900,
		minHeight: 600,
		title: "Paperite",
		backgroundColor: "#ffffff",
		webPreferences: {
			preload: path.join(__dirname2, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});
	window.webContents.setWindowOpenHandler(({ url }) => {
		shell.openExternal(url);
		return { action: "deny" };
	});
	if (isDev) {
		window.loadURL(process.env.ELECTRON_RENDERER_URL);
		window.webContents.openDevTools({ mode: "detach" });
	} else {
		window.loadFile(path.join(__dirname2, "../dist/index.html"));
	}
}
app.whenReady().then(() => {
	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

//# debugId=E9C4C4B483EF467564756E2164756E21
