import { useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { DesktopSignInPrompt } from "@/components/desktop-signin-prompt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isBrowserRenderer } from "@/lib/auth-bridge";
import { isClerkConfigured } from "@/lib/clerk";
import { continueWithGoogle } from "@/lib/clerk-auth";
import { subscribeDesktopBridge } from "@/lib/desktop-bridge-watch";
import {
	enableInsecureFileStorage,
	getDeviceAuthStatus,
} from "@/lib/device-auth";
import {
	completeOnboarding,
	completeSelectedOnboarding,
	selectOnboardingTarget,
	setOnboardingProgress,
} from "@/lib/onboarding";
import { getPaperiteSession } from "@/lib/paperite-auth";
import {
	discoverPersonalServer,
	normalizePersonalServerEndpoint,
	normalizeServerIdentity,
	pairPersonalServer,
} from "@/lib/personal-server-provider";
import type { SyncTargetKind } from "@/lib/space-sync-targets";
import { useAppStore } from "@/lib/stores/app-store";
import {
	ensurePersonalServerSpace,
	invalidatePersonalServerProvider,
} from "@/lib/sync-provider";
import { cn } from "@/lib/utils";

export function LoginView() {
	const navigate = useNavigate();
	const [isLoading, setIsLoading] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [canRetry, setCanRetry] = useState(false);
	const [authComplete, setAuthComplete] = useState(false);
	const [usingDesktopSession, setUsingDesktopSession] = useState(false);
	const [step, setStep] = useState<1 | 2>(1);
	const [target, setTarget] = useState<SyncTargetKind | null>(null);
	const [serverEndpoint, setServerEndpoint] = useState("http://localhost:3210");
	const [challengeId, setChallengeId] = useState("");
	const [challengeToken, setChallengeToken] = useState("");
	const [serverLabel, setServerLabel] = useState("My Paperite server");
	const [serverId, setServerId] = useState<string | null>(null);
	const [serverStatus, setServerStatus] = useState<string | null>(null);
	const [deviceStorageIssue, setDeviceStorageIssue] = useState(false);
	const setConnection = useAppStore((state) => state.setConnection);
	const setSpaceSyncTarget = useAppStore((state) => state.setSpaceSyncTarget);
	const clerkEnabled = isClerkConfigured();
	const isIntro = step === 1;

	useEffect(() => {
		document.title = "Paperite";
		window.dispatchEvent(new Event("paperite:title-change"));
		window.electron?.app.setTitle("Paperite");
	}, []);

	useEffect(() => {
		if (!clerkEnabled) return;
		void getDeviceAuthStatus()
			.then((result) =>
				setDeviceStorageIssue(result.status === "keychain-unavailable"),
			)
			.catch(() => setDeviceStorageIssue(true));
	}, [clerkEnabled]);

	useEffect(() => {
		if (!clerkEnabled) return;
		let cancelled = false;
		const syncSession = () => {
			void getPaperiteSession().then((session) => {
				if (cancelled) return;
				if (!session.signedIn) return;
				setAuthComplete(true);
				setUsingDesktopSession(session.source === "desktop-bridge");
			});
		};
		syncSession();
		// A browser mirrors the desktop session, so the desktop signing in
		// later must be picked up without a reload.
		const stop = isBrowserRenderer()
			? subscribeDesktopBridge(syncSession)
			: undefined;
		return () => {
			cancelled = true;
			stop?.();
		};
	}, [clerkEnabled]);

	// Callbacks are completed globally (RootLayout). Just react here.
	useEffect(() => {
		if (!clerkEnabled) return;

		const onSuccess = () => {
			setCanRetry(false);
			setIsLoading(false);
			setAuthComplete(true);
			setErrorMessage(null);
		};
		const onError = (event: Event) => {
			const detail = (event as CustomEvent<string>).detail;
			setErrorMessage(detail ?? "Could not complete sign in.");
			setDeviceStorageIssue(
				(detail ?? "").toLowerCase().includes("keychain") ||
					(detail ?? "").toLowerCase().includes("device account binding"),
			);
			setIsLoading(false);
			setCanRetry(false);
		};

		window.addEventListener("paperite:auth-success", onSuccess);
		window.addEventListener("paperite:auth-error", onError);
		return () => {
			window.removeEventListener("paperite:auth-success", onSuccess);
			window.removeEventListener("paperite:auth-error", onError);
		};
	}, [clerkEnabled]);

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

	const handleEnableFileStorage = async () => {
		setServerStatus("Enabling local file storage...");
		try {
			const result = await enableInsecureFileStorage();
			if (result.status === "unbound" && result.storage === "file") {
				setDeviceStorageIssue(false);
				setErrorMessage(null);
				setServerStatus("File storage enabled. Sign in again to continue.");
				return;
			}
			setServerStatus("Could not enable local file storage.");
		} catch (error) {
			setServerStatus(
				error instanceof Error
					? error.message
					: "Could not enable local file storage.",
			);
		}
	};

	const retryKeyring = async () => {
		try {
			const result = await getDeviceAuthStatus();
			setDeviceStorageIssue(result.status === "keychain-unavailable");
			setServerStatus(
				result.status === "keychain-unavailable"
					? "Keyring is still unavailable."
					: "Keyring is ready. You can sign in now.",
			);
		} catch (error) {
			setServerStatus(
				error instanceof Error ? error.message : "Could not check the keyring.",
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

	const chooseTarget = (next: SyncTargetKind) => {
		setTarget(next);
		selectOnboardingTarget(next);
		setServerStatus(null);
		setErrorMessage(null);
	};

	const finishCloudSetup = async () => {
		if (!target || target === "local" || target === "paperite-server") return;
		const connectionId = "paperite-plus";
		setConnection({
			connectionId,
			kind: target,
			displayLabel: "Paperite+",
			status: "connected",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		setSpaceSyncTarget("Inbox", { kind: target, connectionId });
		completeSelectedOnboarding({ spacePath: "Inbox", connectionId });
		await navigate({ to: "/" });
	};

	const discoverServer = async () => {
		setServerStatus("Discovering server capabilities...");
		try {
			const capabilities = await discoverPersonalServer(serverEndpoint);
			setServerId(capabilities.serverId);
			const identity = normalizeServerIdentity(capabilities.identity);
			setOnboardingProgress({ step: "pair-device", lastError: null });
			setServerStatus(
				`Found ${identity.icon} ${identity.name} · device pairing ready`,
			);
		} catch (error) {
			setServerStatus(
				error instanceof Error ? error.message : "Could not reach the server.",
			);
			setOnboardingProgress({ step: "pair-device", lastError: String(error) });
		}
	};

	const pairServer = async () => {
		if (!serverId || !challengeId.trim() || !challengeToken.trim()) {
			setServerStatus("Enter the one-time pairing challenge from the server.");
			return;
		}
		setServerStatus("Pairing this device...");
		try {
			const endpoint = normalizePersonalServerEndpoint(serverEndpoint);
			const connectionId = `personal-server:${serverId}`;
			const result = await pairPersonalServer({
				endpoint,
				connectionId,
				displayLabel: serverLabel,
				deviceLabel: "Paperite desktop",
				challengeId: challengeId.trim(),
				challengeToken: challengeToken.trim(),
			});
			invalidatePersonalServerProvider(connectionId);
			setConnection(result.connection);
			const { syncPersonalServerToClerk } = await import(
				"@/lib/clerk-server-sync"
			);
			void syncPersonalServerToClerk(result.connection);
			setSpaceSyncTarget("Inbox", {
				kind: "paperite-server",
				connectionId,
			});
			const remoteSpaceId = await ensurePersonalServerSpace(
				"Inbox",
				"Inbox",
				connectionId,
			);
			completeSelectedOnboarding({
				spacePath: "Inbox",
				connectionId,
				remoteSpaceId,
			});
			setServerStatus(
				`${result.connection.serverIdentity?.icon ?? "🗃️"} ${result.connection.serverIdentity?.name ?? result.connection.displayLabel} paired. Entering your workspace...`,
			);
			await navigate({ to: "/" });
		} catch (error) {
			setServerStatus(
				error instanceof Error ? error.message : "Pairing failed. Try again.",
			);
			setOnboardingProgress({ step: "pair-device", lastError: String(error) });
		}
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
					<div className="flex items-center gap-3 text-xs font-medium text-white/40"></div>

					<div className="mx-auto w-full max-w-4xl text-center lg:-mt-10">
						<h1 className="mx-auto max-w-4xl text-[clamp(3.5rem,8.5vw,8.75rem)] leading-[0.86] font-semibold tracking-[-0.065em] text-balance text-white">
							<span className="block">Notes can be</span>
							<span className="block">
								that <span className="text-[#E94C08]">special.</span>
							</span>
						</h1>
						<p className="mx-auto mt-8 max-w-sm text-sm leading-6 text-white/50 sm:text-base">
							Write down any idea, keep what matters close, and let your ideas
							grow with Paperite.
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
										Choose where this device should sync. You can change targets
										later.
									</p>
								</div>

								<div className="space-y-3">
									<div className="grid grid-cols-2 gap-2">
										{(
											["local", "paperite-cloud", "paperite-server"] as const
										).map((kind) => (
											<Button
												key={kind}
												type="button"
												variant={target === kind ? "secondary" : "outline"}
												onClick={() => chooseTarget(kind)}
												className="h-auto min-h-11 justify-start text-left text-xs"
												tabIndex={isIntro ? -1 : 0}
											>
												{kind === "local"
													? "Local only"
													: kind === "paperite-cloud"
														? "Paperite+"
														: "Personal server"}
											</Button>
										))}
									</div>
									{target === "local" ? (
										<Button
											type="button"
											onClick={createLocally}
											className="h-12 w-full justify-between rounded-xl bg-[#E94C08] text-white hover:bg-[#ff5d16]"
											tabIndex={isIntro ? -1 : 0}
										>
											Continue locally <ArrowRightIcon className="size-4" />
										</Button>
									) : null}
									{clerkEnabled && !usingDesktopSession ? (
										isBrowserRenderer() ? (
											<DesktopSignInPrompt
												className="border-white/10 bg-white/[0.03] text-left"
												onSignedIn={() => {
													setAuthComplete(true);
													setUsingDesktopSession(true);
												}}
											/>
										) : (
											<>
												<Button
													type="button"
													onClick={() => {
														if (
															!target ||
															target === "local" ||
															target === "paperite-server"
														)
															chooseTarget("paperite-cloud");
														void loginWithGoogle();
													}}
													className="h-12 w-full justify-center gap-2 rounded-xl bg-[#e9e9ef] text-[#161718] shadow-[0_8px_24px_rgb(0_0_0_/_16%)] transition-[transform,background-color,box-shadow] hover:bg-white hover:shadow-[0_10px_28px_rgb(0_0_0_/_22%)]"
													disabled={isLoading}
													tabIndex={isIntro ? -1 : 0}
												>
													<img src="google.svg" alt="" className="size-4" />
													{isLoading
														? "Opening browser..."
														: target === "paperite-cloud" || !target
															? "Continue with Google"
															: "Sign in to continue"}
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
										)
									) : usingDesktopSession ? (
										<p className="rounded-xl border border-[#E94C08]/20 bg-[#E94C08]/10 p-3 text-center text-xs text-white/65">
											Using the Paperite desktop account on this device.
										</p>
									) : null}
									{target === "paperite-cloud" && authComplete ? (
										<Button
											type="button"
											onClick={() => void finishCloudSetup()}
											className="h-11 w-full"
											tabIndex={isIntro ? -1 : 0}
										>
											Confirm Paperite+
										</Button>
									) : null}
									{target === "paperite-server" ? (
										<div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
											<Input
												value={serverLabel}
												onChange={(event) => setServerLabel(event.target.value)}
												placeholder="Connection name"
											/>
											<Input
												value={serverEndpoint}
												onChange={(event) =>
													setServerEndpoint(event.target.value)
												}
												placeholder="http://localhost:3210 or https://machine.ts.net"
											/>
											<Button
												type="button"
												variant="outline"
												className="w-full"
												onClick={() => void discoverServer()}
											>
												Discover capabilities
											</Button>
											{serverId ? (
												<>
													<Input
														value={challengeId}
														onChange={(event) =>
															setChallengeId(event.target.value)
														}
														placeholder="Challenge ID"
													/>
													<Input
														value={challengeToken}
														onChange={(event) =>
															setChallengeToken(event.target.value)
														}
														placeholder="One-time challenge token"
														type="password"
													/>
													<Button
														type="button"
														className="w-full"
														onClick={() => void pairServer()}
													>
														Pair device
													</Button>
												</>
											) : null}
											{serverStatus ? (
												<p className="text-xs text-white/55">{serverStatus}</p>
											) : null}
										</div>
									) : null}
									{errorMessage ? (
										<p className="text-center text-xs text-red-300">
											{errorMessage}
										</p>
									) : null}
									{deviceStorageIssue ? (
										<div className="space-y-3 rounded-2xl border border-amber-300/25 bg-amber-300/[0.08] p-4 text-left shadow-[0_10px_30px_rgb(0_0_0_/_12%)]">
											<div>
												<p className="text-sm font-medium text-amber-100">
													Secure keyring unavailable
												</p>
												<p className="mt-1 text-xs leading-5 text-amber-100/70">
													Set up GNOME Keyring, KWallet, or another Secret
													Service provider and retry. Or continue with a less
													secure local file.
												</p>
											</div>
											<div className="grid gap-2 sm:grid-cols-2">
												<Button
													type="button"
													variant="outline"
													onClick={() => void retryKeyring()}
													className="min-h-10 border-amber-100/20 bg-transparent text-amber-50 hover:bg-amber-100/10"
												>
													Retry keyring
												</Button>
												<Button
													type="button"
													onClick={() => void handleEnableFileStorage()}
													className="min-h-10 bg-amber-200 text-amber-950 hover:bg-amber-100"
												>
													Use file storage
												</Button>
											</div>
										</div>
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
