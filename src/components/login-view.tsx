import { useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { isClerkConfigured } from "@/lib/clerk";
import { continueWithGoogle } from "@/lib/clerk-auth";
import { completeOnboarding } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

export function LoginView() {
	const navigate = useNavigate();
	const [isLoading, setIsLoading] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [canRetry, setCanRetry] = useState(false);
	const [step, setStep] = useState<1 | 2>(1);
	const clerkEnabled = isClerkConfigured();
	const isIntro = step === 1;

	useEffect(() => {
		document.title = "Paperite";
		window.dispatchEvent(new Event("paperite:title-change"));
		window.electron?.app.setTitle("Paperite");
	}, []);

	// Callbacks are completed globally (RootLayout). Just react here.
	useEffect(() => {
		if (!clerkEnabled) return;

		const onSuccess = () => {
			setCanRetry(false);
			void navigate({ to: "/" });
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
	}, [clerkEnabled, navigate]);

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

	// If the browser tab gets closed (or blocked), the app would otherwise
	// sit on "Opening browser..." forever with a disabled button. After a
	// few seconds, offer a retry instead of staying stuck.
	useEffect(() => {
		if (!isLoading) {
			setCanRetry(false);
			return;
		}
		const timer = setTimeout(() => setCanRetry(true), 4000);
		return () => clearTimeout(timer);
	}, [isLoading]);

	const createLocally = async () => {
		completeOnboarding();
		await navigate({ to: "/" });
	};

	return (
		<div className="relative h-full min-h-0 overflow-hidden bg-[#0b0c0d] text-[#f4f3ef]">
			<div className="pointer-events-none absolute inset-0 overflow-hidden">
				<div className="absolute -top-48 left-[42%] size-[34rem] rounded-full bg-[#E94C08]/15 blur-[120px]" />
				<div className="absolute -right-40 -bottom-48 size-[32rem] rounded-full bg-[#E94C08]/10 blur-[120px]" />
				<div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:72px_72px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
			</div>

			<section
				aria-hidden={!isIntro}
				className={cn(
					"absolute inset-0 transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
					isIntro ? "translate-x-0" : "pointer-events-none -translate-x-full",
				)}
			>
				<div className="mx-auto flex h-full w-full max-w-7xl flex-col justify-between px-7 py-8 sm:px-10 sm:py-10 lg:px-16 lg:py-12">
					<div className="flex items-center gap-3 text-xs font-medium tracking-[0.18em] text-white/40 uppercase"></div>

					<div className="mx-auto w-full max-w-4xl text-center lg:-mt-10">
						<h1 className="mx-auto max-w-4xl text-[clamp(3.5rem,8.5vw,8.75rem)] leading-[0.86] font-semibold tracking-[-0.065em] text-balance text-white">
							<span className="block">Notes can be</span>
							<span className="block">
								that <span className="text-[#E94C08]">special.</span>
							</span>
						</h1>
						<p className="mx-auto mt-8 max-w-sm text-sm leading-6 text-white/50 sm:text-base">
              Write down any idea, keep what matters close,
              and let your ideas grow with Paperite.
						</p>
					</div>

					<div className="flex items-end justify-center gap-6">
						<Button
							type="button"
							onClick={() => setStep(2)}
							tabIndex={isIntro ? 0 : -1}
							className=" bg-[#f4f3ef] text-[#161718] shadow-[0_12px_32px_rgb(0_0_0_/_18%)] transition-[transform,background-color,box-shadow] hover:bg-white hover:shadow-[0_16px_38px_rgb(0_0_0_/_26%)] active:scale-[0.98]"
						>
							<span>Next</span>
							<ArrowRightIcon className="size-4" />
						</Button>
					</div>
				</div>
			</section>

			<section
				aria-hidden={isIntro}
				className={cn(
					"absolute inset-0 transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
					isIntro ? "pointer-events-none translate-x-full" : "translate-x-0",
				)}
			>
				<div className="mx-auto flex h-full w-full max-w-7xl flex-col px-7 py-8 sm:px-10 sm:py-10 lg:px-16 lg:py-12">
					<div className="flex min-h-0 flex-1 items-center justify-center py-10">
						<div className="w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.045] p-2 shadow-[0_30px_100px_rgb(0_0_0_/_35%)] backdrop-blur-xl">
							<div className="rounded-[21px] border border-white/[0.07] bg-[#161718]/90 p-7 sm:p-8">
								<div className="mb-8">
									<h2 className="text-2xl font-semibold tracking-[-0.04em] text-white">
										Welcome to Paperite
									</h2>
									<p className="mt-2 text-sm leading-5 text-white/45">
										Sign in to connect your account, or continue locally.
									</p>
								</div>

								<div className="space-y-3">
									{clerkEnabled ? (
										<>
											<Button
												type="button"
												onClick={loginWithGoogle}
												className="h-12 w-full justify-center gap-2 rounded-xl bg-[#e9e9ef] text-[#161718] shadow-[0_8px_24px_rgb(0_0_0_/_16%)] transition-[transform,background-color,box-shadow] hover:bg-white hover:shadow-[0_10px_28px_rgb(0_0_0_/_22%)]"
												disabled={isLoading}
												tabIndex={isIntro ? -1 : 0}
											>
												<img src="google.svg" alt="" className="size-4" />
												{isLoading
													? "Opening browser..."
													: "Continue with Google"}
											</Button>
											{isLoading && canRetry ? (
												<p className="text-center text-xs text-white/45">
													No browser opened?{" "}
													<button
														type="button"
														onClick={loginWithGoogle}
														tabIndex={isIntro ? -1 : 0}
														className="underline underline-offset-2 transition-colors hover:text-white"
													>
														Click here to open it again
													</button>
												</p>
											) : null}
										</>
									) : null}
									{errorMessage ? (
										<p className="text-center text-xs text-red-300">
											{errorMessage}
										</p>
									) : null}
									<Button
										type="button"
										onClick={createLocally}
										className="h-12 w-full justify-between rounded-xl border-white/10 bg-white/[0.04] px-4 text-white/75 transition-[transform,background-color,border-color] hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
										tabIndex={isIntro ? -1 : 0}
										variant="outline"
									>
										<span>or, Continue locally</span>
										<ArrowRightIcon className="size-4 text-white/45" />
									</Button>
								</div>
							</div>
						</div>
					</div>

					<div className="flex items-center justify-center gap-3 text-xs text-white/35">
						<Button
							type="button"
							variant="ghost"
							onClick={() => setStep(1)}
							tabIndex={isIntro ? -1 : 0}
							className="gap-2 text-white/45 transition-[color,background-color] hover:bg-white/[0.06] hover:text-white"
						>
							<ArrowRightIcon className="size-4 rotate-180" />
							Back
						</Button>
					</div>
				</div>
			</section>
		</div>
	);
}
