import type { CSSProperties, ReactNode } from "react";
import { PersistedSidebarProvider } from "@/components/persisted-sidebar-provider";

type AppShellProps = {
	children: ReactNode;
	sidebar: ReactNode;
	style?: CSSProperties;
};

/** Stable outer layout boundary; note/workspace state stays in its slots. */
export function AppShell({ children, sidebar, style }: AppShellProps) {
	return (
		<PersistedSidebarProvider className="h-full min-h-0" style={style}>
			{sidebar}
			{children}
		</PersistedSidebarProvider>
	);
}
