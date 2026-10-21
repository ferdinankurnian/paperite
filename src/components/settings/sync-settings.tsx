import { CloudIcon, PlusIcon, ServerIcon, UnplugIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AccountSessions } from "@/components/settings/account-sessions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { isBrowserRenderer } from "@/lib/auth-bridge";
import { clerk, isClerkConfigured, loadClerk } from "@/lib/clerk";
import { deletePersonalServerCredential } from "@/lib/credential-store";
import { subscribeDesktopBridge } from "@/lib/desktop-bridge-watch";
import { getPaperiteSession } from "@/lib/paperite-auth";
import {
	discoverPersonalServer,
	normalizePersonalServerEndpoint,
	normalizeServerIdentity,
	pairPersonalServer,
	testPersonalServerConnection,
} from "@/lib/personal-server-provider";
import {
	affectedSpaces,
	type ConnectionMetadata,
} from "@/lib/space-sync-targets";
import { useAppStore } from "@/lib/stores/app-store";
import { createSharedSpace, useSyncUrl } from "@/lib/sync-provider";

function connectionTitle(
	connection: Pick<ConnectionMetadata, "displayLabel" | "serverIdentity">,
): string {
	const identity = connection.serverIdentity;
	return identity
		? `${identity.icon} ${identity.name}`
		: connection.displayLabel;
}

export function SyncSettings() {
	const clerkEnabled = isClerkConfigured();
	const syncConfigured = useSyncUrl() !== null;
	const [signedIn, setSignedIn] = useState(false);
	const [authSource, setAuthSource] = useState<
		"desktop-bridge" | "clerk" | "none"
	>("none");
	const [addOpen, setAddOpen] = useState(false);
	const [serverEndpoint, setServerEndpoint] = useState("");
	const [serverLabel, setServerLabel] = useState("Personal server");
	const [serverChallengeId, setServerChallengeId] = useState("");
	const [serverChallengeToken, setServerChallengeToken] = useState("");
	const [serverId, setServerId] = useState<string | null>(null);
	const [serverStatus, setServerStatus] = useState<string | null>(null);
	const [cloudMessage, setCloudMessage] = useState<string | null>(null);
	const [sharedSpaceName, setSharedSpaceName] = useState("");
	const [busy, setBusy] = useState(false);
	const disconnectingIdRef = useRef<string | null>(null);
	const connections = useAppStore((state) => state.connections);
	const spaceSyncTargets = useAppStore((state) => state.spaceSyncTargets);
	const setConnection = useAppStore((state) => state.setConnection);
	const removeConnection = useAppStore((state) => state.removeConnection);
	const setLocalOnly = useAppStore((state) => state.setLocalOnly);

	useEffect(() => {
		if (!clerkEnabled) return;
		let cancelled = false;
		const syncSession = () => {
			void getPaperiteSession().then((session) => {
				if (cancelled) return;
				setSignedIn(session.signedIn);
				setAuthSource(session.source);
			});
		};
		let detach: (() => void) | undefined;
		try {
			detach = clerk.addListener(syncSession);
		} catch {
			// The explicit load below still syncs the initial session.
		}
		void loadClerk()
			.then(syncSession)
			.catch(() => undefined);
		const bridgePoll = isBrowserRenderer()
			? subscribeDesktopBridge(syncSession)
			: undefined;
		return () => {
			cancelled = true;
			detach?.();
			bridgePoll?.();
		};
	}, [clerkEnabled]);

	const openSignIn = () =>
		window.dispatchEvent(new Event("paperite:open-auth"));

	const discoverServer = async () => {
		if (clerkEnabled && !signedIn) {
			setServerStatus("Sign in before adding a personal server.");
			openSignIn();
			return;
		}
		setServerStatus("Discovering server capabilities…");
		try {
			const endpoint = normalizePersonalServerEndpoint(serverEndpoint);
			const capabilities = await discoverPersonalServer(endpoint);
			setServerId(capabilities.serverId);
			const identity = normalizeServerIdentity(capabilities.identity);
			setServerStatus(
				`Found ${identity.icon} ${identity.name} · enter the one-time pairing challenge to connect it.`,
			);
		} catch (error) {
			setServerStatus(
				error instanceof Error ? error.message : "Could not reach the server.",
			);
		}
	};

	const pairServer = async () => {
		if (
			!serverId ||
			!serverChallengeId.trim() ||
			!serverChallengeToken.trim()
		) {
			setServerStatus("Enter the one-time pairing challenge from the server.");
			return;
		}
		try {
			const endpoint = normalizePersonalServerEndpoint(serverEndpoint);
			const result = await pairPersonalServer({
				endpoint,
				connectionId: `personal-server:${serverId}`,
				displayLabel: serverLabel.trim() || "Personal server",
				deviceLabel: "Paperite desktop",
				challengeId: serverChallengeId.trim(),
				challengeToken: serverChallengeToken.trim(),
			});
			setConnection(result.connection);
			const { syncPersonalServerToClerk } = await import(
				"@/lib/clerk-server-sync"
			);
			void syncPersonalServerToClerk(result.connection);
			setServerStatus(`${result.connection.displayLabel} is connected.`);
			setServerEndpoint("");
			setServerLabel("Personal server");
			setServerChallengeId("");
			setServerChallengeToken("");
			setServerId(null);
		} catch (error) {
			setServerStatus(
				error instanceof Error ? error.message : "Pairing failed. Try again.",
			);
		}
	};

	const testConnection = async (connection: ConnectionMetadata) => {
		if (!connection.endpoint || connection.kind !== "paperite-server") return;
		setServerStatus(`Testing ${connection.displayLabel}…`);
		try {
			const result = await testPersonalServerConnection({
				endpoint: connection.endpoint,
				serverId: connection.serverId,
				connectionId: connection.connectionId,
			});
			setConnection({
				...connection,
				serverIdentity: result.capabilities.identity
					? normalizeServerIdentity(result.capabilities.identity)
					: connection.serverIdentity,
				status: result.paired ? "connected" : "needs-auth",
				updatedAt: Date.now(),
			});
			setServerStatus(
				result.paired
					? `${connectionTitle(connection)} is reachable.`
					: `${connectionTitle(connection)} needs pairing.`,
			);
		} catch (error) {
			setServerStatus(
				error instanceof Error ? error.message : "Connection test failed.",
			);
		}
	};

	const disconnectServer = async (connectionId: string) => {
		const affected = affectedSpaces({ spaceSyncTargets }, connectionId);
		if (affected.length > 0 && disconnectingIdRef.current !== connectionId) {
			disconnectingIdRef.current = connectionId;
			setServerStatus(
				`${affected.length} space${affected.length === 1 ? "" : "s"} use this server. Disconnect again to keep them local.`,
			);
			return;
		}
		for (const spacePath of affected) setLocalOnly(spacePath);
		await deletePersonalServerCredential(connectionId);
		const { removePersonalServerFromClerk } = await import(
			"@/lib/clerk-server-sync"
		);
		void removePersonalServerFromClerk(connectionId);
		removeConnection(connectionId);
		disconnectingIdRef.current = null;
		setServerStatus(
			"Disconnected. Local notes were kept; remote data was not deleted.",
		);
	};

	const createCloudSpace = async () => {
		if (!sharedSpaceName.trim()) return;
		if (!clerkEnabled || !signedIn) {
			openSignIn();
			return;
		}
		setBusy(true);
		setCloudMessage(null);
		try {
			const result = await createSharedSpace(sharedSpaceName.trim());
			if (isSyncError(result)) setCloudMessage(result.error);
			else {
				setSharedSpaceName("");
				setCloudMessage("Shared space created in Paperite+.");
			}
		} catch (error) {
			setCloudMessage(
				error instanceof Error
					? error.message
					: "Could not create the shared space.",
			);
		} finally {
			setBusy(false);
		}
	};

	const personalServers = Object.values(connections).filter(
		(connection) => connection.kind === "paperite-server",
	);

	return (
		<>
			<DialogHeader className="mb-6">
				<DialogTitle className="text-lg">Sync connections</DialogTitle>
			</DialogHeader>
			<div className="space-y-6">
				{!clerkEnabled ? (
					<p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5">
						Sign-in is not configured in this build. Paperite+ and
						personal-server connections stay disabled; your notes remain local.
					</p>
				) : !signedIn ? (
					<div className="flex items-center justify-between gap-3 rounded-xl border p-3">
						<p className="text-xs leading-5 text-muted-foreground">
							You’re browsing locally. Sign in to use Paperite+ and personal
							servers.
						</p>
						<Button type="button" size="sm" onClick={openSignIn}>
							Sign in
						</Button>
					</div>
				) : null}
				<section className="space-y-3">
					<div
						aria-disabled={!clerkEnabled || !signedIn}
						className={`flex items-center gap-3 rounded-xl bg-muted/35 p-4 transition-opacity ${!clerkEnabled || !signedIn ? "opacity-50" : ""}`}
					>
						<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<CloudIcon className="size-4" />
						</div>
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2">
								<h3 className="text-sm font-medium">Paperite+ subscription</h3>
							</div>
							<p className="mt-1 text-xs text-muted-foreground">
								Paperite’s hosted cloud. Always available as a sync target.
							</p>
						</div>
					</div>
				</section>

				<section className="space-y-3">
					<div className="flex items-center justify-between">
						<SectionLabel>Paperite servers</SectionLabel>
						<Button
							type="button"
							size="sm"
							onClick={() => {
								setAddOpen((open) => !open);
								setServerStatus(null);
							}}
							className="gap-1.5 active:scale-[0.96]"
							disabled={!clerkEnabled || !signedIn}
						>
							<PlusIcon className="size-3.5" /> Add server
						</Button>
					</div>
					{personalServers.length === 0 ? (
						<div className="rounded-xl border border-dashed p-5 text-center">
							<ServerIcon className="mx-auto size-5 text-muted-foreground" />
							<p className="mt-2 text-sm font-medium">
								No personal servers connected
							</p>
							<p className="mt-1 text-xs text-muted-foreground">
								Connect a Paperite server to make it available to your spaces.
							</p>
						</div>
					) : (
						<div className="space-y-2">
							{personalServers.map((connection) => (
								<div
									key={connection.connectionId}
									className="flex items-center gap-3 rounded-xl bg-muted/35 p-4"
								>
									<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
										<ServerIcon className="size-4" />
									</div>
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<h3 className="truncate text-sm font-medium">
												{connectionTitle(connection)}
											</h3>
											<StatusPill
												active={connection.status === "connected"}
												label={
													connection.status === "connected"
														? "Connected"
														: connection.status === "needs-auth"
															? "Needs pairing"
															: "Unavailable"
												}
											/>
										</div>
										<p className="mt-1 truncate text-xs text-muted-foreground">
											{connection.displayLabel}
											{connection.endpoint ? ` · ${connection.endpoint}` : ""}
										</p>
									</div>
									<div className="flex shrink-0 gap-1.5">
										<Button
											type="button"
											size="sm"
											variant="outline"
											onClick={() => void testConnection(connection)}
										>
											Test
										</Button>
										<Button
											type="button"
											size="sm"
											variant="ghost"
											onClick={() =>
												void disconnectServer(connection.connectionId)
											}
											className="gap-1.5 text-muted-foreground"
										>
											<UnplugIcon className="size-3.5" /> Disconnect
										</Button>
									</div>
								</div>
							))}
						</div>
					)}
				</section>

				<Dialog open={addOpen} onOpenChange={setAddOpen}>
					<DialogContent className="sm:max-w-lg">
						<DialogHeader>
							<DialogTitle>Add Paperite server</DialogTitle>
						</DialogHeader>
						<div className="space-y-4">
							<p className="text-sm text-muted-foreground">
								Pair this device with a server over localhost or a private HTTPS
								endpoint.
							</p>
							<div className="grid gap-2 sm:grid-cols-2">
								<Input
									value={serverLabel}
									onChange={(event) => setServerLabel(event.target.value)}
									placeholder="Connection name"
								/>
								<Input
									value={serverEndpoint}
									onChange={(event) => setServerEndpoint(event.target.value)}
									placeholder="https://machine.ts.net"
								/>
							</div>
							<Button
								type="button"
								variant="outline"
								onClick={() => void discoverServer()}
								disabled={!serverEndpoint.trim()}
							>
								Discover server
							</Button>
							{serverId ? (
								<div className="grid gap-2 sm:grid-cols-2">
									<Input
										value={serverChallengeId}
										onChange={(event) =>
											setServerChallengeId(event.target.value)
										}
										placeholder="Challenge ID"
									/>
									<Input
										value={serverChallengeToken}
										onChange={(event) =>
											setServerChallengeToken(event.target.value)
										}
										placeholder="One-time challenge token"
										type="password"
									/>
									<Button type="button" onClick={() => void pairServer()}>
										Pair and save
									</Button>
								</div>
							) : null}
							{serverStatus ? (
								<p className="text-xs text-muted-foreground">{serverStatus}</p>
							) : null}
						</div>
					</DialogContent>
				</Dialog>

				{import.meta.env.BETA_PAPERITE ? (
					<section className="space-y-3 rounded-xl bg-muted/35 p-4">
						<div>
							<h3 className="text-sm font-medium">Create a shared space</h3>
							<p className="mt-1 text-xs text-muted-foreground">
								Create a collaborative space in Paperite+.
							</p>
						</div>
						<div className="flex gap-2">
							<Input
								value={sharedSpaceName}
								onChange={(event) => setSharedSpaceName(event.target.value)}
								placeholder="Shared space name"
								disabled={!syncConfigured || !clerkEnabled || !signedIn || busy}
							/>
							<Button
								type="button"
								size="sm"
								disabled={
									!syncConfigured ||
									!clerkEnabled ||
									!signedIn ||
									!sharedSpaceName.trim() ||
									busy
								}
								onClick={() => void createCloudSpace()}
							>
								{busy ? "Creating…" : "Create"}
							</Button>
						</div>
						{cloudMessage ? (
							<p className="text-xs text-muted-foreground">{cloudMessage}</p>
						) : null}
					</section>
				) : null}

				{clerkEnabled && signedIn && authSource !== "desktop-bridge" ? (
					<AccountSessions />
				) : null}
			</div>
		</>
	);
}

function SectionLabel({ children }: { children: ReactNode }) {
	return (
		<h2 className="text-xs font-medium text-muted-foreground">{children}</h2>
	);
}

function StatusPill({ active, label }: { active: boolean; label: string }) {
	return (
		<span
			data-active={active}
			className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground data-[active=true]:bg-emerald-500/15 data-[active=true]:text-emerald-500"
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
