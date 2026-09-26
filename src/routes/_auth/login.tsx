import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginView } from "@/components/login-view";
import { clerk, isClerkConfigured, loadClerk } from "@/lib/clerk";
import { completeOnboarding } from "@/lib/onboarding";

export const Route = createFileRoute("/_auth/login")({
	beforeLoad: async () => {
		if (!isClerkConfigured()) return;

		await loadClerk();

		if (clerk.isSignedIn) {
			completeOnboarding();
			throw redirect({ to: "/" });
		}
	},
	component: LoginView,
});
