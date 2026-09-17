import {
	FileTextIcon,
	IndentIcon,
	KeyboardIcon,
	LaptopIcon,
	LogOutIcon,
	MoonIcon,
	PaletteIcon,
	PanelLeftIcon,
	SunIcon,
	UserRoundIcon,
} from "lucide-react";
import { useAppStore } from "@/lib/stores/app-store";
import { useTheme } from "@/components/theme-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PageFormat } from "@/lib/storage/types";
import { KeyboardSettings } from "@/components/settings/keyboard-settings";

const themes = [
	{ icon: SunIcon, label: "Light", value: "light" },
	{ icon: MoonIcon, label: "Dark", value: "dark" },
	{ icon: LaptopIcon, label: "System", value: "system" },
] as const;

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
	user: { name: string; avatar: string };
	showNotePreview: boolean;
	onSetShowNotePreview: (show: boolean) => void;
	closeButtonOnly: boolean;
	onSetCloseButtonOnly: (closeButtonOnly: boolean) => void;
	syncSidebarWithActiveTab: boolean;
	onSetSyncSidebarWithActiveTab: (sync: boolean) => void;
	onRequestLogOut: () => void;
	betaEnabled: boolean;
}) {
	const { theme, setTheme } = useTheme();
	const defaultPageFormat = useAppStore((s) => s.defaultPageFormat);
	const setDefaultPageFormat = useAppStore((s) => s.setDefaultPageFormat);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="h-[min(560px,calc(100svh-2rem))] max-w-3xl gap-0 overflow-hidden p-0 sm:max-w-4xl">
				<div className="grid min-h-0 grid-cols-[190px_minmax(0,1fr)]">
					<aside className="border-r bg-muted/35 p-2">
						<p className="px-2 py-2 text-xs font-medium text-muted-foreground">
							Settings
						</p>
						<Button
							type="button"
							variant={activeTab === "general" ? "secondary" : "ghost"}
							onClick={() => onActiveTabChange("general")}
							className="w-full justify-start"
						>
							<PaletteIcon className="size-4" />
							General
						</Button>
						<Button
							type="button"
							variant={activeTab === "note" ? "secondary" : "ghost"}
							onClick={() => onActiveTabChange("note")}
							className="w-full justify-start"
						>
							<FileTextIcon className="size-4" />
							Note
						</Button>
						<Button
							type="button"
							variant={activeTab === "keyboard" ? "secondary" : "ghost"}
							onClick={() => onActiveTabChange("keyboard")}
							className="w-full justify-start"
						>
							<KeyboardIcon className="size-4" />
							Keyboard
						</Button>
						{betaEnabled ? (
							<Button
								type="button"
								variant={activeTab === "account" ? "secondary" : "ghost"}
								onClick={() => onActiveTabChange("account")}
								className="w-full justify-start"
							>
								<UserRoundIcon className="size-4" />
								Account
							</Button>
						) : null}
					</aside>
					<div className="min-w-0 overflow-y-auto p-5 sm:p-6">
						{activeTab === "general" && (
							<>
								<DialogHeader className="mb-5 gap-1">
									<DialogTitle className="text-lg">General</DialogTitle>
									<DialogDescription>
										Manage your Paperite preferences.
									</DialogDescription>
								</DialogHeader>
								<section className="rounded-xl bg-muted/45 p-4">
									<div className="mb-3 flex items-center gap-2">
										<PaletteIcon className="size-4 text-muted-foreground" />
										<div>
											<h3 className="text-sm font-medium">Theme</h3>
											<p className="text-xs text-muted-foreground">
												Choose your preferred color scheme.
											</p>
										</div>
									</div>
									<Tabs
										value={theme}
										onValueChange={(value) =>
											setTheme(value as "light" | "dark" | "system")
										}
									>
										<TabsList className="grid h-10 w-full grid-cols-3">
											{themes.map(({ icon: Icon, label, value }) => (
												<TabsTrigger
													key={value}
													value={value}
													className="h-full gap-1.5 transition-[color,background-color,box-shadow,transform] active:scale-[0.96]"
												>
													<Icon className="size-4" />
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
										<div className="flex gap-2">
											<button
												type="button"
												onClick={() => onSetShowNotePreview(true)}
												className={`group relative overflow-hidden rounded-lg border-2 transition-all ${
													showNotePreview
														? "border-primary ring-2 ring-primary/20"
														: "border-transparent hover:border-muted-foreground/20"
												}`}
											>
												<img
													src="/previews/note-previews-show.png"
													alt="Show"
													className="h-16 w-20 object-cover object-left"
												/>
												<span className="block py-1 text-center text-[10px] font-medium">
													Show
												</span>
											</button>
											<button
												type="button"
												onClick={() => onSetShowNotePreview(false)}
												className={`group relative overflow-hidden rounded-lg border-2 transition-all ${
													!showNotePreview
														? "border-primary ring-2 ring-primary/20"
														: "border-transparent hover:border-muted-foreground/20"
												}`}
											>
												<img
													src="/previews/note-previews-hide.png"
													alt="Hide"
													className="h-16 w-20 object-cover object-left"
												/>
												<span className="block py-1 text-center text-[10px] font-medium">
													Hide
												</span>
											</button>
										</div>
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
													src="/previews/close-btn-all.png"
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
													src="/previews/close-btn-close-only.png"
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
										<div className="flex items-center gap-2">
											<PanelLeftIcon className="size-4 text-muted-foreground" />
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
										<Switch
											checked={syncSidebarWithActiveTab}
											onCheckedChange={(checked) =>
												onSetSyncSidebarWithActiveTab(checked)
											}
										/>
									</div>
								</section>
							</>
						)}
						{activeTab === "note" && (
							<>
								<DialogHeader className="mb-5 gap-1">
									<DialogTitle className="text-lg">Note</DialogTitle>
									<DialogDescription>
										Manage your note preferences and defaults.
									</DialogDescription>
								</DialogHeader>
								<section className="rounded-xl bg-muted/45 p-4">
									<div className="mb-3 flex items-center gap-2">
										<IndentIcon className="size-4 text-muted-foreground" />
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
									<TabsTrigger value="none" className="h-full px-2 text-xs">
										None
									</TabsTrigger>
									<TabsTrigger value="first-line" className="h-full px-2 text-xs">
										First line
									</TabsTrigger>
									<TabsTrigger value="hanging" className="h-full px-2 text-xs">
										Hanging
									</TabsTrigger>
								</TabsList>
							</Tabs>
						</div>
									</div>
								</section>
							</>
						)}
						{betaEnabled && activeTab === "account" && (
							<>
								<DialogHeader className="mb-5 gap-1">
									<DialogTitle className="text-lg">Account</DialogTitle>
									<DialogDescription>
										Manage your account and preferences.
									</DialogDescription>
								</DialogHeader>
								<section className="rounded-xl bg-muted/45 p-4">
									<div className="flex items-center gap-3">
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
											<p className="truncate text-xs text-muted-foreground">
												Free Plan
											</p>
										</div>
									</div>
								</section>
								<section className="mt-4 rounded-xl bg-muted/45 p-4">
									<div className="mb-3 flex items-center gap-2">
										<UserRoundIcon className="size-4 text-muted-foreground" />
										<div>
											<h3 className="text-sm font-medium">Profile</h3>
											<p className="text-xs text-muted-foreground">
												Your account details from Clerk.
											</p>
										</div>
									</div>
									<div className="space-y-3">
										<div>
											<p className="text-xs font-medium text-muted-foreground">
												Full Name
											</p>
											<p className="text-sm">{user.name}</p>
										</div>
									</div>
								</section>
								<section className="mt-4 rounded-xl bg-muted/45 p-4">
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											<LogOutIcon className="size-4 text-muted-foreground" />
											<div>
												<h3 className="text-sm font-medium">Sign Out</h3>
												<p className="text-xs text-muted-foreground">
													Sign out of your account on this device.
												</p>
											</div>
										</div>
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={onRequestLogOut}
										>
											Sign Out
										</Button>
									</div>
								</section>
							</>
						)}
						{activeTab === "keyboard" && <KeyboardSettings />}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
