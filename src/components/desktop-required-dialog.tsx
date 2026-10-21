import { MonitorOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	ensureDesktopBridgeReady,
	getDesktopBridgeSnapshot,
	refreshDesktopBridge,
	subscribeDesktopBridge,
} from "@/lib/desktop-bridge-watch";

/**
 * A browser surface has no session of its own — it mirrors the desktop.
 * So when the desktop goes away, the browser has lost the ability to sign
 * in, sync, or manage devices. Rather than pretend everything is fine, this
 * blocks on it: the message cannot be dismissed until the desktop is back.
 */
export function DesktopRequiredDialog() {
	const [state, setState] = useState(getDesktopBridgeSnapshot());

	useEffect(() => {
		void ensureDesktopBridgeReady();
		return subscribeDesktopBridge(() => setState(getDesktopBridgeSnapshot()));
	}, []);

	// Block whenever no desktop is attached. That covers both cases: the
	// desktop was never started, and the desktop was running and has since
	// been closed (the server still remembers the session, so `signedIn`
	// stays true and cannot be used as the signal). The only thing that
	// must not block is the window before the first answer arrives.
	const blocked = state.ready && !state.attached;

	useEffect(() => {
		if (!blocked) return;
		const onKeyDown = (event: KeyboardEvent) => {
			// Nothing here is dismissible, so make sure the tab cannot be
			// escaped either.
			if (event.key === "Escape") event.preventDefault();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [blocked]);

	return (
		<Dialog open={blocked} onOpenChange={() => {}}>
			<DialogContent
				showCloseButton={false}
				onEscapeKeyDown={(event) => event.preventDefault()}
				onPointerDownOutside={(event) => event.preventDefault()}
				className="sm:max-w-md"
			>
				{/* DialogContent is a two column grid. Wrapping everything in
				    one element keeps it in a single full width cell, so the
				    icon, the copy and the button all line up in the middle
				    instead of spilling into the second column. */}
				<div className="flex flex-col items-center gap-5 text-center">
					<DialogHeader className="items-center gap-3 text-center">
						<div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-destructive/10">
							<MonitorOffIcon className="size-5 text-destructive" />
						</div>
						<DialogTitle className="text-center text-balance">
							{state.offline
								? "Paperite desktop is closed"
								: "Open Paperite desktop to continue"}
						</DialogTitle>
						<DialogDescription className="text-center text-pretty">
							{state.offline
								? `${state.user?.fullName ?? state.user?.email ?? "Your account"} is still signed in on the Paperite desktop app — it just closed.`
								: "This browser has no account of its own. It follows the session of the Paperite desktop app, so open the desktop to sign in."}{" "}
							Notes stay safe on disk, but sign-in, cloud sync, and device
							management need the desktop app running.
						</DialogDescription>
					</DialogHeader>
					<div className="flex w-full flex-col items-center gap-2.5">
						<Button
							type="button"
							onClick={() => {
								// Launch the desktop app through the protocol it
								// registers. If the app is not installed the
								// browser shows its own error and we keep waiting.
								window.location.href = "paperite://";
								void refreshDesktopBridge();
							}}
							className="w-full"
						>
							Open Paperite desktop
						</Button>
						<p className="text-center text-xs text-muted-foreground text-pretty">
							This message closes by itself once the desktop app is running
							again.
						</p>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
