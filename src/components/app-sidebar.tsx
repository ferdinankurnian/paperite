"use client";

import {
	ChevronDownIcon,
	CloudIcon,
	FolderPlusIcon,
	FolderIcon,
	GemIcon,
	InboxIcon,
	LightbulbIcon,
	PinIcon,
	StickyNotePlusIcon,
} from "lucide-react";
import * as React from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarInput,
	SidebarRail,
	SidebarTrigger,
} from "@/components/ui/sidebar";

const data = {
	user: {
		name: "iydheko",
		email: "Pro Plan",
		avatar: "https://github.com/ferdinankurnian.png",
	},
	inbox: {
		title: "Inbox",
		url: "#",
		icon: <InboxIcon />,
	},
	spaces: [
		{
			title: "Work",
			url: "#",
			icon: <CloudIcon className="text-[#E94C08]" />,
		},
		{
			title: "idea",
			url: "#",
			icon: <LightbulbIcon className="text-yellow-500" />,
		},
		{
			title: "project gem",
			url: "#",
			icon: <GemIcon className="text-purple-500" />,
		},
		{
			title: "planting",
			url: "#",
			icon: <FolderIcon className="text-green-500" />,
		},
	],
	noteTree: [
		{
			type: "note",
			title: "Meeting Tomorrow",
			date: "09:34 AM",
			description: "Planning session notes and updated next steps.",
			unread: true,
		},
		{
			type: "note",
			title: "Project Update",
			date: "Yesterday",
			description: "Latest direction for the first layout pass.",
			pinned: true,
		},
		{
			type: "folder",
			title: "Design",
			children: [
				{
					type: "note",
					title: "Weekend Plans",
					date: "2 days ago",
					description: "Quick review list before moving deeper.",
					unread: true,
				},
				{
					type: "note",
					title: "Design Review",
					date: "3 days ago",
					description: "Sidebar notes for the second panel.",
					pinned: true,
				},
				{
					type: "folder",
					title: "Research",
					children: [
						{
							type: "note",
							title: "Moodboard",
							date: "Apr 12",
							description: "Small visual references and UI direction.",
						},
						{
							type: "note",
							title: "Patterns",
							date: "Apr 10",
							description: "Nested list behavior and spacing refs.",
							unread: true,
							pinned: true,
						},
					],
				},
			],
		},
		{
			type: "folder",
			title: "Engineering",
			children: [
				{
					type: "note",
					title: "App Shell",
					date: "Apr 8",
					description: "Layout constraints for sidebars and content.",
				},
				{
					type: "folder",
					title: "Archive",
					children: [
						{
							type: "note",
							title: "Old Sidebar",
							date: "Mar 29",
							description: "Previous sidebar experiments.",
						},
					],
				},
			],
		},
	],
} satisfies {
	user: {
		name: string;
		email: string;
		avatar: string;
	};
	inbox: {
		title: string;
		url: string;
		icon: React.ReactNode;
	};
	spaces: {
		title: string;
		url: string;
		icon: React.ReactNode;
	}[];
	noteTree: NoteTreeItem[];
};

type NoteItem = {
	type: "note";
	title: string;
	date: string;
	description: string;
	pinned?: boolean;
	unread?: boolean;
};

type NoteFolder = {
	type: "folder";
	title: string;
	children: NoteTreeItem[];
};

type NoteTreeItem = NoteItem | NoteFolder;

function sortPinnedFirst(items: NoteTreeItem[]): NoteTreeItem[] {
	return [...items].sort((first, second) => {
		const firstPinned = first.type === "note" && first.pinned === true;
		const secondPinned = second.type === "note" && second.pinned === true;

		return Number(secondPinned) - Number(firstPinned);
	});
}

function NoteTree({
	items,
	level = 0,
}: {
	items: NoteTreeItem[];
	level?: number;
}) {
	const sortedItems = sortPinnedFirst(items);

	return (
		<div className="flex flex-col gap-1.5">
			{sortedItems.map((item, index) =>
				item.type === "folder" ? (
					<NoteFolderItem item={item} key={item.title} level={level} />
				) : (
					<NoteCard
						isActive={level === 0 && index === 0}
						item={item}
						key={item.title}
					/>
				),
			)}
		</div>
	);
}

function NoteFolderItem({ item, level }: { item: NoteFolder; level: number }) {
	const canNest = level < 1;

	return (
		<Collapsible defaultOpen>
			<CollapsibleTrigger className="group/folder flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
				<ChevronDownIcon className="size-3.5 transition-transform group-data-[state=closed]/folder:-rotate-90" />
				<FolderIcon className="size-3.5" />
				<span className="min-w-0 flex-1 truncate">{item.title}</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className="ml-3.5 border-l border-sidebar-border pl-2">
					<NoteTree
						items={
							canNest
								? item.children
								: item.children.filter((child) => child.type === "note")
						}
						level={level + 1}
					/>
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

function NoteCard({
	item,
	isActive = false,
}: {
	item: NoteItem;
	isActive?: boolean;
}) {
	return (
		<button
			type="button"
			className="flex w-full flex-col items-start gap-1.5 rounded-md px-3 py-2.5 text-left text-sm leading-tight whitespace-nowrap transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
			data-active={isActive}
		>
			<div className="flex w-full items-center gap-2">
				{item.pinned ? (
					<PinIcon className="size-3.5 shrink-0 text-sidebar-foreground/60" />
				) : null}
				<span className="min-w-0 flex-1 truncate font-medium">
					{item.title}
				</span>
				<span className="shrink-0 text-xs text-sidebar-foreground/70">
					{item.date}
				</span>
			</div>
			<span className="line-clamp-2 w-full text-xs whitespace-break-spaces text-sidebar-foreground/75">
				{item.description}
			</span>
		</button>
	);
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	const [activeItem] = React.useState(data.inbox);

	return (
		<>
			<Sidebar collapsible="icon" className="w-58" {...props}>
				<SidebarHeader className="group-data-[collapsible=icon]:p-1 group-data-[collapsible=icon]:pt-3 pb-0">
					<div className="flex h-10 items-center justify-between px-2 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
						<div className="font-brand text-xl text-[#E94C08] group-data-[collapsible=icon]:hidden">
							Paperite
						</div>
						<SidebarTrigger className="size-8 rounded-md group-data-[collapsible=icon]:p-2 [&_svg]:size-4" />
					</div>
				</SidebarHeader>
				<SidebarContent>
					<NavMain inbox={data.inbox} spaces={data.spaces} />
				</SidebarContent>
				<SidebarFooter>
					<NavUser user={data.user} />
				</SidebarFooter>
				<SidebarRail />
			</Sidebar>
			<Sidebar
				collapsible="none"
				className="hidden h-svh min-h-svh w-80 max-w-80 shrink-0 border-r border-sidebar-border md:flex"
			>
				<SidebarHeader className="gap-2 p-3 pb-0">
					<div className="flex w-full items-center justify-between gap-3">
						<div className="text-base font-medium text-foreground">
							{activeItem.title}
						</div>
						<div className="flex items-center gap-1">
							<button
								type="button"
								className="flex size-8 items-center justify-center rounded-md text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
								aria-label="Add folder"
							>
								<FolderPlusIcon className="size-4" />
							</button>
							<button
								type="button"
								className="flex size-8 items-center justify-center rounded-md text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
								aria-label="Add note"
							>
								<StickyNotePlusIcon className="size-4" />
							</button>
						</div>
					</div>
					<SidebarInput placeholder="Type to search..." />
				</SidebarHeader>
				<SidebarContent className="[mask-image:linear-gradient(to_bottom,transparent_0,black_18px,black_100%)] [-webkit-mask-image:linear-gradient(to_bottom,transparent_0,black_18px,black_100%)]">
					<SidebarGroup className="px-3 py-4">
						<SidebarGroupContent>
							<NoteTree items={data.noteTree} />
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>
			</Sidebar>
		</>
	);
}
