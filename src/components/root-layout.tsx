import { Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppTitlebar } from "@/components/app-titlebar";
import { AuthDialog } from "@/components/auth-dialog";
import { DesktopRequiredDialog } from "@/components/desktop-required-dialog";
import { ErrorBoundary } from "@/components/error-boundary";
import {
	KeyboardShortcutsProvider,
	useKeyboardShortcuts,
} from "@/components/keyboard-shortcuts-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGlobalAuthCallback } from "@/hooks/use-global-auth-callback";
import { isBrowserRenderer, isDesktopRenderer } from "@/lib/auth-bridge";
import {
	ensureDesktopBridgeReady,
	getDesktopBridgeSnapshot,
	shouldBlankBrowser,
	subscribeDesktopBridge,
} from "@/lib/desktop-bridge-watch";
import { isShortcutEditableInput, shortcutMatchesEvent } from "@/lib/shortcuts";

export function RootLayout() {
	const [authDialogOpen, setAuthDialogOpen] = useState(false);
	const [bridge, setBridge] = useState(getDesktopBridgeSnapshot());

	useGlobalAuthCallback();

	useEffect(() => {
		void ensureDesktopBridgeReady();
		return subscribeDesktopBridge(() => setBridge(getDesktopBridgeSnapshot()));
	}, []);

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

	// A browser with no desktop and no session has nothing to show: no
	// account, no cloud, no devices. Loading the workspace behind the
	// blocking dialog would only put a broken shell on screen, so keep the
	// page empty and let the dialog do the talking. The app loads the
	// moment a desktop shows up with a session.
	const blank = isBrowserRenderer() && shouldBlankBrowser(bridge);

	return (
		<ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
			<KeyboardShortcutsProvider>
				<TooltipProvider>
					<RootKeyboardShortcuts />
					<div
						className={`paperite-shell flex h-svh flex-col overflow-hidden bg-background${isBrowserRenderer() ? " paperite-shell-web" : ""}`}
					>
						{/* The titlebar belongs to the desktop app, not to the web
						    bundle. When the desktop attaches to `paperite serve` it
						    renders that very same web bundle over http://localhost, so
						    the build flag cannot tell the two apart — the Electron
						    preload bridge can. */}
						{isDesktopRenderer() && <AppTitlebar />}
						<div className="min-h-0 flex-1 overflow-hidden">
							{blank ? null : (
								<ErrorBoundary>
									<Outlet />
								</ErrorBoundary>
							)}
						</div>
					</div>
					<AuthDialog open={authDialogOpen} onOpenChange={setAuthDialogOpen} />
					{/* A browser surface has no session of its own — when the
					    desktop closes, the browser cannot sign in or sync. Block
					    on it instead of silently degrading. */}
					<DesktopRequiredDialog />
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

			if (shortcutMatchesEvent(getShortcut("space.settings.open"), event)) {
				event.preventDefault();
				window.dispatchEvent(new Event("paperite:open-space-settings"));
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
