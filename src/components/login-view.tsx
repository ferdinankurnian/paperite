import { useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { clerk, handleClerkRedirect, loadClerk } from "@/lib/clerk";

const authCallbackUrl =
	import.meta.env.VITE_CLERK_AUTH_CALLBACK_URL ??
	"https://iydheko.dev/paperite/auth/success";

export function LoginView() {
	const navigate = useNavigate();
	const [isLoading, setIsLoading] = useState(false);
	const betaEnabled = import.meta.env.BETA_PAPERITE;

	const completeAuthCallback = useCallback(
		async (url: string) => {
			setIsLoading(true);
			await handleClerkRedirect(url);
			await navigate({ to: "/" });
		},
		[navigate],
	);

	useEffect(() => {
		document.title = "Paperite";
		window.dispatchEvent(new Event("paperite:title-change"));
		window.electron?.app.setTitle("Paperite");
	}, []);

	useEffect(() => {
		let cancelled = false;

		if (!betaEnabled) return;

		window.electron?.auth.getPendingCallback().then((url) => {
			if (!url || cancelled) return;
			completeAuthCallback(url);
		});

		const unsubscribe = window.electron?.onAuthCallback(completeAuthCallback);

		return () => {
			cancelled = true;
			unsubscribe?.();
		};
	}, [completeAuthCallback]);

	const loginWithGoogle = async () => {
		setIsLoading(true);
		await loadClerk();
		await clerk.client?.signIn.authenticateWithRedirect({
			strategy: "oauth_google",
			redirectUrl: authCallbackUrl,
			redirectUrlComplete: authCallbackUrl,
		});
	};

	const continueLocally = async () => {
		await navigate({ to: "/" });
	};

	return (
		<div className="relative grid h-full place-items-center overflow-hidden bg-background p-6">
			<div className="pointer-events-none absolute inset-0">
				<div className="absolute -top-28 left-1/2 size-64 -translate-x-1/2 rounded-full bg-[#E94C08]/15 blur-3xl dark:bg-[#E94C08]/25 md:size-80" />
				<div className="absolute -right-16 -bottom-28 size-72 rounded-full bg-[#E94C08]/10 blur-3xl dark:bg-[#E94C08]/20 md:size-96" />
				<div className="absolute -left-28 top-1/3 hidden size-64 rounded-full bg-[#E94C08]/10 blur-3xl dark:bg-[#E94C08]/20 sm:block" />
				<div className="absolute right-1/4 -bottom-32 hidden size-56 rounded-full bg-[#E94C08]/10 blur-3xl dark:bg-[#E94C08]/15 lg:block" />
			</div>

			<Card className="relative w-full max-w-md border border-border/70 bg-card/90 shadow-2xl backdrop-blur">
				<CardHeader className="items-center gap-4 text-center">
					<div>
						<div className="font-brand py-2 pt-3 text-4xl leading-none text-[#E94C08] dark:text-orange-400">
							Paperite
						</div>
						<CardTitle className="mt-4 text-2xl">
							{betaEnabled ? "Welcome back" : "Welcome to Paperite"}
						</CardTitle>
						<CardDescription className="mt-1">
							{betaEnabled
								? "Login with google and you're in."
								: "Your notes stay local on this device. Sync is coming soon."}
						</CardDescription>
					</div>
				</CardHeader>

				<CardContent>
					{betaEnabled ? (
						<Button
							type="button"
							onClick={loginWithGoogle}
							className="h-12 w-full gap-2 border-border/80 bg-background/70 hover:bg-accent"
							disabled={isLoading}
							variant="outline"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 24 24"
								className="size-5"
								aria-hidden="true"
							>
								<title>Google</title>
								<path
									d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
									fill="currentColor"
								/>
							</svg>
							{isLoading ? "Opening browser..." : "Continue with Google"}
						</Button>
					) : (
						<Button
							type="button"
							onClick={continueLocally}
							className="h-12 w-full gap-2"
						>
							Continue locally
							<ArrowRightIcon className="size-4" />
						</Button>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
