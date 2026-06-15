import { useEffect } from "react";
import { useSidebar } from "@/components/ui/sidebar";

export function SidebarHotkeys() {
	const { toggleSidebar } = useSidebar();

	useEffect(() => {
		const handleToggleSidebar = () => {
			toggleSidebar();
		};

		window.addEventListener("paperite:toggle-sidebar", handleToggleSidebar);
		return () => {
			window.removeEventListener(
				"paperite:toggle-sidebar",
				handleToggleSidebar,
			);
		};
	}, [toggleSidebar]);

	return null;
}
