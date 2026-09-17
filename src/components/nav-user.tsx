import {
	LaptopIcon,
	LogOutIcon,
	MenuIcon,
	MoonIcon,
	SettingsIcon,
	SunIcon,
	UserRoundIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import {
	SettingsDialog,
	type SettingsTab,
} from "@/components/settings/settings-dialog";
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

const themes = [
	{ icon: SunIcon, label: "Light", value: "light" },
	{ icon: MoonIcon, label: "Dark", value: "dark" },
	{ icon: LaptopIcon, label: "System", value: "system" },
] as const;

export function NavUser({
	onLogOut,
	user,
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
	};
	showNotePreview: boolean;
	closeButtonOnly: boolean;
	syncSidebarWithActiveTab: boolean;
	onSetShowNotePreview: (show: boolean) => void;
	onSetCloseButtonOnly: (closeButtonOnly: boolean) => void;
	onSetSyncSidebarWithActiveTab: (sync: boolean) => void;
}) {
	const { isMobile } = useSidebar();
	const { theme, setTheme } = useTheme();
	const betaEnabled = import.meta.env.BETA_PAPERITE;
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
							<SidebarMenuButton className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground text-sidebar-foreground/80">
								<MenuIcon className="size-4 shrink-0" />
								<span className="min-w-0 flex-1 truncate text-left">Menu</span>
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
									<UserAvatar user={user} />
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
							{betaEnabled ? (
								<>
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
								</>
							) : null}
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
				betaEnabled={betaEnabled}
			/>
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

function UserAvatar({ user }: { user: { name: string; avatar: string } }) {
	return (
		<Avatar className="size-8 rounded-full after:hidden">
			<AvatarImage src={user.avatar} alt={user.name} />
			<AvatarFallback className="rounded-full">
				<UserRoundIcon className="size-4" />
			</AvatarFallback>
		</Avatar>
	);
}
