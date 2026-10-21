import { createFileRoute, redirect } from "@tanstack/react-router";
import { PaperiteShell } from "@/components/paperite-shell";
import { usePaperiteEditor } from "@/hooks/use-paperite-editor";
import { hasCompletedOnboarding } from "@/lib/onboarding";

export const Route = createFileRoute("/_main/")({
	beforeLoad: () => {
		// The browser surface is attached to the server/desktop workspace and
		// hydrates its onboarding state through /api/state. Its localStorage is
		// intentionally separate from Electron's, so do not gate it on the
		// browser's local onboarding copy.
		if (import.meta.env.PAPERITE_WEB) return;
		if (!hasCompletedOnboarding()) {
			throw redirect({ to: "/login" });
		}
	},
	component: Index,
});

function Index() {
	const editor = usePaperiteEditor();

	if (!editor.notesApi) {
		return (
			<div className="grid h-full place-items-center text-sm text-muted-foreground">
				{import.meta.env.PAPERITE_WEB
					? "Connecting to Paperite server..."
					: "Paperite needs the Electron shell to access local notes."}
			</div>
		);
	}

	return <PaperiteShell editor={editor} />;
}
