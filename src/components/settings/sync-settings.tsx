import { CloudIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { createSharedSpace } from "@/lib/convex";
import { getSyncEngine, onSyncChanged } from "@/lib/sync-engine";
import driveSvg from "/drive.svg";

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
	const syncEngine = getSyncEngine();

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

	const googleDrive = status?.googleDrive;
	const convex = status?.convex;
	const googleDriveEnabled = googleDrive?.enabled === true;
	const googleDriveConnecting = busyAction === "connect" || connectPending;

	return (
		<>
			<DialogHeader className="mb-5 gap-1">
				<DialogTitle className="text-lg">Sync</DialogTitle>
				<DialogDescription>
					Connect personal sync and check collaborative backend status.
				</DialogDescription>
			</DialogHeader>
			<div className="space-y-4">
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
										googleDrive?.configured === false ||
										busyAction !== null ||
										connectPending
									}
									onClick={() =>
										runAction(
											"connect",
											() =>
												syncEngine?.connectGoogleDrive() ??
												Promise.resolve(null),
										)
									}
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
										() => syncEngine?.runGoogleDrive() ?? Promise.resolve(null),
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
								active={convex?.configured === true}
								label={convex?.configured ? "Configured" : "Missing URL"}
							/>
						</div>
						<div className="mt-4 flex gap-2">
							<Input
								value={sharedSpaceName}
								onChange={(event) => setSharedSpaceName(event.target.value)}
								placeholder="Shared space name"
								disabled={!convex?.configured || busyAction !== null}
							/>
							<Button
								type="button"
								size="sm"
								disabled={
									!convex?.configured ||
									!sharedSpaceName.trim() ||
									busyAction !== null
								}
								onClick={() =>
									runAction("create-shared-space", () =>
										createSharedSpace(sharedSpaceName.trim()),
									)
								}
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
