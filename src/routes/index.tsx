import { createFileRoute } from "@tanstack/react-router";
import {
	BookOpenIcon,
	DownloadIcon,
	FileSearchIcon,
	InfoIcon,
	MoreVerticalIcon,
	PrinterIcon,
	SearchIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export const Route = createFileRoute("/")({
	component: Index,
});

const openNotes = [
	{ title: "Meeting Tomorrow", active: true },
	{ title: "Project Update", active: false },
	{ title: "Untitled 1", active: false },
];

function Index() {
	return (
		<SidebarProvider>
			<AppSidebar />
			<SidebarInset>
				<header className="flex h-12 shrink-0 items-stretch gap-3 px-3 transition-[width,height] ease-linear">
					<div className="flex min-w-0 flex-1 items-stretch gap-1 overflow-hidden">
						{openNotes.map((note) => (
							<button
								type="button"
								key={note.title}
								data-active={note.active}
								className="group my-2 flex min-w-24 max-w-56 items-center gap-2 rounded-md pl-2.5 pe-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
							>
								<span className="min-w-0 flex-1 truncate">{note.title}</span>
								<span className="flex size-4 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover:opacity-65 group-data-[active=true]:opacity-65 hover:opacity-100">
									<XIcon className="size-3.5" />
								</span>
							</button>
						))}
					</div>
					<div className="flex shrink-0 items-center gap-1">
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="text-muted-foreground"
							aria-label="Reading view"
						>
							<BookOpenIcon />
						</Button>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									className="text-muted-foreground"
									aria-label="More note actions"
								>
									<MoreVerticalIcon />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-56">
								<DropdownMenuItem>
									<InfoIcon />
									Note details
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem>
									<DownloadIcon />
									Export as PDF...
								</DropdownMenuItem>
								<DropdownMenuItem>
									<PrinterIcon />
									Print...
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem>
									<SearchIcon />
									Find in note...
								</DropdownMenuItem>
								<DropdownMenuItem>
									<FileSearchIcon />
									Replace in note...
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem variant="destructive">
									<Trash2Icon />
									Delete note
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</header>
				<div className="flex flex-1 flex-col gap-4 p-4 pt-2"></div>
			</SidebarInset>
		</SidebarProvider>
	);
}
