import {
	ChevronsUpDownIcon,
	LaptopIcon,
	LogOutIcon,
	MoonIcon,
	PaletteIcon,
	SettingsIcon,
	SunIcon,
	UserRoundIcon,
} from "lucide-react";
import { useState } from "react";
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
}: {
	onLogOut: () => void | Promise<void>;
	user: {
		name: string;
		avatar: string;
	};
}) {
	const { isMobile } = useSidebar();
	const { theme, setTheme } = useTheme();
	const [isLogoutDialogOpen, setIsLogoutDialogOpen] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);

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
							<DropdownMenuItem onSelect={() => setIsSettingsOpen(true)}>
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
							<button
								type="button"
								className="flex h-9 w-full items-center gap-2 rounded-md bg-accent px-2 text-left text-sm font-medium text-accent-foreground"
							>
								<PaletteIcon className="size-4" />
								Appearance
							</button>
						</aside>
						<div className="min-w-0 overflow-y-auto p-5 sm:p-6">
							<DialogHeader className="mb-5 gap-1">
								<DialogTitle className="text-lg">Appearance</DialogTitle>
								<DialogDescription>
									Customize how Paperite looks on this device.
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
								<div className="flex items-center gap-3">
									<UserRoundIcon className="size-4 text-muted-foreground" />
									<div className="min-w-0">
										<h3 className="text-sm font-medium">Account</h3>
										<p className="truncate text-xs text-muted-foreground">
											{user.name}
										</p>
									</div>
								</div>
							</section>
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
