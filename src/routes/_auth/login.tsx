import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginView } from "@/components/login-view";
import { clerk, loadClerk } from "@/lib/clerk";

export const Route = createFileRoute("/_auth/login")({
	beforeLoad: async () => {
		if (!import.meta.env.BETA_PAPERITE) return;

		await loadClerk();

		if (clerk.isSignedIn) {
			throw redirect({ to: "/" });
		}
	},
	component: LoginView,
});
