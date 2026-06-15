import { useEffect, useState } from "react";
import { useKeyboardShortcuts } from "@/components/keyboard-shortcuts-provider";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
	Menubar,
	MenubarContent,
	MenubarGroup,
	MenubarItem,
	MenubarMenu,
	MenubarSeparator,
	MenubarShortcut,
	MenubarTrigger,
} from "@/components/ui/menubar";
import type { CommandId } from "@/lib/commands";
import { formatShortcut } from "@/lib/shortcuts";
import { getSyncEngine, onSyncChanged } from "@/lib/sync-engine";
import { cn } from "@/lib/utils";

const fallbackTitle = "Paperite";

type WindowAction = NonNullable<
	Window["electron"]
>["window"]["action"] extends (action: infer Action) => Promise<{ ok: boolean }>
	? Action
	: never;

type EditorFormatCommand =
	| "bold"
	| "italic"
	| "underline"
	| "strike"
	| "highlight"
	| "quote"
	| "code-block"
	| "typography-heading-1"
	| "typography-heading-2"
	| "typography-heading-3"
	| "typography-body"
	| "bullet-list"
	| "ordered-list"
	| "task-list"
	| "align-left"
	| "align-center"
	| "align-right"
	| "align-justify";

export function AppTitlebar() {
	const [title, setTitle] = useState(() => document.title || fallbackTitle);
	const [zenMode, setZenMode] = useState(false);

	useEffect(() => {
		const syncTitle = () => setTitle(document.title || fallbackTitle);
		const observer = new MutationObserver(syncTitle);
		const titleElement = document.querySelector("title");

		if (titleElement) {
			observer.observe(titleElement, { childList: true });
		}

		const toggleZenMode = (event: CustomEvent<{ enabled?: boolean }>) => {
			if (event.detail?.enabled !== undefined) {
				setZenMode(event.detail.enabled);
			} else {
				setZenMode((current) => !current);
			}
		};

		window.addEventListener("paperite:title-change", syncTitle);
		window.addEventListener(
			"paperite:toggle-zen-mode",
			toggleZenMode as EventListener,
		);

		return () => {
			observer.disconnect();
			window.removeEventListener("paperite:title-change", syncTitle);
			window.removeEventListener(
				"paperite:toggle-zen-mode",
				toggleZenMode as EventListener,
			);
		};
	}, []);

	return (
		<header
			className={`app-region-drag relative z-50 grid h-9 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-border/60 text-foreground ${zenMode ? "bg-background" : "bg-sidebar"}`}
		>
			<AppMenu />
			<div className="pointer-events-none min-w-0 px-4 text-center text-[13px] font-medium text-muted-foreground">
				<span className="block max-w-[48vw] truncate">{title}</span>
			</div>
			<WindowControls />
		</header>
	);
}

function AppMenu() {
	const [activeSpacePath, setActiveSpacePath] = useState("Inbox");
	const { getShortcut } = useKeyboardShortcuts();
	const isInbox = activeSpacePath === "Inbox";

	useEffect(() => {
		const syncActiveSpace = (event: CustomEvent<{ path: string }>) => {
			setActiveSpacePath(event.detail.path);
		};

		window.addEventListener(
			"paperite:active-space-change",
			syncActiveSpace as EventListener,
		);

		return () => {
			window.removeEventListener(
				"paperite:active-space-change",
				syncActiveSpace as EventListener,
			);
		};
	}, []);

	const runAction = (action: WindowAction) => {
		window.electron?.window.action(action);
	};

	const runPaperiteAction = (action: string) => {
		window.dispatchEvent(new Event(`paperite:${action}`));
	};

	const runFormat = (command: EditorFormatCommand) => {
		window.dispatchEvent(
			new CustomEvent("paperite:editor-format", {
				detail: { command },
			}),
		);
	};

	const toggleZenMode = () => {
		window.dispatchEvent(new Event("paperite:toggle-zen-mode"));
	};

	const shortcut = (commandId: CommandId) =>
		formatShortcut(getShortcut(commandId));

	return (
		<div className="app-region-no-drag flex min-w-0 items-center px-1">
			<Menubar className="border-none bg-transparent p-0">
				<MenubarMenu>
					<MenubarTrigger>File</MenubarTrigger>
					<MenubarContent>
						<MenubarGroup>
							<MenubarItem onSelect={() => runPaperiteAction("create-note")}>
								New Note
								<MenubarShortcut>{shortcut("note.create")}</MenubarShortcut>
							</MenubarItem>
							<MenubarItem
								disabled={isInbox}
								onSelect={() => runPaperiteAction("create-folder")}
							>
								New Folder
								<MenubarShortcut>{shortcut("folder.create")}</MenubarShortcut>
							</MenubarItem>
						</MenubarGroup>
						<MenubarSeparator />
						<MenubarGroup>
							<MenubarItem onSelect={() => runPaperiteAction("note-setup")}>
								Note setup...
								<MenubarShortcut>{shortcut("note.setup")}</MenubarShortcut>
							</MenubarItem>
						</MenubarGroup>
						<MenubarSeparator />
						<MenubarGroup>
							<MenubarItem
								variant="destructive"
								onSelect={() => runAction("quit")}
							>
								Quit
								<MenubarShortcut>{shortcut("window.quit")}</MenubarShortcut>
							</MenubarItem>
						</MenubarGroup>
					</MenubarContent>
				</MenubarMenu>
				<MenubarMenu>
					<MenubarTrigger>Edit</MenubarTrigger>
					<MenubarContent>
						<MenubarGroup>
							<MenubarItem onSelect={() => runAction("undo")}>
								Undo
								<MenubarShortcut>Ctrl+Z</MenubarShortcut>
							</MenubarItem>
							<MenubarItem onSelect={() => runAction("redo")}>
								Redo
								<MenubarShortcut>Ctrl+Shift+Z</MenubarShortcut>
							</MenubarItem>
						</MenubarGroup>
						<MenubarSeparator />
						<MenubarGroup>
							<MenubarItem onSelect={() => runAction("cut")}>
								Cut
								<MenubarShortcut>Ctrl+X</MenubarShortcut>
							</MenubarItem>
							<MenubarItem onSelect={() => runAction("copy")}>
								Copy
								<MenubarShortcut>Ctrl+C</MenubarShortcut>
							</MenubarItem>
							<MenubarItem onSelect={() => runAction("paste")}>
								Paste
								<MenubarShortcut>Ctrl+V</MenubarShortcut>
							</MenubarItem>
						</MenubarGroup>
						<MenubarSeparator />
						<MenubarGroup>
							<MenubarItem onSelect={() => runAction("selectAll")}>
								Select All
								<MenubarShortcut>Ctrl+A</MenubarShortcut>
							</MenubarItem>
						</MenubarGroup>
					</MenubarContent>
				</MenubarMenu>
				<MenubarMenu>
					<MenubarTrigger>View</MenubarTrigger>
					<MenubarContent>
						<MenubarGroup>
							<MenubarItem onSelect={toggleZenMode}>
								Toggle Zen Mode
								<MenubarShortcut>{shortcut("view.toggleZen")}</MenubarShortcut>
							</MenubarItem>
							<MenubarSeparator />
							<MenubarItem onSelect={() => runAction("toggleDevTools")}>
								Toggle DevTools
								<MenubarShortcut>Ctrl+Shift+I</MenubarShortcut>
							</MenubarItem>
						</MenubarGroup>
						<MenubarSeparator />
						<MenubarGroup>
							<MenubarItem onSelect={() => runAction("reload")}>
								Reload
								<MenubarShortcut>Ctrl+R</MenubarShortcut>
							</MenubarItem>
							<MenubarItem onSelect={() => runAction("forceReload")}>
								Force Reload
								<MenubarShortcut>Ctrl+Shift+R</MenubarShortcut>
							</MenubarItem>
						</MenubarGroup>
					</MenubarContent>
				</MenubarMenu>
				<MenubarMenu>
					<MenubarTrigger>Format</MenubarTrigger>
					<MenubarContent>
						<MenubarGroup>
							<MenubarItem onSelect={() => runFormat("typography-heading-1")}>
								Heading 1
							</MenubarItem>
							<MenubarItem onSelect={() => runFormat("typography-heading-2")}>
								Heading 2
							</MenubarItem>
							<MenubarItem onSelect={() => runFormat("typography-heading-3")}>
								Heading 3
							</MenubarItem>
							<MenubarItem onSelect={() => runFormat("typography-body")}>
								Body
							</MenubarItem>
						</MenubarGroup>
						<MenubarSeparator />
						<MenubarGroup>
							<MenubarItem onSelect={() => runFormat("bold")}>
								Bold
								<MenubarShortcut>Ctrl+B</MenubarShortcut>
							</MenubarItem>
							<MenubarItem onSelect={() => runFormat("italic")}>
								Italic
								<MenubarShortcut>Ctrl+I</MenubarShortcut>
							</MenubarItem>
							<MenubarItem onSelect={() => runFormat("underline")}>
								Underline
								<MenubarShortcut>Ctrl+U</MenubarShortcut>
							</MenubarItem>
							<MenubarItem onSelect={() => runFormat("strike")}>
								Strikethrough
								<MenubarShortcut>Ctrl+Shift+X</MenubarShortcut>
							</MenubarItem>
						</MenubarGroup>
						<MenubarSeparator />
						<MenubarGroup>
							<MenubarItem onSelect={() => runFormat("highlight")}>
								Highlight
							</MenubarItem>
						</MenubarGroup>
						<MenubarSeparator />
						<MenubarGroup>
							<MenubarItem onSelect={() => runFormat("quote")}>
								Quote
							</MenubarItem>
							<MenubarItem onSelect={() => runFormat("code-block")}>
								Code Block
							</MenubarItem>
						</MenubarGroup>
						<MenubarSeparator />
						<MenubarGroup>
							<MenubarItem onSelect={() => runFormat("align-left")}>
								Align Left
							</MenubarItem>
							<MenubarItem onSelect={() => runFormat("align-center")}>
								Align Center
							</MenubarItem>
							<MenubarItem onSelect={() => runFormat("align-right")}>
								Align Right
							</MenubarItem>
							<MenubarItem onSelect={() => runFormat("align-justify")}>
								Justify
							</MenubarItem>
						</MenubarGroup>
						<MenubarSeparator />
						<MenubarGroup>
							<MenubarItem onSelect={() => runFormat("bullet-list")}>
								Bullet List
							</MenubarItem>
							<MenubarItem onSelect={() => runFormat("ordered-list")}>
								Numbered List
							</MenubarItem>
							<MenubarItem onSelect={() => runFormat("task-list")}>
								Checkbox List
							</MenubarItem>
						</MenubarGroup>
					</MenubarContent>
				</MenubarMenu>
				<MenubarMenu>
					<MenubarTrigger>Window</MenubarTrigger>
					<MenubarContent>
						<MenubarGroup>
							<MenubarItem onSelect={() => runAction("minimize")}>
								Minimize
							</MenubarItem>
							<MenubarItem onSelect={() => runAction("toggleMaximize")}>
								Maximize
							</MenubarItem>
						</MenubarGroup>
						<MenubarSeparator />
						<MenubarGroup>
							<MenubarItem onSelect={() => runAction("close")}>
								Close
							</MenubarItem>
						</MenubarGroup>
					</MenubarContent>
				</MenubarMenu>
			</Menubar>
		</div>
	);
}

function WindowControls() {
	return (
		<div className="app-region-no-drag ml-auto flex h-full items-stretch justify-end">
			<SyncIndicator />
			<WindowControl action="minimize" icon="/minimize.png" label="Minimize" />
			<WindowControl
				action="toggleMaximize"
				icon="/maximize.png"
				label="Maximize"
			/>
			<WindowControl
				action="close"
				icon="/close.png"
				label="Close"
				className="hover:bg-destructive/90 hover:text-white"
			/>
		</div>
	);
}

function SyncIndicator() {
	const [status, setStatus] = useState<SyncStatus | null>(null);
	const syncEngine = getSyncEngine();

	useEffect(() => {
		const refreshStatus = () => {
			syncEngine
				?.getStatus()
				.then(setStatus)
				.catch(() => undefined);
		};

		refreshStatus();
		return onSyncChanged(refreshStatus);
	}, [syncEngine]);

	const googleDrive = status?.googleDrive;
	if (!googleDrive?.configured || !googleDrive.connected) return null;

	const state = googleDrive.lastError
		? "error"
		: googleDrive.syncing
			? "syncing"
			: googleDrive.enabled
				? "synced"
				: "paused";
	const label =
		state === "error"
			? "Sync error"
			: state === "syncing"
				? "Syncing"
				: state === "paused"
					? "Sync off"
					: "Synced";
	const lastSynced = googleDrive.lastSyncedAt
		? new Date(googleDrive.lastSyncedAt).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
			})
		: "Not yet";

	return (
		<HoverCard openDelay={150} closeDelay={80}>
			<HoverCardTrigger asChild>
				<button
					type="button"
					aria-label={label}
					className="flex h-full w-8 items-center justify-center"
				>
					<span
						className={cn(
							"size-2.5 rounded-full bg-muted-foreground/60 shadow-[0_0_0_2px_rgb(255_255_255/0.05)]",
							state === "syncing" && "animate-pulse bg-sky-400",
							state === "synced" && "bg-emerald-500",
							state === "paused" && "bg-amber-500",
							state === "error" && "bg-destructive",
						)}
					/>
				</button>
			</HoverCardTrigger>
			<HoverCardContent side="bottom" align="end" className="w-56 text-xs">
				<div className="space-y-1.5">
					<div className="flex items-center justify-between gap-3">
						<span className="font-medium text-foreground">Google Drive</span>
						<span className="text-muted-foreground">{label}</span>
					</div>
					<p className="text-muted-foreground">Last synced: {lastSynced}</p>
					{googleDrive.lastError ? (
						<p className="text-destructive">{googleDrive.lastError}</p>
					) : null}
				</div>
			</HoverCardContent>
		</HoverCard>
	);
}

function WindowControl({
	action,
	icon,
	label,
	className,
}: {
	action: WindowAction;
	icon: string;
	label: string;
	className?: string;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			className={cn(
				"flex h-full w-11 items-center justify-center opacity-80 transition-colors hover:bg-muted hover:opacity-100",
				className,
			)}
			onClick={() => window.electron?.window.action(action)}
		>
			<img
				src={icon}
				alt=""
				className="size-3.5 object-contain invert dark:invert-0"
				draggable={false}
			/>
		</button>
	);
}
