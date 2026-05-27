import { Outlet } from "@tanstack/react-router";
import { AppTitlebar } from "@/components/app-titlebar";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

export function RootLayout() {
	return (
		<ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
			<TooltipProvider>
				<div className="paperite-shell flex h-svh flex-col overflow-hidden bg-background">
					<AppTitlebar />
					<div className="min-h-0 flex-1 overflow-hidden">
						<Outlet />
					</div>
				</div>
			</TooltipProvider>
		</ThemeProvider>
	);
}
