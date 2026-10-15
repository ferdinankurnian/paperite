import { CloudIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountSessions } from "@/components/settings/account-sessions";
import { Button } from "@/components/ui/button";
import {
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { clerk, isClerkConfigured, loadClerk } from "@/lib/clerk";
import {
	ensureSignedInForCloud,
	takePendingCloudIntent,
} from "@/lib/clerk-auth";
import {
	createSharedSpace,
	getCustomConvexUrl,
	resetConvexUrl,
	setCustomConvexUrl,
	useConvexUrl,
	useConvexUrlSource,
} from "@/lib/convex";
import { getSyncEngine, onSyncChanged } from "@/lib/sync-engine";
import driveSvg from "/drive.svg";

type SyncMode = "simple" | "advanced";

const syncModeStorageKey = "paperite:sync-mode";

function loadSyncMode(): SyncMode {
	try {
		return window.localStorage.getItem(syncModeStorageKey) === "advanced"
			? "advanced"
			: "simple";
	} catch {
		return "simple";
	}
}

export function SyncSettings() {
	const [status, setStatus] = useState<SyncStatus | null>(null);
	const [busyAction, setBusyAction] = useState<
		"toggle" | "connect" | "sync" | "disconnect" | "create-shared-space" | null
	>(null);
	const [connectPending, setConnectPending] = useState(false);
	const [googleDriveMessage, setGoogleDriveMessage] = useState<string | null>(
		null,
	);
	const [cloudMessage, setCloudMessage] = useState<string | null>(null);
	const [sharedSpaceName, setSharedSpaceName] = useState("");
	const [urlDraft, setUrlDraft] = useState(() => getCustomConvexUrl() ?? "");
	const [urlMessage, setUrlMessage] = useState<string | null>(null);
	const convexUrl = useConvexUrl();
	const convexSource = useConvexUrlSource();
	const syncEngine = getSyncEngine();

	// Plan 016 revised 2026-10-15: local always works; GDrive / Paperite+ /
	// BYO require a Clerk session. `clerkEnabled` is static per boot (build
	// key), `signedIn` tracks the live session.
	const clerkEnabled = isClerkConfigured();
	const [signedIn, setSignedIn] = useState(false);
	const [syncMode, setSyncModeState] = useState<SyncMode>(loadSyncMode);

	const setSyncMode = (mode: SyncMode) => {
		setSyncModeState(mode);
		try {
			window.localStorage.setItem(syncModeStorageKey, mode);
		} catch {
			// Mode preference is cosmetic — the panels still work.
		}
	};

	const refreshStatus = useCallback(async () => {
		const nextStatus = await syncEngine?.getStatus();
		if (nextStatus) setStatus(nextStatus);
	}, [syncEngine]);

	useEffect(() => {
		refreshStatus().catch(() =>
			setGoogleDriveMessage("Could not read sync status."),
		);

		return onSyncChanged((data) => {
			if (data?.error) {
				setConnectPending(false);
				setGoogleDriveMessage(data.error);
			}
			refreshStatus().catch(() =>
				setGoogleDriveMessage("Could not read sync status."),
			);
		});
	}, [refreshStatus]);

	useEffect(() => {
		if (status?.googleDrive.connected) setConnectPending(false);
	}, [status?.googleDrive.connected]);

	const runAction = async (
		action:
			| "toggle"
			| "connect"
			| "sync"
			| "disconnect"
			| "create-shared-space",
		runner: () => Promise<unknown>,
	) => {
		setBusyAction(action);
		if (action === "connect") setConnectPending(true);
		if (action === "create-shared-space") {
			setCloudMessage(null);
		} else {
			setGoogleDriveMessage(null);
		}

		try {
			const result = await runner();
			if (isSyncError(result)) {
				if (action === "connect") setConnectPending(false);
				if (action === "create-shared-space") {
					setCloudMessage(syncErrorMessage(result.error));
				} else {
					setGoogleDriveMessage(syncErrorMessage(result.error));
				}
			} else if (action === "sync" && isGoogleDriveSyncResult(result)) {
				setGoogleDriveMessage(
					`Sync complete. Uploaded ${result.uploaded}, downloaded ${result.downloaded}.`,
				);
			} else if (action === "disconnect") {
				setGoogleDriveMessage("Google Drive disconnected on this device.");
			} else if (action === "create-shared-space") {
				setSharedSpaceName("");
				setCloudMessage("Shared space created in Cloud.");
			}

			await refreshStatus();
		} catch (error) {
			if (action === "connect") setConnectPending(false);
			const errorMessage =
				error instanceof Error ? error.message : "Sync action failed.";
			if (action === "create-shared-space") {
				setCloudMessage(errorMessage);
			} else {
				setGoogleDriveMessage(errorMessage);
			}
		} finally {
			setBusyAction(null);
		}
	};

	// Resume the pre-login intent after `paperite:auth-success` — the user
	// lands back in the flow they started instead of failing silently.
	const resumeRef = useRef<() => void>(() => undefined);
	resumeRef.current = () => {
		const intent = takePendingCloudIntent();
		if (!intent) return;
		if (intent.action === "gdrive-connect") {
			void runAction(
				"connect",
				() => syncEngine?.connectGoogleDrive() ?? Promise.resolve(null),
			);
		} else if (intent.action === "paperite-join" && intent.payload) {
			const name = intent.payload;
			setSharedSpaceName(name);
			void runAction("create-shared-space", () => createSharedSpace(name));
		} else if (intent.action === "paperite-join") {
			resetConvexUrl();
			setUrlDraft("");
			setCloudMessage(
				"Paperite+ cloud selected — you're on the default sync server.",
			);
			void refreshStatus().catch(() => undefined);
		} else if (intent.action === "byo-save" && intent.payload) {
			const url = intent.payload;
			setUrlDraft(url);
			try {
				setCustomConvexUrl(url);
				setUrlMessage("Custom Convex URL saved.");
			} catch (error) {
				setUrlMessage(
					error instanceof Error ? error.message : "Could not save the URL.",
				);
			}
		}
	};

	useEffect(() => {
		if (!clerkEnabled) return;
		let cancelled = false;
		const syncSession = () => {
			if (!cancelled) setSignedIn(Boolean(clerk.user));
		};
		let detach: (() => void) | undefined;
		try {
			detach = clerk.addListener(syncSession);
		} catch {
			// Listener unavailable — the explicit load below still syncs once.
		}
		void loadClerk()
			.then(syncSession)
			.catch(() => undefined);
		const onAuthSuccess = () => {
			syncSession();
			resumeRef.current();
		};
		window.addEventListener("paperite:auth-success", onAuthSuccess);
		return () => {
			cancelled = true;
			detach?.();
			window.removeEventListener("paperite:auth-success", onAuthSuccess);
		};
	}, [clerkEnabled]);

	const googleDrive = status?.googleDrive;
	const convexConfigured = convexUrl !== null;
	const googleDriveEnabled = googleDrive?.enabled === true;
	const googleDriveConnecting = busyAction === "connect" || connectPending;

	const openSignIn = () =>
		window.dispatchEvent(new Event("paperite:open-auth"));

	// Gate: cloud actions without a Clerk session are refused gently —
	// stash the intent, open sign-in, resume after. Never fail silent.
	const handleConnectGoogleDrive = async () => {
		if (!clerkEnabled) {
			setGoogleDriveMessage(
				"Local-only mode — sign-in isn't configured in this build, so Google Drive sync is disabled.",
			);
			return;
		}
		const ok = await ensureSignedInForCloud({ action: "gdrive-connect" });
		if (!ok) {
			setGoogleDriveMessage(
				"Sign in required — opening sign-in. You'll return here to connect Drive after.",
			);
			return;
		}
		await runAction(
			"connect",
			() => syncEngine?.connectGoogleDrive() ?? Promise.resolve(null),
		);
	};

	const handleCreateSharedSpace = async () => {
		const name = sharedSpaceName.trim();
		if (!clerkEnabled) {
			setCloudMessage(
				"Local-only mode — sign-in isn't configured in this build, so cloud spaces are disabled.",
			);
			return;
		}
		const ok = await ensureSignedInForCloud({
			action: "paperite-join",
			payload: name,
		});
		if (!ok) {
			setCloudMessage(
				"Sign in required — opening sign-in. You'll return here to join Paperite+ after.",
			);
			return;
		}
		await runAction("create-shared-space", () => createSharedSpace(name));
	};

	const handleUsePaperitePlus = async () => {
		if (!clerkEnabled) {
			setCloudMessage(
				"Local-only mode — sign-in isn't configured in this build, so Paperite+ is disabled.",
			);
			return;
		}
		const ok = await ensureSignedInForCloud({ action: "paperite-join" });
		if (!ok) {
			setCloudMessage(
				"Sign in required — opening sign-in. You'll return here to join Paperite+ after.",
			);
			return;
		}
		resetConvexUrl();
		setUrlDraft("");
		setCloudMessage(
			"Paperite+ cloud selected — you're on the default sync server.",
		);
	};

	const saveConvexUrl = async () => {
		setUrlMessage(null);
		if (!clerkEnabled) {
			setUrlMessage(
				"Local-only mode — sign-in isn't configured in this build, so a custom server URL is disabled.",
			);
			return;
		}
		const ok = await ensureSignedInForCloud({
			action: "byo-save",
			payload: urlDraft,
		});
		if (!ok) {
			setUrlMessage(
				"Sign in required — opening sign-in. Your URL is kept and saved after.",
			);
			return;
		}
		try {
			setCustomConvexUrl(urlDraft);
			setUrlMessage("Custom Convex URL saved.");
		} catch (error) {
			setUrlMessage(
				error instanceof Error ? error.message : "Could not save the URL.",
			);
		}
	};

	const resetConvexUrlToDefault = () => {
		resetConvexUrl();
		setUrlDraft("");
		setUrlMessage("Back to the default Convex URL.");
	};

	return (
		<>
			<DialogHeader className="mb-5 gap-1">
				<DialogTitle className="text-lg">Sync</DialogTitle>
				<DialogDescription>
					Connect personal sync and check collaborative backend status.
				</DialogDescription>
			</DialogHeader>
			<div className="space-y-4">
				{!clerkEnabled ? (
					<p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5">
						Local-only mode — sign-in isn't configured in this build. Your notes
						stay on this device; Google Drive, Paperite+, and custom server sync
						are disabled.
					</p>
				) : !signedIn ? (
					<div className="flex items-center justify-between gap-3 rounded-xl border p-3">
						<p className="text-xs leading-5 text-muted-foreground">
							You're browsing locally. Sign in to unlock Google Drive,
							Paperite+, and custom server sync.
						</p>
						<Button type="button" size="sm" onClick={openSignIn}>
							Sign in
						</Button>
					</div>
				) : null}
				<div className="grid grid-cols-2 gap-2 rounded-xl border bg-muted/25 p-1">
					<Button
						type="button"
						size="sm"
						variant={syncMode === "simple" ? "secondary" : "ghost"}
						onClick={() => setSyncMode("simple")}
					>
						Simple · Paperite+
					</Button>
					<Button
						type="button"
						size="sm"
						variant={syncMode === "advanced" ? "secondary" : "ghost"}
						onClick={() => setSyncMode("advanced")}
					>
						Advanced · GDrive / BYO
					</Button>
				</div>
				{syncMode === "simple" ? (
					<section className="rounded-xl border bg-muted/25 p-4">
						<div className="flex items-start justify-between gap-3">
							<div className="flex items-center gap-2">
								<CloudIcon className="size-4 text-muted-foreground" />
								<div>
									<h3 className="text-sm font-medium">Paperite+</h3>
									<p className="text-xs text-muted-foreground">
										Zero-config cloud. Sign in and sync everywhere — no server
										thinking.
									</p>
								</div>
							</div>
							<StatusPill
								active={convexConfigured}
								label={
									convexSource === "custom"
										? "Custom URL"
										: convexSource === "default"
											? "Default"
											: "Not configured"
								}
							/>
						</div>
						{convexUrl ? (
							<p
								className="mt-3 truncate rounded-lg bg-muted px-2 py-1.5 font-mono text-xs"
								title={convexUrl}
							>
								{convexUrl}
							</p>
						) : (
							<p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
								Not configured. Shared spaces won't sync until a URL is set.
							</p>
						)}
						<div className="mt-3">
							{convexSource === "default" ? (
								<p className="text-xs text-muted-foreground">
									Paperite+ cloud is active.
								</p>
							) : (
								<Button
									type="button"
									size="sm"
									disabled={!clerkEnabled || busyAction !== null}
									onClick={() => void handleUsePaperitePlus()}
								>
									Use Paperite+ cloud
								</Button>
							)}
						</div>
						{cloudMessage ? (
							<p className="mt-2 text-xs text-muted-foreground">
								{cloudMessage}
							</p>
						) : null}
					</section>
				) : (
					<>
						<section className="rounded-xl border bg-muted/25 p-4">
							<div className="flex items-center justify-between gap-4">
								<div className="flex items-center gap-2">
									<img src={driveSvg} alt="" className="size-4" />
									<div>
										<div className="flex items-center gap-2">
											<h3 className="text-sm font-medium">Google Drive</h3>
										</div>
										<p className="text-xs text-muted-foreground">
											Personal multi-device sync through Drive app data.
										</p>
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-2">
									{googleDrive?.connected ? (
										<Switch
											checked={googleDriveEnabled}
											disabled={!syncEngine || busyAction !== null}
											onCheckedChange={(enabled) =>
												runAction(
													"toggle",
													() =>
														syncEngine?.setGoogleDriveEnabled(enabled) ??
														Promise.resolve(null),
												)
											}
											aria-label="Use Google Drive sync"
										/>
									) : (
										<Button
											type="button"
											size="sm"
											disabled={
												!syncEngine ||
												!clerkEnabled ||
												googleDrive?.configured === false ||
												busyAction !== null ||
												connectPending
											}
											onClick={() => void handleConnectGoogleDrive()}
										>
											{googleDriveConnecting ? "Opening browser.." : "Connect"}
										</Button>
									)}
								</div>
							</div>
							{googleDrive?.configured === false ? (
								<p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
									Missing <code>PAPERITE_GOOGLE_CLIENT_ID</code>.
								</p>
							) : null}
							{!clerkEnabled ? (
								<p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
									Disabled in local-only mode — sign-in isn't configured.
								</p>
							) : null}
							{googleDrive?.connected ? (
								<div className="mt-3 flex flex-wrap gap-2">
									<Button
										type="button"
										size="sm"
										variant="outline"
										disabled={
											!syncEngine || !googleDriveEnabled || busyAction !== null
										}
										onClick={() =>
											runAction(
												"sync",
												() =>
													syncEngine?.runGoogleDrive() ?? Promise.resolve(null),
											)
										}
									>
										{busyAction === "sync" ? "Syncing..." : "Sync now"}
									</Button>
									<Button
										type="button"
										size="sm"
										variant="outline"
										disabled={!syncEngine || busyAction !== null}
										onClick={() =>
											runAction(
												"disconnect",
												() =>
													syncEngine?.disconnectGoogleDrive() ??
													Promise.resolve(null),
											)
										}
									>
										Disconnect
									</Button>
								</div>
							) : null}
							{googleDriveMessage ? (
								<p className="mt-3 text-xs text-muted-foreground">
									{googleDriveMessage}
								</p>
							) : null}
						</section>
						<section className="rounded-xl border bg-muted/25 p-4">
							<div className="flex items-start justify-between gap-3">
								<div className="flex items-center gap-2">
									<CloudIcon className="size-4 text-muted-foreground" />
									<div>
										<h3 className="text-sm font-medium">
											Bring your own server
										</h3>
										<p className="text-xs text-muted-foreground">
											Paste your own Convex deployment URL. The runtime value
											wins over the build default.
										</p>
									</div>
								</div>
								<StatusPill
									active={convexConfigured}
									label={
										convexSource === "custom"
											? "Custom URL"
											: convexSource === "default"
												? "Default"
												: "Not configured"
									}
								/>
							</div>
							{convexUrl ? (
								<p
									className="mt-3 truncate rounded-lg bg-muted px-2 py-1.5 font-mono text-xs"
									title={convexUrl}
								>
									{convexUrl}
								</p>
							) : (
								<p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
									Not configured. Shared spaces won't sync until a URL is set.
								</p>
							)}
							<div className="mt-3 flex gap-2">
								<Input
									value={urlDraft}
									onChange={(event) => setUrlDraft(event.target.value)}
									placeholder="https://<deployment>.convex.cloud"
									disabled={busyAction !== null}
									spellCheck={false}
								/>
								<Button
									type="button"
									size="sm"
									disabled={
										!urlDraft.trim() || busyAction !== null || !clerkEnabled
									}
									onClick={() => void saveConvexUrl()}
								>
									Save
								</Button>
								{convexSource === "custom" ? (
									<Button
										type="button"
										size="sm"
										variant="outline"
										disabled={busyAction !== null}
										onClick={resetConvexUrlToDefault}
									>
										Reset
									</Button>
								) : null}
							</div>
							{urlMessage ? (
								<p className="mt-2 text-xs text-muted-foreground">
									{urlMessage}
								</p>
							) : null}
						</section>
					</>
				)}
				{import.meta.env.BETA_PAPERITE && (
					<section className="rounded-xl bg-muted/45 p-4">
						<div className="flex items-start justify-between gap-3">
							<div className="flex items-center gap-2">
								<CloudIcon className="size-4 text-muted-foreground" />
								<div>
									<h3 className="text-sm font-medium">Cloud</h3>
									<p className="text-xs text-muted-foreground">
										Shared spaces backend for collaboration.
									</p>
								</div>
							</div>
							<StatusPill
								active={convexConfigured}
								label={convexConfigured ? "Configured" : "Missing URL"}
							/>
						</div>
						<div className="mt-4 flex gap-2">
							<Input
								value={sharedSpaceName}
								onChange={(event) => setSharedSpaceName(event.target.value)}
								placeholder="Shared space name"
								disabled={
									!convexConfigured || !clerkEnabled || busyAction !== null
								}
							/>
							<Button
								type="button"
								size="sm"
								disabled={
									!convexConfigured ||
									!clerkEnabled ||
									!sharedSpaceName.trim() ||
									busyAction !== null
								}
								onClick={() => void handleCreateSharedSpace()}
							>
								{busyAction === "create-shared-space"
									? "Creating..."
									: "Create"}
							</Button>
						</div>
						<p className="mt-2 text-xs text-muted-foreground">
							This creates the Cloud shared space record. Shared note routing UI
							comes next.
						</p>
						{cloudMessage ? (
							<p className="mt-2 text-xs text-muted-foreground">
								{cloudMessage}
							</p>
						) : null}
					</section>
				)}
				{clerkEnabled && signedIn ? <AccountSessions /> : null}
			</div>
		</>
	);
}

function StatusPill({ active, label }: { active: boolean; label: string }) {
	return (
		<span
			data-active={active}
			className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground data-[active=true]:bg-emerald-500/15 data-[active=true]:text-emerald-500"
		>
			{label}
		</span>
	);
}

function isSyncError(result: unknown): result is { ok: false; error: string } {
	return (
		typeof result === "object" &&
		result !== null &&
		"ok" in result &&
		result.ok === false &&
		"error" in result &&
		typeof result.error === "string"
	);
}

function isGoogleDriveSyncResult(
	result: unknown,
): result is { ok: true; uploaded: number; downloaded: number } {
	return (
		typeof result === "object" &&
		result !== null &&
		"ok" in result &&
		result.ok === true &&
		"uploaded" in result &&
		"downloaded" in result &&
		typeof result.uploaded === "number" &&
		typeof result.downloaded === "number"
	);
}

function syncErrorMessage(error: string) {
	if (error === "missing_google_client_id") {
		return "Missing PAPERITE_GOOGLE_CLIENT_ID.";
	}
	if (error === "google_drive_not_connected") {
		return "Google Drive is not connected yet.";
	}
	if (error === "google_drive_disabled") {
		return "Turn on Google Drive sync first.";
	}

	return error;
}
