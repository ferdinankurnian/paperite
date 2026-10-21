import {
	ChevronsUpDownIcon,
	CloudIcon,
	LaptopIcon,
	MenuIcon,
	MonitorSmartphoneIcon,
	MoonIcon,
	SettingsIcon,
	SunIcon,
	UserRoundIcon,
} from "lucide-react";
import { memo, useEffect, useState } from "react";
import {
	SettingsDialog,
	type SettingsTab,
} from "@/components/settings/settings-dialog";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isBrowserRenderer } from "@/lib/auth-bridge";
import { isClerkConfigured } from "@/lib/clerk";
import { cn } from "@/lib/utils";

const themes = [
	{ icon: LaptopIcon, label: "System", value: "system" },
	{ icon: SunIcon, label: "Light", value: "light" },
	{ icon: MoonIcon, label: "Dark", value: "dark" },
] as const;

export const NavUser = memo(function NavUser({
	onLogOut,
	user,
	isSignedIn,
	isAuthLoading,
	awaitingDesktop = false,
	showNotePreview,
	closeButtonOnly,
	syncSidebarWithActiveTab,
	onSetShowNotePreview,
	onSetCloseButtonOnly,
	onSetSyncSidebarWithActiveTab,
}: {
	onLogOut: () => void | Promise<void>;
	user: {
		name: string;
		avatar: string;
		email: string;
	};
	isSignedIn: boolean;
	isAuthLoading: boolean;
	/**
	 * True when this is a browser surface with no desktop app attached yet.
	 * It is waiting for the desktop to sign in, not signed out.
	 */
	awaitingDesktop?: boolean;
	showNotePreview: boolean;
	closeButtonOnly: boolean;
	syncSidebarWithActiveTab: boolean;
	onSetShowNotePreview: (show: boolean) => void;
	onSetCloseButtonOnly: (closeButtonOnly: boolean) => void;
	onSetSyncSidebarWithActiveTab: (sync: boolean) => void;
}) {
	const { isMobile } = useSidebar();
	const { theme, setTheme } = useTheme();
	const authEnabled = isClerkConfigured();
	const showAccount = isSignedIn;
	// A browser mirrors the desktop's session, so signing out from a tab
	// would kill the desktop's session — the desktop app owns that decision.
	const canLogOut = !isBrowserRenderer();
	const [isLogoutDialogOpen, setIsLogoutDialogOpen] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [activeTab, setActiveTab] = useState<SettingsTab>("general");

	useEffect(() => {
		const openSettings = () => {
			setActiveTab("general");
			setIsSettingsOpen(true);
		};

		window.addEventListener("paperite:open-settings", openSettings);
		return () =>
			window.removeEventListener("paperite:open-settings", openSettings);
	}, []);

	return (
		<>
			<SidebarMenu className="gap-1">
				<SidebarMenuItem>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							{showAccount ? (
								<SidebarMenuButton
									size="lg"
									tooltip={isAuthLoading ? "Account" : user.name}
									className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground duration-200 ease-linear group-data-[collapsible=icon]:p-1! [&>div.grid]:group-data-[collapsible=icon]:hidden [&>svg]:group-data-[collapsible=icon]:hidden"
								>
									<UserAvatar
										user={user}
										className="shrink-0 transition-[width,height] duration-200 ease-linear group-data-[collapsible=icon]:size-6"
									/>
									<div className="grid flex-1 text-left text-sm leading-tight">
										<span className="truncate font-medium">
											{isAuthLoading ? "Signing you in…" : user.name}
										</span>
										<span className="truncate text-xs text-sidebar-foreground/70">
											{isAuthLoading ? "Checking session…" : "Free Plan"}
										</span>
									</div>
									<ChevronsUpDownIcon className="ml-auto size-4 shrink-0" />
								</SidebarMenuButton>
							) : (
								<SidebarMenuButton className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground text-sidebar-foreground/80">
									<MenuIcon className="size-4 shrink-0" />
									<span className="min-w-0 flex-1 truncate text-left">
										Menu
									</span>
								</SidebarMenuButton>
							)}
						</DropdownMenuTrigger>
						<DropdownMenuContent
							className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
							side={isMobile ? "bottom" : "right"}
							align="end"
							sideOffset={4}
						>
							{authEnabled && !showAccount && !isAuthLoading ? (
								awaitingDesktop ? (
									<DropdownMenuLabel className="p-0 font-normal">
										<div className="flex items-start gap-2 px-1 py-1.5 text-left text-sm">
											<MonitorSmartphoneIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
											<div className="grid min-w-0 flex-1 gap-0.5 text-left leading-tight">
												<span className="truncate font-medium">
													Waiting for desktop
												</span>
												<span className="text-xs text-muted-foreground">
													Open the Paperite desktop app to sign in.
												</span>
											</div>
										</div>
									</DropdownMenuLabel>
								) : (
									<DropdownMenuItem
										onSelect={() =>
											window.dispatchEvent(new Event("paperite:open-auth"))
										}
									>
										<UserRoundIcon />
										Sign in
									</DropdownMenuItem>
								)
							) : showAccount ? (
								<DropdownMenuLabel className="p-0 font-normal">
									<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
										<UserAvatar user={user} />
										<div className="grid flex-1 text-left text-sm leading-tight">
											<span className="truncate font-medium">
												{isAuthLoading ? "Signing you in…" : user.name}
											</span>
											<span className="truncate text-xs">
												{isAuthLoading ? "Checking session…" : "Free Plan"}
											</span>
										</div>
									</div>
								</DropdownMenuLabel>
							) : null}
							<DropdownMenuSeparator />
							<Tabs
								value={theme}
								onValueChange={(value) =>
									setTheme(value as "system" | "light" | "dark")
								}
								className="p-1"
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
								onSelect={() => {
									setActiveTab("general");
									setIsSettingsOpen(true);
								}}
							>
								<SettingsIcon />
								Settings
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={() => {
									setActiveTab("sync");
									setIsSettingsOpen(true);
								}}
							>
								<CloudIcon />
								Sync settings
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</SidebarMenuItem>
			</SidebarMenu>
			<SettingsDialog
				open={isSettingsOpen}
				onOpenChange={setIsSettingsOpen}
				activeTab={activeTab}
				onActiveTabChange={setActiveTab}
				user={user}
				showNotePreview={showNotePreview}
				onSetShowNotePreview={onSetShowNotePreview}
				closeButtonOnly={closeButtonOnly}
				onSetCloseButtonOnly={onSetCloseButtonOnly}
				syncSidebarWithActiveTab={syncSidebarWithActiveTab}
				onSetSyncSidebarWithActiveTab={onSetSyncSidebarWithActiveTab}
				onRequestLogOut={() => setIsLogoutDialogOpen(true)}
				betaEnabled={showAccount}
			/>
			{canLogOut ? (
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
			) : null}
		</>
	);
});

function UserAvatar({
	user,
	className,
}: {
	user: { name: string; avatar: string; email: string };
	className?: string;
}) {
	return (
		<Avatar className={cn("size-8 rounded-full after:hidden", className)}>
			<AvatarImage src={user.avatar} alt={user.name} />
			<AvatarFallback className="rounded-full">
				<UserRoundIcon className="size-4" />
			</AvatarFallback>
		</Avatar>
	);
}
