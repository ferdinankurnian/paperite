import { createRootRoute, Outlet } from "@tanstack/react-router";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

const RootLayout = () => (
	<ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
		<TooltipProvider>
			<Outlet />
		</TooltipProvider>
	</ThemeProvider>
);

export const Route = createRootRoute({ component: RootLayout });
