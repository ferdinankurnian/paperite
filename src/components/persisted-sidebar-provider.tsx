import { type CSSProperties, type ReactNode, useCallback } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useAppStore } from "@/lib/stores/app-store";

/**
 * Owns `sidebarOpen` subscription so Index / editor tree do not re-render on
 * toggle. Last value is still written to the app store (persisted).
 */
export function PersistedSidebarProvider({
	children,
	className,
	style,
}: {
	children: ReactNode;
	className?: string;
	style?: CSSProperties;
}) {
	const sidebarOpen = useAppStore((s) => s.sidebarOpen);
	const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);

	const onOpenChange = useCallback(
		(open: boolean) => {
			setSidebarOpen(open);
		},
		[setSidebarOpen],
	);

	return (
		<SidebarProvider
			className={className}
			open={sidebarOpen}
			onOpenChange={onOpenChange}
			style={style}
		>
			{children}
		</SidebarProvider>
	);
}
