import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig({
	base: "./",
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	build: {
		rollupOptions: {
			input: {
				main: fileURLToPath(new URL("./index.html", import.meta.url)),
				popout: fileURLToPath(new URL("./popout.html", import.meta.url)),
			},
		},
	},
	plugins: [
		tailwindcss(),
		tanstackRouter({
			target: "react",
			autoCodeSplitting: false,
		}),
		react(),
	],
});
