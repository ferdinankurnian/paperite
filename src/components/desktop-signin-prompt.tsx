import { MonitorSmartphoneIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	ensureDesktopBridgeReady,
	getDesktopBridgeSnapshot,
	subscribeDesktopBridge,
} from "@/lib/desktop-bridge-watch";
import { cn } from "@/lib/utils";

/**
 * The browser half of a Paperite installation never signs in itself.
 * Sign-in happens once, on the desktop app; the browser then mirrors that
 * session. This prompt says exactly that and waits for the desktop.
 */
export function DesktopSignInPrompt({
	className,
	onSignedIn,
}: {
	className?: string;
	/** Called when the desktop session becomes available. */
	onSignedIn?: () => void;
}) {
	const [attached, setAttached] = useState(false);
	const [signedIn, setSignedIn] = useState(false);
	const [offline, setOffline] = useState(false);

	useEffect(() => {
		const cancelled = false;
		const sync = () => {
			const bridge = getDesktopBridgeSnapshot();
			if (cancelled) return;
			setAttached(bridge.attached);
			setOffline(bridge.offline);
			const next = bridge.signedIn;
			setSignedIn((previous) => {
				if (next && !previous) onSignedIn?.();
				return next;
			});
		};
		void ensureDesktopBridgeReady();
		sync();
		return subscribeDesktopBridge(sync);
	}, [onSignedIn]);

	const title = offline
		? "Paperite desktop is not running"
		: "Open Paperite on your desktop to sign in";
	const body = offline
		? "Your account is still signed in on the desktop — it just closed. Notes keep working here; cloud sync resumes when you reopen it."
		: attached
			? "The desktop app is running but not signed in yet. Sign in there and this page picks it up automatically."
			: "This browser follows the session of the Paperite desktop app on this machine. Start the desktop app and sign in once.";

	return (
		<div
			className={cn(
				"space-y-3 rounded-xl border border-[#E94C08]/20 bg-[#E94C08]/10 p-4 text-left",
				className,
			)}
		>
			<div className="flex items-start gap-3">
				<MonitorSmartphoneIcon className="mt-0.5 size-4 shrink-0 text-[#ff6a2a]" />
				<div className="min-w-0 space-y-1">
					<p className="text-sm font-medium text-white">{title}</p>
					<p className="text-xs leading-5 text-white/60">{body}</p>
				</div>
			</div>
			<div className="flex items-center gap-2 text-xs text-white/45">
				<span
					className={cn(
						"size-1.5 rounded-full",
						signedIn
							? "bg-emerald-400"
							: attached
								? "bg-amber-400"
								: "bg-white/30",
					)}
				/>
				{signedIn
					? "Signed in — connecting…"
					: attached
						? "Waiting for the desktop to sign in…"
						: "Waiting for the desktop app…"}
			</div>
		</div>
	);
}

/**
 * Small inline variant used where a full card would be too heavy.
 */
export function DesktopSignInHint({ className }: { className?: string }) {
	return (
		<p className={cn("text-xs leading-5 text-muted-foreground", className)}>
			Sign in from the Paperite desktop app on this machine. This browser
			follows that session automatically — no second account, no second login.
		</p>
	);
}

export { Button };
