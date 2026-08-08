/**
 * Note workspace shell (plan 015).
 *
 * Owns the editor-side chrome boundary opposite AppSidebar.
 * Session state (ydoc cache, autosave, openTabs wiring) still lives in
 * `routes/_main/index.tsx` until plan 013 extracts `useNoteSession`.
 *
 * Tab strip is isolated in `tab-bar.tsx` (store subscription, no Index
 * re-render on reorder).
 * Space switch must not re-render this tree — Index no longer subscribes
 * to `activeSpacePath`.
 */
import { type ReactNode, memo } from "react";
import { SidebarInset } from "@/components/ui/sidebar";

export const NoteWorkspace = memo(function NoteWorkspace({
	children,
}: {
	children: ReactNode;
}) {
	return (
		<SidebarInset className="min-w-0 overflow-hidden">{children}</SidebarInset>
	);
});
