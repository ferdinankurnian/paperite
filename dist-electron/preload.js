// electron/preload.ts
import { contextBridge } from "electron";
contextBridge.exposeInMainWorld("paperite", {
	platform: process.platform,
});

//# debugId=72A93D4E70D93E8264756E2164756E21
