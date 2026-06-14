import {
	ChevronsUpDownIcon,
	CloudIcon,
	KeyboardIcon,
	LaptopIcon,
	LogOutIcon,
	MoonIcon,
	PaletteIcon,
	RotateCcwIcon,
	SearchIcon,
	SettingsIcon,
	SunIcon,
	UserRoundIcon,
} from "lucide-react";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useKeyboardShortcuts } from "@/components/keyboard-shortcuts-provider";
import { useTheme } from "@/components/theme-provider";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	type CommandDefinition,
	type CommandId,
	commands,
} from "@/lib/commands";
import { createSharedSpace } from "@/lib/convex";
import {
	findShortcutConflict,
	formatShortcut,
	normalizeShortcut,
} from "@/lib/shortcuts";
import { getSyncEngine, onSyncChanged } from "@/lib/sync-engine";
import { cn } from "@/lib/utils";

const themes = [
	{ icon: SunIcon, label: "Light", value: "light" },
	{ icon: MoonIcon, label: "Dark", value: "dark" },
	{ icon: LaptopIcon, label: "System", value: "system" },
] as const;

export function NavUser({
	onLogOut,
	user,
}: {
	onLogOut: () => void | Promise<void>;
	user: {
		name: string;
		avatar: string;
	};
}) {
	const { isMobile } = useSidebar();
	const { theme, setTheme } = useTheme();
	const shortcutSettings = useKeyboardShortcuts();
	const [isLogoutDialogOpen, setIsLogoutDialogOpen] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [activeTab, setActiveTab] = useState<
		"general" | "keyboard" | "sync" | "account"
	>("general");

	useEffect(() => {
		const openSettings = () => {
			setActiveTab("sync");
			setIsSettingsOpen(true);
		};

		window.addEventListener("paperite:open-settings", openSettings);
		return () =>
			window.removeEventListener("paperite:open-settings", openSettings);
	}, []);

	return (
		<>
			<SidebarMenu>
				<SidebarMenuItem>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<SidebarMenuButton
								size="lg"
								className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
							>
								<Avatar className="size-8 rounded-lg">
									<AvatarImage src={user.avatar} alt={user.name} />
									<AvatarFallback className="rounded-lg">IY</AvatarFallback>
								</Avatar>
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-medium">{user.name}</span>
									<span className="truncate text-xs">Free Plan</span>
								</div>
								<ChevronsUpDownIcon className="ml-auto size-4" />
							</SidebarMenuButton>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
							side={isMobile ? "bottom" : "right"}
							align="end"
							sideOffset={4}
						>
							<DropdownMenuLabel className="p-0 font-normal">
								<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
									<Avatar className="size-8 rounded-lg">
										<AvatarImage src={user.avatar} alt={user.name} />
										<AvatarFallback className="rounded-lg">IY</AvatarFallback>
									</Avatar>
									<div className="grid flex-1 text-left text-sm leading-tight">
										<span className="truncate font-medium">{user.name}</span>
										<span className="truncate text-xs">Free Plan</span>
									</div>
								</div>
							</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								onSelect={() => {
									setActiveTab("general");
									setIsSettingsOpen(true);
								}}
							>
								<SettingsIcon />
								Settings
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuLabel className="px-2 pb-1 text-xs text-muted-foreground">
								Theme
							</DropdownMenuLabel>
							<Tabs
								value={theme}
								onValueChange={(value) =>
									setTheme(value as "light" | "dark" | "system")
								}
								className="px-1 pb-1"
							>
								<TabsList className="grid h-9 w-full grid-cols-3">
									{themes.map(({ icon: Icon, label, value }) => (
										<TabsTrigger
											key={value}
											value={value}
											aria-label={label}
											title={label}
											className="h-full transition-[color,background-color,box-shadow,transform] active:scale-[0.96]"
										>
											<Icon className="size-4" />
											<span className="sr-only">{label}</span>
										</TabsTrigger>
									))}
								</TabsList>
							</Tabs>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								onSelect={(event) => {
									event.preventDefault();
									setIsLogoutDialogOpen(true);
								}}
							>
								<LogOutIcon />
								Log out
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</SidebarMenuItem>
			</SidebarMenu>
			<Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
				<DialogContent className="h-[min(560px,calc(100svh-2rem))] max-w-3xl gap-0 overflow-hidden p-0 sm:max-w-3xl">
					<div className="grid min-h-0 grid-cols-[168px_minmax(0,1fr)]">
						<aside className="border-r bg-muted/35 p-3">
							<p className="px-2 pb-2 text-xs font-medium text-muted-foreground">
								Settings
							</p>
							<Button
								type="button"
								variant={activeTab === "general" ? "secondary" : "ghost"}
								onClick={() => setActiveTab("general")}
								className="w-full justify-start"
							>
								<PaletteIcon className="size-4" />
								General
							</Button>
							<Button
								type="button"
								variant={activeTab === "keyboard" ? "secondary" : "ghost"}
								onClick={() => setActiveTab("keyboard")}
								className="w-full justify-start"
							>
								<KeyboardIcon className="size-4" />
								Keyboard
							</Button>
							<Button
								type="button"
								variant={activeTab === "sync" ? "secondary" : "ghost"}
								onClick={() => setActiveTab("sync")}
								className="w-full justify-start"
							>
								<CloudIcon className="size-4" />
								Sync
							</Button>
							<Button
								type="button"
								variant={activeTab === "account" ? "secondary" : "ghost"}
								onClick={() => setActiveTab("account")}
								className="w-full justify-start"
							>
								<UserRoundIcon className="size-4" />
								Account
							</Button>
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
								</>
							)}
							{activeTab === "account" && (
								<>
									<DialogHeader className="mb-5 gap-1">
										<DialogTitle className="text-lg">Account</DialogTitle>
										<DialogDescription>
											Manage your account and preferences.
										</DialogDescription>
									</DialogHeader>
									<section className="rounded-xl bg-muted/45 p-4">
										<div className="flex items-center gap-3">
											<Avatar className="size-10 rounded-lg">
												<AvatarImage src={user.avatar} alt={user.name} />
												<AvatarFallback className="rounded-lg">
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
												onClick={() => setIsLogoutDialogOpen(true)}
											>
												Sign Out
											</Button>
										</div>
									</section>
								</>
							)}
							{activeTab === "keyboard" && (
								<KeyboardSettings shortcutSettings={shortcutSettings} />
							)}
							{activeTab === "sync" && <SyncSettings />}
						</div>
					</div>
				</DialogContent>
			</Dialog>
			<AlertDialog
				open={isLogoutDialogOpen}
				onOpenChange={setIsLogoutDialogOpen}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Log out of Paperite?</AlertDialogTitle>
						<AlertDialogDescription>
							You’ll need to sign in again before opening your notes on this
							device.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction variant="destructive" onClick={onLogOut}>
							Log out
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function KeyboardSettings({
	shortcutSettings,
}: {
	shortcutSettings: ReturnType<typeof useKeyboardShortcuts>;
}) {
	const {
		shortcutOverrides,
		getShortcut,
		setShortcutOverride,
		resetShortcut,
		resetAllShortcuts,
	} = shortcutSettings;
	const [query, setQuery] = useState("");
	const [capturing, setCapturing] = useState<CommandId | null>(null);
	const [conflict, setConflict] = useState<{
		command: CommandDefinition;
		targetCommandId: CommandId;
		shortcut: string;
	} | null>(null);

	const groupedCommands = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		const filteredCommands = normalizedQuery
			? commands.filter((command) =>
					[
						command.label,
						command.category,
						formatShortcut(getShortcut(command.id)),
					]
						.join(" ")
						.toLowerCase()
						.includes(normalizedQuery),
				)
			: commands;

		return filteredCommands.reduce(
			(groups, command) => {
				groups[command.category] = [
					...(groups[command.category] ?? []),
					command,
				];
				return groups;
			},
			{} as Partial<Record<CommandDefinition["category"], CommandDefinition[]>>,
		);
	}, [getShortcut, query]);

	const captureShortcut = (
		command: CommandDefinition,
		event: KeyboardEvent<HTMLButtonElement>,
	) => {
		event.preventDefault();
		event.stopPropagation();

		if (event.key === "Escape") {
			setCapturing(null);
			setConflict(null);
			return;
		}

		if (event.key === "Backspace" || event.key === "Delete") {
			setShortcutOverride(command.id, null);
			setCapturing(null);
			setConflict(null);
			return;
		}

		const shortcut = normalizeShortcut(event.nativeEvent);
		if (!shortcut) return;

		const conflictingCommand = findShortcutConflict(
			command.id,
			shortcut,
			commands,
			shortcutOverrides,
		);

		if (conflictingCommand) {
			setConflict({
				command: conflictingCommand,
				targetCommandId: command.id,
				shortcut,
			});
			return;
		}

		setShortcutOverride(command.id, shortcut);
		setCapturing(null);
		setConflict(null);
	};

	return (
		<>
			<DialogHeader className="mb-5 gap-1">
				<DialogTitle className="text-lg">Keyboard</DialogTitle>
				<DialogDescription>
					Customize Paperite shortcuts. Changes are saved immediately.
				</DialogDescription>
			</DialogHeader>
			<div className="mb-4 flex items-center gap-2">
				<div className="relative min-w-0 flex-1">
					<SearchIcon className="-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground" />
					<Input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search shortcuts..."
						className="pl-8"
					/>
				</div>
				<Button type="button" variant="outline" onClick={resetAllShortcuts}>
					<RotateCcwIcon className="size-4" />
					Reset all
				</Button>
			</div>
			<div className="space-y-4">
				{Object.entries(groupedCommands).map(([category, categoryCommands]) => (
					<section key={category} className="space-y-2">
						<h3 className="px-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
							{category}
						</h3>
						<div className="overflow-hidden rounded-xl bg-muted/45">
							{categoryCommands.map((command) => (
								<div
									key={command.id}
									className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
								>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium">{command.label}</p>
										{command.description ? (
											<p className="text-xs text-muted-foreground">
												{command.description}
											</p>
										) : null}
									</div>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() => setCapturing(command.id)}
										onKeyDown={(event) => captureShortcut(command, event)}
										className={cn(
											"min-w-28 tabular-nums",
											capturing === command.id && "border-ring text-ring",
											getShortcut(command.id) === null &&
												"text-muted-foreground",
										)}
									>
										{capturing === command.id
											? "Press shortcut..."
											: formatShortcut(getShortcut(command.id))}
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										onClick={() => resetShortcut(command.id)}
									>
										<RotateCcwIcon className="size-4" />
										<span className="sr-only">Reset {command.label}</span>
									</Button>
								</div>
							))}
						</div>
					</section>
				))}
			</div>
			{conflict ? (
				<div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
					<p className="font-medium">Shortcut already used</p>
					<p className="text-xs text-muted-foreground">
						{formatShortcut(conflict.shortcut)} is assigned to{" "}
						{conflict.command.label}.
					</p>
					<div className="mt-3 flex gap-2">
						<Button
							type="button"
							size="sm"
							onClick={() => {
								setShortcutOverride(conflict.command.id, null);
								setShortcutOverride(
									conflict.targetCommandId,
									conflict.shortcut,
								);
								setCapturing(null);
								setConflict(null);
							}}
						>
							Replace
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => setConflict(null)}
						>
							Cancel
						</Button>
					</div>
				</div>
			) : null}
		</>
	);
}

function SyncSettings() {
	const [status, setStatus] = useState<SyncStatus | null>(null);
	const [busyAction, setBusyAction] = useState<
		"toggle" | "connect" | "sync" | "disconnect" | "create-shared-space" | null
	>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [sharedSpaceName, setSharedSpaceName] = useState("");
	const syncEngine = getSyncEngine();

	const refreshStatus = useCallback(async () => {
		const nextStatus = await syncEngine?.getStatus();
		if (nextStatus) setStatus(nextStatus);
	}, [syncEngine]);

	useEffect(() => {
		refreshStatus().catch(() => setMessage("Could not read sync status."));

		return onSyncChanged((data) => {
			if (data?.error) setMessage(data.error);
			refreshStatus().catch(() => setMessage("Could not read sync status."));
		});
	}, [refreshStatus]);

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
		setMessage(null);

		try {
			const result = await runner();
			if (isSyncError(result)) {
				setMessage(syncErrorMessage(result.error));
			} else if (action === "toggle") {
				setMessage("Google Drive sync preference updated.");
			} else if (action === "connect") {
				setMessage("Google sign-in opened in your browser.");
			} else if (action === "sync" && isGoogleDriveSyncResult(result)) {
				setMessage(
					`Sync complete. Uploaded ${result.uploaded}, downloaded ${result.downloaded}.`,
				);
			} else if (action === "disconnect") {
				setMessage("Google Drive disconnected on this device.");
			} else if (action === "create-shared-space") {
				setSharedSpaceName("");
				setMessage("Shared space created in Convex.");
			}

			await refreshStatus();
		} catch {
			setMessage("Sync action failed.");
		} finally {
			setBusyAction(null);
		}
	};

	const googleDrive = status?.googleDrive;
	const convex = status?.convex;
	const googleDriveEnabled = googleDrive?.enabled === true;

	return (
		<>
			<DialogHeader className="mb-5 gap-1">
				<DialogTitle className="text-lg">Sync</DialogTitle>
				<DialogDescription>
					Connect personal sync and check collaborative backend status.
				</DialogDescription>
			</DialogHeader>
			<div className="space-y-4">
				<section className="rounded-xl bg-muted/45 p-4">
					<div className="mb-4 flex items-start justify-between gap-3">
						<div className="flex items-center gap-2">
							<CloudIcon className="size-4 text-muted-foreground" />
							<div>
								<h3 className="text-sm font-medium">Google Drive</h3>
								<p className="text-xs text-muted-foreground">
									Personal multi-device sync through Drive app data.
								</p>
							</div>
						</div>
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
					</div>
					<div className="mb-3 flex items-center justify-between rounded-lg bg-background/40 px-3 py-2">
						<span className="text-sm">Use Google Drive sync</span>
						<StatusPill
							active={googleDrive?.connected === true}
							label={googleDrive?.connected ? "Connected" : "Disconnected"}
						/>
					</div>
					{googleDrive?.configured === false ? (
						<p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
							Missing <code>PAPERITE_GOOGLE_CLIENT_ID</code>.
						</p>
					) : null}
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							size="sm"
							disabled={
								!syncEngine ||
								!googleDriveEnabled ||
								googleDrive?.configured === false ||
								busyAction !== null
							}
							onClick={() =>
								runAction(
									"connect",
									() =>
										syncEngine?.connectGoogleDrive() ?? Promise.resolve(null),
								)
							}
						>
							{busyAction === "connect" ? "Opening..." : "Connect"}
						</Button>
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={
								!syncEngine ||
								!googleDriveEnabled ||
								!googleDrive?.connected ||
								busyAction !== null
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
							disabled={
								!syncEngine ||
								!googleDriveEnabled ||
								!googleDrive?.connected ||
								busyAction !== null
							}
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
				</section>
				<section className="rounded-xl bg-muted/45 p-4">
					<div className="flex items-start justify-between gap-3">
						<div className="flex items-center gap-2">
							<CloudIcon className="size-4 text-muted-foreground" />
							<div>
								<h3 className="text-sm font-medium">Convex</h3>
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
							{busyAction === "create-shared-space" ? "Creating..." : "Create"}
						</Button>
					</div>
					<p className="mt-2 text-xs text-muted-foreground">
						This creates the Convex shared space record. Shared note routing UI
						comes next.
					</p>
				</section>
				{message ? (
					<p className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">
						{message}
					</p>
				) : null}
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
