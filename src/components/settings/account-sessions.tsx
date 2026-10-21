import {
	CheckIcon,
	MonitorIcon,
	MonitorSmartphoneIcon,
	PencilIcon,
	RefreshCwIcon,
	SmartphoneIcon,
	XIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@/components/ui/input-group";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import {
	getBridgeSessions,
	isBrowserRenderer,
	revokeBridgeSession,
	revokeOtherBridgeSessions,
} from "@/lib/auth-bridge";
import type { PaperiteSessionSummary } from "@/lib/auth-sessions";
import { isClerkConfigured } from "@/lib/clerk";
import {
	deviceAliasesChangedEvent,
	getDeviceAliases,
	getInstallationAlias,
	renameDeviceAlias,
	renameInstallationAlias,
} from "@/lib/device-aliases";

type ActiveSession = PaperiteSessionSummary;

function timeAgo(date: Date): string {
	const diffMs = Date.now() - date.getTime();
	if (Number.isNaN(diffMs)) return "unknown";
	const minutes = Math.floor(diffMs / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	return `${Math.floor(months / 12)}y ago`;
}

function sessionTitle(session: ActiveSession): string {
	const activity = session.latestActivity;
	const browser = [activity?.browserName, activity?.browserVersion]
		.filter(Boolean)
		.join(" ");
	if (browser) return browser;
	if (activity?.deviceType) {
		return (
			activity.deviceType.charAt(0).toUpperCase() + activity.deviceType.slice(1)
		);
	}
	return activity?.isMobile ? "Mobile device" : "Unknown device";
}

function sessionSubtitle(session: ActiveSession): string {
	const activity = session.latestActivity;
	const location = [activity?.city, activity?.country]
		.filter(Boolean)
		.join(", ");
	const parts = [
		location || null,
		activity?.ipAddress ? `IP ${activity.ipAddress}` : null,
		`active ${timeAgo(new Date(session.lastActiveAt))}`,
	].filter(Boolean);
	return parts.join(" • ");
}

export function AccountSessions() {
	const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
	const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [revokingId, setRevokingId] = useState<string | null>(null);
	const [revokingOthers, setRevokingOthers] = useState(false);
	const [aliases, setAliases] = useState<Record<string, string>>({});
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [savingId, setSavingId] = useState<string | null>(null);
	const [aliasNotice, setAliasNotice] = useState<string | null>(null);

	const fetchSessions = useCallback(async () => {
		if (!isClerkConfigured()) {
			setError("Sign-in is not configured.");
			setLoading(false);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			if (isBrowserRenderer()) {
				// The browser holds no Clerk session — the desktop lists the
				// account's sessions and ships them over the bridge.
				const list = await getBridgeSessions();
				if (!list) {
					throw new Error(
						"Could not reach the Paperite desktop app. Open it to manage devices.",
					);
				}
				if (!list.sessions.length && !list.currentSessionId) {
					setError("You're not signed in.");
					setSessions(null);
					return;
				}
				setCurrentSessionId(list.currentSessionId);
				setSessions(list.sessions);
				setAliases(getDeviceAliases());
				return;
			}

			const { listAccountSessions } = await import("@/lib/account-sessions");
			const list = await listAccountSessions();
			setCurrentSessionId(list.currentSessionId);
			setSessions(list.sessions);
			setAliases(getDeviceAliases());
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Couldn't load your sessions.",
			);
			setSessions(null);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void fetchSessions();
	}, [fetchSessions]);

	useEffect(() => {
		const syncAliases = () => setAliases(getDeviceAliases());
		syncAliases();
		window.addEventListener(deviceAliasesChangedEvent, syncAliases);
		return () =>
			window.removeEventListener(deviceAliasesChangedEvent, syncAliases);
	}, []);

	const startEditing = (session: ActiveSession) => {
		setEditingId(session.id);
		setDraft(
			session.id === currentSessionId
				? (getInstallationAlias() ?? "")
				: (aliases[session.id] ?? ""),
		);
		setAliasNotice(null);
	};

	const saveAlias = async (session: ActiveSession) => {
		setSavingId(session.id);
		setAliasNotice(null);
		try {
			await renameDeviceAlias(session.id, draft);
			if (session.id === currentSessionId) await renameInstallationAlias(draft);
			setAliases(getDeviceAliases());
			setEditingId(null);
		} catch {
			setAliases(getDeviceAliases());
			setEditingId(null);
			setAliasNotice(
				"Couldn't sync the name — it's saved on this device only.",
			);
		} finally {
			setSavingId(null);
		}
	};

	const handleRevoke = async (session: ActiveSession) => {
		setRevokingId(session.id);
		setError(null);
		try {
			if (isBrowserRenderer()) {
				if (!(await revokeBridgeSession(session.id))) {
					throw new Error("Could not reach the Paperite desktop app.");
				}
			} else {
				const { revokeAccountSession } = await import("@/lib/account-sessions");
				await revokeAccountSession(session.id);
			}
			await fetchSessions();
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Couldn't sign out that device.",
			);
		} finally {
			setRevokingId(null);
		}
	};

	const handleRevokeOthers = async () => {
		if (!sessions) return;
		const others = sessions.filter((s) => s.id !== currentSessionId);
		if (others.length === 0) return;
		setRevokingOthers(true);
		setError(null);
		try {
			if (isBrowserRenderer()) {
				if (!(await revokeOtherBridgeSessions())) {
					throw new Error("Could not reach the Paperite desktop app.");
				}
			} else {
				const { revokeOtherAccountSessions } = await import(
					"@/lib/account-sessions"
				);
				await revokeOtherAccountSessions();
			}
			await fetchSessions();
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Couldn't sign out other devices.",
			);
		} finally {
			setRevokingOthers(false);
		}
	};

	const otherCount =
		sessions?.filter((s) => s.id !== currentSessionId).length ?? 0;

	return (
		<section className="mt-4 rounded-xl bg-muted/45 p-4">
			<div className="mb-3 flex items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<MonitorSmartphoneIcon className="size-4 text-muted-foreground" />
					<div>
						<h3 className="text-sm font-medium">Devices</h3>
						<p className="text-xs text-muted-foreground">
							Where you're currently signed in.
						</p>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{otherCount > 0 ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => void handleRevokeOthers()}
							disabled={loading || revokingOthers || revokingId !== null}
						>
							{revokingOthers ? "Revoking…" : "Revoke others"}
						</Button>
					) : null}
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						onClick={() => void fetchSessions()}
						disabled={loading || revokingOthers}
						aria-label="Refresh devices"
					>
						<RefreshCwIcon className={loading ? "animate-spin" : undefined} />
					</Button>
				</div>
			</div>

			{loading && sessions === null ? (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-14 w-full rounded-lg" />
					<Skeleton className="h-14 w-full rounded-lg" />
				</div>
			) : error && sessions === null ? (
				<div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
					<p className="text-xs text-destructive">{error}</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void fetchSessions()}
					>
						Retry
					</Button>
				</div>
			) : sessions?.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<MonitorSmartphoneIcon />
						</EmptyMedia>
						<EmptyTitle>No active sessions</EmptyTitle>
						<EmptyDescription>
							Your signed-in devices will show up here.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<ItemGroup>
					{sessions?.map((session) => {
						const isCurrent = session.id === currentSessionId;
						const isEditing = editingId === session.id;
						const isSaving = savingId === session.id;
						const Icon = session.latestActivity?.isMobile
							? SmartphoneIcon
							: MonitorIcon;
						const fallbackTitle = sessionTitle(session);
						const alias = aliases[session.id];
						const title = alias || fallbackTitle;
						const baseSubtitle = sessionSubtitle(session);
						const subtitle = alias
							? `${fallbackTitle} • ${baseSubtitle}`
							: baseSubtitle;
						return (
							<Item key={session.id} variant="outline" size="sm">
								<ItemMedia variant="icon">
									<Icon />
								</ItemMedia>
								{isEditing ? (
									<ItemContent>
										<InputGroup>
											<InputGroupInput
												value={draft}
												onChange={(event) =>
													setDraft(event.target.value.slice(0, 40))
												}
												onKeyDown={(event) => {
													if (event.key === "Enter") void saveAlias(session);
													if (event.key === "Escape") setEditingId(null);
												}}
												placeholder={fallbackTitle}
												disabled={isSaving}
												autoFocus
												aria-label="Device name"
											/>
											<InputGroupAddon align="inline-end">
												<InputGroupButton
													size="icon-xs"
													disabled={isSaving}
													onClick={() => void saveAlias(session)}
													aria-label="Save device name"
												>
													<CheckIcon />
												</InputGroupButton>
												<InputGroupButton
													size="icon-xs"
													disabled={isSaving}
													onClick={() => setEditingId(null)}
													aria-label="Cancel renaming"
												>
													<XIcon />
												</InputGroupButton>
											</InputGroupAddon>
										</InputGroup>
									</ItemContent>
								) : (
									<ItemContent>
										<ItemTitle className="min-w-0">
											<span className="truncate">{title}</span>
											{isCurrent ? (
												<Badge variant="secondary">This device</Badge>
											) : null}
										</ItemTitle>
										<ItemDescription>{subtitle}</ItemDescription>
									</ItemContent>
								)}
								{isEditing ? null : (
									<ItemActions>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											disabled={
												isSaving || revokingId !== null || revokingOthers
											}
											onClick={() => startEditing(session)}
											aria-label={`Rename ${title}`}
											title="Rename device"
										>
											<PencilIcon />
										</Button>
										{isCurrent ? null : (
											<Button
												type="button"
												variant="outline"
												size="sm"
												disabled={revokingId === session.id || revokingOthers}
												onClick={() => void handleRevoke(session)}
											>
												{revokingId === session.id ? "Revoking…" : "Revoke"}
											</Button>
										)}
									</ItemActions>
								)}
							</Item>
						);
					})}
				</ItemGroup>
			)}

			{aliasNotice ? (
				<p className="mt-2 text-xs text-muted-foreground">{aliasNotice}</p>
			) : null}
			{error && sessions !== null ? (
				<p className="mt-2 text-xs text-destructive">{error}</p>
			) : null}
		</section>
	);
}
