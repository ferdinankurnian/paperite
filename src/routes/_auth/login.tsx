import { createFileRoute } from "@tanstack/react-router";
import { LoginView } from "@/components/login-view";
import { isBrowserRenderer } from "@/lib/auth-bridge";
import { clerk, isClerkConfigured, loadClerk } from "@/lib/clerk";

export const Route = createFileRoute("/_auth/login")({
	beforeLoad: async () => {
		if (!isClerkConfigured()) return;

		// A browser mirrors the desktop session — it never runs a Clerk
		// session of its own, so there is nothing to check here. The view
		// polls the desktop bridge instead.
		if (isBrowserRenderer()) return;

		await loadClerk();

		// A Clerk callback only establishes identity. The onboarding UI still
		// has to validate and confirm the selected target before entering the
		// workspace.
		if (clerk.isSignedIn) return;
	},
	component: LoginView,
});
