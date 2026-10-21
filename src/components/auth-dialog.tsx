import { useEffect, useState } from "react";
import { DesktopSignInPrompt } from "@/components/desktop-signin-prompt";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { isBrowserRenderer } from "@/lib/auth-bridge";
import { isClerkConfigured } from "@/lib/clerk";
import { continueWithGoogle } from "@/lib/clerk-auth";

export function AuthDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [isLoading, setIsLoading] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [canRetry, setCanRetry] = useState(false);
	const isBrowser = isBrowserRenderer();

	// Auth callbacks are handled globally (RootLayout). This dialog only
	// reflects the result.
	useEffect(() => {
		if (!open) return;
		setErrorMessage(null);

		const onSuccess = () => {
			setIsLoading(false);
			setCanRetry(false);
			onOpenChange(false);
		};
		const onError = (event: Event) => {
			const detail = (event as CustomEvent<string>).detail;
			setErrorMessage(detail ?? "Could not complete sign in.");
			setIsLoading(false);
			setCanRetry(false);
		};

		window.addEventListener("paperite:auth-success", onSuccess);
		window.addEventListener("paperite:auth-error", onError);
		return () => {
			window.removeEventListener("paperite:auth-success", onSuccess);
			window.removeEventListener("paperite:auth-error", onError);
		};
	}, [open, onOpenChange]);

	// Same deal as LoginView: if the tab gets closed the button would
	// otherwise stay stuck on "Opening browser...". Offer a retry.
	useEffect(() => {
		if (!isLoading) {
			setCanRetry(false);
			return;
		}
		const timer = setTimeout(() => setCanRetry(true), 4000);
		return () => clearTimeout(timer);
	}, [isLoading]);

	if (!isClerkConfigured()) return null;

	const loginWithGoogle = async () => {
		setIsLoading(true);
		setCanRetry(false);
		setErrorMessage(null);
		try {
			await continueWithGoogle();
		} catch (error) {
			setIsLoading(false);
			setCanRetry(false);
			setErrorMessage(
				error instanceof Error ? error.message : "Could not start sign in.",
			);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="max-w-sm overflow-hidden border-border/70 bg-card/95 p-0 shadow-2xl backdrop-blur-xl"
				showCloseButton
			>
				<div className="pointer-events-none absolute -top-24 left-1/2 size-56 -translate-x-1/2 rounded-full bg-[#E94C08]/15 blur-3xl dark:bg-[#E94C08]/25" />
				<div className="relative p-6 sm:p-7">
					<DialogHeader className="items-center gap-3 text-center">
						<div className="font-brand text-3xl leading-none text-[#E94C08] dark:text-orange-400">
							Paperite
						</div>
						<div>
							<DialogTitle className="text-xl">Sign in to Paperite</DialogTitle>
							<DialogDescription className="mt-2 text-pretty">
								Sign in to connect your account and unlock cloud features.
							</DialogDescription>
						</div>
					</DialogHeader>

					<div className="mt-6">
						{isBrowser ? (
							<DesktopSignInPrompt onSignedIn={() => onOpenChange(false)} />
						) : (
							<>
								<Button
									type="button"
									onClick={loginWithGoogle}
									className="h-11 w-full gap-2 bg-[#f4f3ef] text-[#161718] transition-[transform,background-color,box-shadow] hover:bg-white hover:shadow-lg active:scale-[0.98]"
									disabled={isLoading}
								>
									<img src="google.svg" alt="" className="size-4" />
									{isLoading ? "Opening browser..." : "Continue with Google"}
								</Button>
								{isLoading && canRetry ? (
									<p className="mt-3 text-center text-xs text-muted-foreground">
										No browser opened?{" "}
										<button
											type="button"
											onClick={loginWithGoogle}
											className="underline underline-offset-2 transition-colors hover:text-foreground"
										>
											Click here to open it again
										</button>
									</p>
								) : null}
							</>
						)}
						{errorMessage ? (
							<p className="mt-3 text-center text-xs text-destructive">
								{errorMessage}
							</p>
						) : null}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
