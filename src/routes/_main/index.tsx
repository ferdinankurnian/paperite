import { createFileRoute, redirect } from "@tanstack/react-router";
import { PaperiteShell } from "@/components/paperite-shell";
import { usePaperiteEditor } from "@/hooks/use-paperite-editor";
import { hasCompletedOnboarding } from "@/lib/onboarding";

export const Route = createFileRoute("/_main/")({
	beforeLoad: () => {
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
