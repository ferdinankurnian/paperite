import { type CSSProperties, memo, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { AppSidebar } from "@/components/app-sidebar";
import { NoteWorkspace } from "@/components/note-workspace";
import { SidebarHotkeys } from "@/components/sidebar-hotkeys";
import type { PaperiteEditor } from "@/hooks/use-paperite-editor";
import { useEditorUiStore } from "@/lib/stores/editor-ui-store";

const sidebarProviderStyle = {
	"--sidebar-width": "14.5rem",
} as CSSProperties;

function ZenAwareSidebar({ children }: { children: ReactNode }) {
	const zenMode = useEditorUiStore((state) => state.zenMode);
	if (zenMode) return null;
	return children;
}

export const PaperiteShell = memo(function PaperiteShell({
	editor,
}: {
	editor: PaperiteEditor;
}) {
	return (
		<AppShell
			style={sidebarProviderStyle}
			sidebar={
				<ZenAwareSidebar>
					<SidebarHotkeys />
					<AppSidebar {...editor.sidebarProps} />
				</ZenAwareSidebar>
			}
		>
			<NoteWorkspace {...editor.workspaceProps} />
		</AppShell>
	);
});
