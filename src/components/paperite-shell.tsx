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
	// Keep the sidebar mounted while zen is on. Unmounting here used to tear
	// down + rebuild the whole tree on every toggle (DndContext, sensors,
	// workspace sort/filter, Clerk/matchMedia effects) — that's what dropped
	// frames to ~20fps on exit. The visual hide is driven by ZenSidebarWrap
	// in app-sidebar (single collapsing box, CSS in index.css). `contents`
	// keeps flex layout and peer selectors identical to rendering children
	// directly; inert keeps everything out of keyboard navigation in zen.
	return (
		<div
			className="contents"
			inert={zenMode ? true : undefined}
			aria-hidden={zenMode ? true : undefined}
		>
			{children}
		</div>
	);
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
