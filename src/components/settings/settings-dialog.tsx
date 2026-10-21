import {
	CloudIcon,
	FileTextIcon,
	KeyboardIcon,
	LogOutIcon,
	PaletteIcon,
	SparklesIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AccountSessions } from "@/components/settings/account-sessions";
import { KeyboardSettings } from "@/components/settings/keyboard-settings";
import { SyncSettings } from "@/components/settings/sync-settings";
import { useTheme } from "@/components/theme-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isBrowserRenderer } from "@/lib/auth-bridge";
import { useDeviceLabel } from "@/lib/device-info";
import type { PageFormat } from "@/lib/storage/types";
import { useAppStore } from "@/lib/stores/app-store";
import closeBtnAll from "/previews/close-btn-all.png";
import closeBtnCloseOnly from "/previews/close-btn-close-only.png";

const themes = [
	{ label: "Light", value: "light" },
	{ label: "Dark", value: "dark" },
	{ label: "System", value: "system" },
] as const;

// Deterministic gibberish that keeps the email shape (@ and dots) but
// replaces every letter/digit with a random one. Clicking reveals the
// real address.
function scrambleEmail(email: string): string {
	const letters = "abcdefghijklmnopqrstuvwxyz";
	let seed = 0;
	for (const c of email) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
	const rand = () => {
		seed = (seed * 1103515245 + 12345) >>> 0;
		return seed / 2 ** 32;
	};
	return email.replace(/[a-zA-Z0-9]/g, (c) =>
		/\d/.test(c)
			? String(Math.floor(rand() * 10))
			: letters[Math.floor(rand() * letters.length)],
	);
}

export type SettingsTab = "general" | "note" | "keyboard" | "sync" | "account";

export function SettingsDialog({
	open,
	onOpenChange,
	activeTab,
	onActiveTabChange,
	user,
	showNotePreview,
	onSetShowNotePreview,
	closeButtonOnly,
	onSetCloseButtonOnly,
	syncSidebarWithActiveTab,
	onSetSyncSidebarWithActiveTab,
	onRequestLogOut,
	betaEnabled,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	activeTab: SettingsTab;
	onActiveTabChange: (tab: SettingsTab) => void;
	user: { name: string; avatar: string; email: string };
	showNotePreview: boolean;
	onSetShowNotePreview: (show: boolean) => void;
	closeButtonOnly: boolean;
	onSetCloseButtonOnly: (closeButtonOnly: boolean) => void;
	syncSidebarWithActiveTab: boolean;
	onSetSyncSidebarWithActiveTab: (sync: boolean) => void;
	onRequestLogOut: () => void;
	betaEnabled: boolean;
}) {
	const [showEmail, setShowEmail] = useState(false);
	const fakeEmail = useMemo(() => scrambleEmail(user.email), [user.email]);
	const { theme, setTheme } = useTheme();
	const deviceLabel = useDeviceLabel();
	const defaultPageFormat = useAppStore((s) => s.defaultPageFormat);
	const setDefaultPageFormat = useAppStore((s) => s.setDefaultPageFormat);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="h-[min(560px,calc(100svh-2rem))] max-w-3xl gap-0 overflow-hidden p-0 sm:max-w-5xl">
				<div className="grid min-h-0 grid-cols-[225px_minmax(0,1fr)]">
					<aside className="bg-muted/35 p-2">
						{betaEnabled ? (
							<Button
								type="button"
								variant={activeTab === "account" ? "secondary" : "ghost"}
								onClick={() => onActiveTabChange("account")}
								size="lg"
								className="h-auto w-full justify-start gap-2.5 py-2 focus-visible:border-transparent focus-visible:ring-0"
							>
								<Avatar className="size-8 shrink-0 rounded-full">
									<AvatarImage src={user.avatar} alt={user.name} />
									<AvatarFallback className="rounded-full text-xs">
										{user.name
											.split(" ")
											.map((n) => n[0])
											.join("")
											.slice(0, 2)
											.toUpperCase()}
									</AvatarFallback>
								</Avatar>
								<span className="grid min-w-0 flex-1 text-left leading-tight">
									<span className="truncate text-sm font-medium">
										{user.name}
									</span>
									<span className="truncate text-xs text-muted-foreground">
										{deviceLabel}
									</span>
								</span>
							</Button>
						) : null}
						<Button
							type="button"
							variant={activeTab === "general" ? "secondary" : "ghost"}
							onClick={() => onActiveTabChange("general")}
							size="lg"
							className="w-full justify-start focus-visible:border-transparent focus-visible:ring-0"
						>
							<PaletteIcon className="size-4" />
							General
						</Button>
						<Button
							type="button"
							variant={activeTab === "note" ? "secondary" : "ghost"}
							onClick={() => onActiveTabChange("note")}
							size="lg"
							className="w-full justify-start focus-visible:border-transparent focus-visible:ring-0"
						>
							<FileTextIcon className="size-4" />
							Note
						</Button>
						<Button
							type="button"
							variant={activeTab === "keyboard" ? "secondary" : "ghost"}
							onClick={() => onActiveTabChange("keyboard")}
							size="lg"
							className="w-full justify-start focus-visible:border-transparent focus-visible:ring-0"
						>
							<KeyboardIcon className="size-4" />
							Keyboard
						</Button>
						<Button
							type="button"
							variant={activeTab === "sync" ? "secondary" : "ghost"}
							onClick={() => onActiveTabChange("sync")}
							size="lg"
							className="w-full justify-start focus-visible:border-transparent focus-visible:ring-0"
						>
							<CloudIcon className="size-4" />
							Sync
						</Button>
					</aside>
					<div className="min-w-0 overflow-y-auto p-5 sm:p-6">
						{activeTab === "general" && (
							<>
								<DialogHeader className="mb-5">
									<DialogTitle className="text-lg">General</DialogTitle>
								</DialogHeader>
								<section className="flex items-center justify-between gap-4 rounded-xl bg-muted/45 p-4">
									<div>
										<h3 className="text-sm font-medium">Theme</h3>
										<p className="text-xs text-muted-foreground">
											Choose your preferred color scheme.
										</p>
									</div>
									<Tabs
										value={theme}
										onValueChange={(value) =>
											setTheme(value as "light" | "dark" | "system")
										}
									>
										<TabsList className="grid h-10 w-64 grid-cols-3">
											{themes.map(({ label, value }) => (
												<TabsTrigger
													key={value}
													value={value}
													className="h-full transition-[color,background-color,box-shadow,transform] active:scale-[0.96]"
												>
													{label}
												</TabsTrigger>
											))}
										</TabsList>
									</Tabs>
								</section>
								<section className="mt-4 rounded-xl bg-muted/45 p-4">
									<div className="flex items-start justify-between gap-4">
										<div>
											<h3 className="text-sm font-medium">Note previews</h3>
											<p className="text-xs text-muted-foreground">
												Show note content previews in the sidebar.
											</p>
										</div>
										<Tabs
											value={showNotePreview ? "show" : "none"}
											onValueChange={(value) =>
												onSetShowNotePreview(value === "show")
											}
										>
											<TabsList className="grid h-9 w-48 grid-cols-2">
												<TabsTrigger value="show" className="h-full">
													Show
												</TabsTrigger>
												<TabsTrigger value="none" className="h-full">
													None
												</TabsTrigger>
											</TabsList>
										</Tabs>
									</div>
								</section>
								<section className="mt-4 rounded-xl bg-muted/45 p-4">
									<div className="flex items-start justify-between gap-4">
										<div>
											<h3 className="text-sm font-medium">Close button only</h3>
											<p className="text-xs text-muted-foreground">
												Hide minimize and maximize from the custom titlebar.
											</p>
										</div>
										<div className="flex gap-2">
											<button
												type="button"
												onClick={() => onSetCloseButtonOnly(false)}
												className={`group relative overflow-hidden rounded-lg border-2 transition-all ${
													!closeButtonOnly
														? "border-primary ring-2 ring-primary/20"
														: "border-transparent hover:border-muted-foreground/20"
												}`}
											>
												<img
													src={closeBtnAll}
													alt="All buttons"
													className="h-16 w-20 object-cover object-top"
												/>
												<span className="block py-1 text-center text-[10px] font-medium">
													All buttons
												</span>
											</button>
											<button
												type="button"
												onClick={() => onSetCloseButtonOnly(true)}
												className={`group relative overflow-hidden rounded-lg border-2 transition-all ${
													closeButtonOnly
														? "border-primary ring-2 ring-primary/20"
														: "border-transparent hover:border-muted-foreground/20"
												}`}
											>
												<img
													src={closeBtnCloseOnly}
													alt="Close only"
													className="h-16 w-20 object-cover object-top"
												/>
												<span className="block py-1 text-center text-[10px] font-medium">
													Close only
												</span>
											</button>
										</div>
									</div>
								</section>
								<section className="mt-4 rounded-xl bg-muted/45 p-4">
									<div className="flex items-center justify-between gap-4">
										<div>
											<div>
												<h3 className="text-sm font-medium">
													Follow active tab
												</h3>
												<p className="text-xs text-muted-foreground">
													Switch the sidebar to match the space of the active
													tab.
												</p>
											</div>
										</div>
										<Tabs
											value={syncSidebarWithActiveTab ? "follow" : "stay"}
											onValueChange={(value) =>
												onSetSyncSidebarWithActiveTab(value === "follow")
											}
										>
											<TabsList className="grid h-9 w-48 grid-cols-2">
												<TabsTrigger value="follow" className="h-full">
													Follow
												</TabsTrigger>
												<TabsTrigger value="stay" className="h-full">
													Stay
												</TabsTrigger>
											</TabsList>
										</Tabs>
									</div>
								</section>
							</>
						)}
						{activeTab === "note" && (
							<>
								<DialogHeader className="mb-5">
									<DialogTitle className="text-lg">Note</DialogTitle>
								</DialogHeader>
								<section className="rounded-xl bg-muted/45 p-4">
									<div className="mb-3">
										<div>
											<h3 className="text-sm font-medium">Note defaults</h3>
											<p className="text-xs text-muted-foreground">
												Applied to new notes. Per-note setup can still override.
											</p>
										</div>
									</div>
									<div className="space-y-3">
										<div className="flex items-center justify-between gap-4">
											<div>
												<p className="text-sm font-medium">Line height</p>
												<p className="text-xs text-muted-foreground">
													Adjust the spacing between lines.
												</p>
											</div>
											<Tabs
												value={defaultPageFormat.lineHeight}
												onValueChange={(value) =>
													setDefaultPageFormat({
														lineHeight: value as PageFormat["lineHeight"],
													})
												}
											>
												<TabsList className="grid h-9 w-48 grid-cols-2">
													<TabsTrigger value="normal" className="h-full">
														Normal
													</TabsTrigger>
													<TabsTrigger value="1.5" className="h-full">
														1.5
													</TabsTrigger>
												</TabsList>
											</Tabs>
										</div>
										<div className="flex items-center justify-between gap-4">
											<div>
												<p className="text-sm font-medium">Paragraph spacing</p>
												<p className="text-xs text-muted-foreground">
													Adjust the spacing between paragraphs.
												</p>
											</div>
											<Tabs
												value={defaultPageFormat.paragraphSpacing}
												onValueChange={(value) =>
													setDefaultPageFormat({
														paragraphSpacing:
															value as PageFormat["paragraphSpacing"],
													})
												}
											>
												<TabsList className="grid h-9 w-48 grid-cols-2">
													<TabsTrigger value="none" className="h-full">
														None
													</TabsTrigger>
													<TabsTrigger value="spacious" className="h-full">
														Spacious
													</TabsTrigger>
												</TabsList>
											</Tabs>
										</div>
										<div className="flex items-center justify-between gap-4">
											<div>
												<p className="text-sm font-medium">Indentation</p>
												<p className="text-xs text-muted-foreground">
													Control how paragraph lines are indented.
												</p>
											</div>
											<Tabs
												value={defaultPageFormat.indentation}
												onValueChange={(value) =>
													setDefaultPageFormat({
														indentation: value as PageFormat["indentation"],
													})
												}
											>
												<TabsList className="grid h-9 w-52 grid-cols-3">
													<TabsTrigger
														value="none"
														className="h-full px-2 text-xs"
													>
														None
													</TabsTrigger>
													<TabsTrigger
														value="first-line"
														className="h-full px-2 text-xs"
													>
														First line
													</TabsTrigger>
													<TabsTrigger
														value="hanging"
														className="h-full px-2 text-xs"
													>
														Hanging
													</TabsTrigger>
												</TabsList>
											</Tabs>
										</div>
										<div className="flex items-center justify-between gap-4">
											<div>
												<p className="text-sm font-medium">
													Block drag handles
												</p>
												<p className="text-xs text-muted-foreground">
													Show grips to reorder blocks. Per-note setup can
													override this.
												</p>
											</div>
											<Switch
												checked={defaultPageFormat.dragHandle}
												onCheckedChange={(dragHandle) =>
													setDefaultPageFormat({ dragHandle })
												}
												aria-label="Block drag handles default"
											/>
										</div>
									</div>
								</section>
							</>
						)}
						{betaEnabled && activeTab === "account" && (
							<>
								<DialogHeader className="mb-5">
									<DialogTitle className="text-lg">Account</DialogTitle>
								</DialogHeader>
								<section className="rounded-xl bg-muted/45 p-4">
									<div className="flex items-center justify-between gap-3">
										<div className="flex min-w-0 items-center gap-3">
											<Avatar className="size-10 rounded-full">
												<AvatarImage src={user.avatar} alt={user.name} />
												<AvatarFallback className="rounded-full">
													{user.name
														.split(" ")
														.map((n) => n[0])
														.join("")
														.slice(0, 2)
														.toUpperCase()}
												</AvatarFallback>
											</Avatar>
											<div className="min-w-0">
												<h3 className="text-sm font-medium">{user.name}</h3>
												{user.email ? (
													<button
														type="button"
														onClick={() => setShowEmail((v) => !v)}
														title={showEmail ? "Hide email" : "Show email"}
														aria-label={showEmail ? "Hide email" : "Show email"}
														className="flex max-w-full items-center gap-1.5"
													>
														<span
															className={`truncate text-xs text-muted-foreground transition-all ${
																showEmail ? "" : "blur-[2px] select-none"
															}`}
														>
															{showEmail ? user.email : fakeEmail}
														</span>
													</button>
												) : (
													<p className="truncate text-xs text-muted-foreground">
														Free Plan
													</p>
												)}
											</div>
										</div>
										{isBrowserRenderer() ? (
											<p className="shrink-0 text-xs text-muted-foreground">
												Signed in via the desktop app
											</p>
										) : (
											<Button
												type="button"
												variant="destructive"
												size="sm"
												className="shrink-0"
												onClick={onRequestLogOut}
											>
												<LogOutIcon className="size-4" />
												Sign Out
											</Button>
										)}
									</div>
								</section>
								<section className="mt-4 rounded-xl bg-muted/45 p-4">
									<div className="flex items-center justify-between gap-3">
										<div className="flex min-w-0 items-center gap-2">
											<SparklesIcon className="size-4 shrink-0 text-muted-foreground" />
											<div className="min-w-0">
												<h3 className="text-sm font-medium">Join Paperite+</h3>
												<p className="truncate text-xs text-muted-foreground">
													Cloud sync across all your devices.
												</p>
											</div>
										</div>
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="shrink-0"
											onClick={() => onActiveTabChange("sync")}
										>
											Join Paperite+
										</Button>
									</div>
								</section>
								<AccountSessions />
							</>
						)}
						{activeTab === "keyboard" && <KeyboardSettings />}
						{activeTab === "sync" && <SyncSettings />}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
