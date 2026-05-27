import { useEffect } from "react";
import { useSidebar } from "@/components/ui/sidebar";

export function SidebarHotkeys() {
	const { toggleSidebar } = useSidebar();

	useEffect(() => {
		const handleAltKeyDown = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() !== "b" || !event.altKey) return;
			if (event.ctrlKey || event.metaKey || event.shiftKey) return;

			event.preventDefault();
			toggleSidebar();
		};

		const stopBoldShortcutFromTogglingSidebar = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() !== "b") return;
			if (!event.ctrlKey && !event.metaKey) return;

			event.stopPropagation();
		};

		document.addEventListener("keydown", stopBoldShortcutFromTogglingSidebar);
		window.addEventListener("keydown", handleAltKeyDown);
		return () => {
			document.removeEventListener(
				"keydown",
				stopBoldShortcutFromTogglingSidebar,
			);
			window.removeEventListener("keydown", handleAltKeyDown);
		};
	}, [toggleSidebar]);

	return null;
}
