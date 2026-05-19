import {
	MoreHorizontalIcon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	SidebarGroup,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";

export function NavMain({
	inbox,
	spaces,
}: {
	inbox: {
		title: string;
		url: string;
		icon?: React.ReactNode;
	};
	spaces: {
		title: string;
		url: string;
		icon?: React.ReactNode;
	}[];
}) {
	return (
		<>
			<SidebarGroup>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton asChild tooltip={inbox.title}>
							<a href={inbox.url}>
								{inbox.icon}
								<span>{inbox.title}</span>
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarGroup>
			<div className="h-px bg-border mx-[10px]"></div>
			<SidebarGroup>
				<SidebarMenu>
					{spaces.map((space) => (
						<SidebarMenuItem key={space.title}>
							<SidebarMenuButton asChild tooltip={space.title}>
								<a href={space.url}>
									{space.icon}
									<span>{space.title}</span>
								</a>
							</SidebarMenuButton>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<SidebarMenuAction showOnHover>
										<MoreHorizontalIcon />
										<span className="sr-only">More</span>
									</SidebarMenuAction>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									className="w-44 rounded-lg"
									side="right"
									align="start"
								>
									<DropdownMenuItem>
										<PencilIcon className="text-muted-foreground" />
										<span>Rename Space</span>
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem variant="destructive">
										<Trash2Icon />
										<span>Delete Space</span>
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</SidebarMenuItem>
					))}
					<SidebarMenuItem>
						<SidebarMenuButton className="text-sidebar-foreground/70">
							<PlusIcon className="text-sidebar-foreground/70" />
							<span>Add Space</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarGroup>
		</>
	);
}
