import { Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppTitlebar } from "@/components/app-titlebar";
import { AuthDialog } from "@/components/auth-dialog";
import { ErrorBoundary } from "@/components/error-boundary";
import {
	KeyboardShortcutsProvider,
	useKeyboardShortcuts,
} from "@/components/keyboard-shortcuts-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGlobalAuthCallback } from "@/hooks/use-global-auth-callback";
import { isShortcutEditableInput, shortcutMatchesEvent } from "@/lib/shortcuts";

export function RootLayout() {
	const [authDialogOpen, setAuthDialogOpen] = useState(false);

	useGlobalAuthCallback();

	useEffect(() => {
		const openAuthDialog = () => setAuthDialogOpen(true);
		const closeAuthDialog = () => setAuthDialogOpen(false);
		window.addEventListener("paperite:open-auth", openAuthDialog);
		window.addEventListener("paperite:auth-success", closeAuthDialog);
		return () => {
			window.removeEventListener("paperite:open-auth", openAuthDialog);
			window.removeEventListener("paperite:auth-success", closeAuthDialog);
		};
	}, []);

	return (
		<ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
			<KeyboardShortcutsProvider>
				<TooltipProvider>
					<RootKeyboardShortcuts />
					<div
						className={`paperite-shell flex h-svh flex-col overflow-hidden bg-background${import.meta.env.PAPERITE_WEB ? " paperite-shell-web" : ""}`}
					>
						{/* Browser has its own chrome — custom titlebar is Electron-only. */}
						{!import.meta.env.PAPERITE_WEB && <AppTitlebar />}
						<div className="min-h-0 flex-1 overflow-hidden">
							<ErrorBoundary>
								<Outlet />
							</ErrorBoundary>
						</div>
					</div>
					<AuthDialog open={authDialogOpen} onOpenChange={setAuthDialogOpen} />
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

			// Settings should work even while typing in the note editor.
			if (shortcutMatchesEvent(getShortcut("settings.open"), event)) {
				event.preventDefault();
				window.dispatchEvent(new Event("paperite:open-settings"));
				return;
			}

			if (isShortcutEditableInput(event.target)) return;

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
