import {
	MonitorIcon,
	MonitorSmartphoneIcon,
	RefreshCwIcon,
	SmartphoneIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { clerk, isClerkConfigured, loadClerk } from "@/lib/clerk";

type ActiveSession = Awaited<
	ReturnType<NonNullable<typeof clerk.user>["getSessions"]>
>[number];

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

	const fetchSessions = useCallback(async () => {
		if (!isClerkConfigured()) {
			setError("Sign-in is not configured.");
			setLoading(false);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			await loadClerk();
			const user = clerk.user;
			if (!user) {
				setError("You're not signed in.");
				setSessions(null);
				return;
			}
			setCurrentSessionId(clerk.session?.id ?? null);
			const list = await user.getSessions();
			const sorted = [...list].sort((a, b) => {
				if (a.id === clerk.session?.id) return -1;
				if (b.id === clerk.session?.id) return 1;
				return (
					new Date(b.lastActiveAt).getTime() -
					new Date(a.lastActiveAt).getTime()
				);
			});
			setSessions(sorted);
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

	const handleRevoke = async (session: ActiveSession) => {
		setRevokingId(session.id);
		setError(null);
		try {
			await session.revoke();
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
			await Promise.all(others.map((s) => s.revoke()));
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
						<RefreshCwIcon
							className={loading ? "size-4 animate-spin" : "size-4"}
						/>
					</Button>
				</div>
			</div>

			{loading && sessions === null ? (
				<div className="space-y-2">
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
				<p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
					No active sessions found.
				</p>
			) : (
				<ul className="space-y-2">
					{sessions?.map((session) => {
						const isCurrent = session.id === currentSessionId;
						const Icon = session.latestActivity?.isMobile
							? SmartphoneIcon
							: MonitorIcon;
						return (
							<li
								key={session.id}
								className="flex items-center justify-between gap-3 rounded-lg border bg-background/60 px-3 py-2.5"
							>
								<div className="flex min-w-0 items-center gap-2.5">
									<Icon className="size-4 shrink-0 text-muted-foreground" />
									<div className="min-w-0">
										<div className="flex items-center gap-2">
											<p className="truncate text-sm font-medium">
												{sessionTitle(session)}
											</p>
											{isCurrent ? (
												<span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
													This device
												</span>
											) : null}
										</div>
										<p className="truncate text-xs text-muted-foreground">
											{sessionSubtitle(session)}
										</p>
									</div>
								</div>
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
							</li>
						);
					})}
				</ul>
			)}

			{error && sessions !== null ? (
				<p className="mt-2 text-xs text-destructive">{error}</p>
			) : null}
		</section>
	);
}
