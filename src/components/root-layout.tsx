import { Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppTitlebar } from "@/components/app-titlebar";
import {
	KeyboardShortcutsProvider,
	useKeyboardShortcuts,
} from "@/components/keyboard-shortcuts-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isShortcutEditableInput, shortcutMatchesEvent } from "@/lib/shortcuts";

export function RootLayout() {
	return (
		<ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
			<KeyboardShortcutsProvider>
				<TooltipProvider>
					<RootKeyboardShortcuts />
					<div className="paperite-shell flex h-svh flex-col overflow-hidden bg-background">
						<AppTitlebar />
						<div className="min-h-0 flex-1 overflow-hidden">
							<Outlet />
						</div>
					</div>
				</TooltipProvider>
			</KeyboardShortcutsProvider>
		</ThemeProvider>
	);
}

function RootKeyboardShortcuts() {
	const { getShortcut } = useKeyboardShortcuts();

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.repeat) return;
			if (isShortcutEditableInput(event.target)) return;

			if (shortcutMatchesEvent(getShortcut("settings.open"), event)) {
				event.preventDefault();
				window.dispatchEvent(new Event("paperite:open-settings"));
				return;
			}

			if (shortcutMatchesEvent(getShortcut("window.quit"), event)) {
				event.preventDefault();
				window.electron?.window.action("quit");
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [getShortcut]);

	return null;
}
