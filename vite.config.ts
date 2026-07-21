import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	define: {
		"import.meta.env.BETA_PAPERITE": JSON.stringify(
			process.env.BETA_PAPERITE === "1",
		),
		"import.meta.env.PAPERITE_WEB": JSON.stringify(
			process.env.PAPERITE_WEB === "1",
		),
	},
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
