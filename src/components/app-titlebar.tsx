import { useRouterState } from "@tanstack/react-router";
import { CloudAlert, CloudCheck, CloudOff, CloudSync } from "lucide-react";
import { useEffect, useState } from "react";
import { ExportQueue } from "@/components/export-queue";
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
	MenubarSub,
	MenubarSubContent,
	MenubarSubTrigger,
	MenubarTrigger,
} from "@/components/ui/menubar";
import { useTheme } from "@/components/theme-provider";
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
	const [closeButtonOnly, setCloseButtonOnly] = useState(false);
	const location = useRouterState({ select: (s) => s.location });
	const isLoginPage = location.pathname === "/login";
	const isMacOS = window.electron?.platform.isMacOS ?? false;

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

		const handleControlsChange = (
			event: CustomEvent<{ closeButtonOnly: boolean }>,
		) => {
			setCloseButtonOnly(event.detail.closeButtonOnly);
		};

		window.addEventListener("paperite:title-change", syncTitle);
		const removeAppMenuActionListener = window.electron?.onAppMenuAction(
			(action: string) => {
				window.dispatchEvent(new Event(`paperite:${action}`));
			},
		);
		const removeAppMenuFormatListener = window.electron?.onAppMenuFormat(
			(command: EditorFormatCommand) => {
				window.dispatchEvent(
					new CustomEvent("paperite:editor-format", {
						detail: { command },
					}),
				);
			},
		);
		window.addEventListener(
			"paperite:toggle-zen-mode",
			toggleZenMode as EventListener,
		);
		window.addEventListener(
			"paperite:window-controls-change",
			handleControlsChange as EventListener,
		);

		return () => {
			observer.disconnect();
			removeAppMenuActionListener?.();
			removeAppMenuFormatListener?.();
			window.removeEventListener("paperite:title-change", syncTitle);
			window.removeEventListener(
				"paperite:toggle-zen-mode",
				toggleZenMode as EventListener,
			);
			window.removeEventListener(
				"paperite:window-controls-change",
				handleControlsChange as EventListener,
			);
		};
	}, []);

	return (
		<header
			className={cn(
				"app-region-drag relative z-50 grid h-9 shrink-0 items-center border-b border-border/60 text-foreground",
				isMacOS ? "grid-cols-[120px_1fr_120px]" : "grid-cols-[1fr_auto_1fr]",
				zenMode ? "bg-background" : "bg-sidebar",
			)}
		>
			{isLoginPage || isMacOS ? <div /> : <AppMenu />}
			<div className="pointer-events-none min-w-0 px-4 text-center text-[13px] font-medium text-muted-foreground">
				<span className="block max-w-[48vw] truncate">{title}</span>
			</div>
			{isMacOS ? (
				<div className="app-region-no-drag ml-auto flex h-full items-stretch justify-end">
					<ExportQueue />
					<SyncIndicator />
				</div>
			) : (
				<WindowControls closeButtonOnly={closeButtonOnly} />
			)}
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
						<MenubarSub>
							<MenubarSubTrigger>Paragraph</MenubarSubTrigger>
							<MenubarSubContent>
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
							</MenubarSubContent>
						</MenubarSub>
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
							<MenubarItem onSelect={() => runFormat("highlight")}>
								Highlight
							</MenubarItem>
						</MenubarGroup>
						<MenubarSeparator />
						<MenubarSub>
							<MenubarSubTrigger>Block</MenubarSubTrigger>
							<MenubarSubContent>
								<MenubarItem onSelect={() => runFormat("quote")}>
									Quote
								</MenubarItem>
								<MenubarItem onSelect={() => runFormat("code-block")}>
									Code Block
								</MenubarItem>
							</MenubarSubContent>
						</MenubarSub>
						<MenubarSub>
							<MenubarSubTrigger>Align</MenubarSubTrigger>
							<MenubarSubContent>
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
							</MenubarSubContent>
						</MenubarSub>
						<MenubarSub>
							<MenubarSubTrigger>List</MenubarSubTrigger>
							<MenubarSubContent>
								<MenubarItem onSelect={() => runFormat("bullet-list")}>
									Bullet List
								</MenubarItem>
								<MenubarItem onSelect={() => runFormat("ordered-list")}>
									Numbered List
								</MenubarItem>
								<MenubarItem onSelect={() => runFormat("task-list")}>
									Checkbox List
								</MenubarItem>
							</MenubarSubContent>
						</MenubarSub>
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

function WindowControls({ closeButtonOnly }: { closeButtonOnly: boolean }) {
	return (
		<div className="app-region-no-drag ml-auto flex h-full items-stretch justify-end">
			<ExportQueue />
			<SyncIndicator />
			{!closeButtonOnly && (
				<>
					<WindowControl
						action="minimize"
						icon="./minimize.png"
						label="Minimize"
					/>
					<WindowControl
						action="toggleMaximize"
						icon="./maximize.png"
						label="Maximize"
					/>
				</>
			)}
			<WindowControl
				action="close"
				icon="./close.png"
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
	const friendlyError = googleDrive.lastError
		? friendlySyncError(googleDrive.lastError)
		: null;

	const Icon =
		state === "syncing"
			? CloudSync
			: state === "synced"
				? CloudCheck
				: state === "paused"
					? CloudOff
					: CloudAlert;

	return (
		<HoverCard openDelay={150} closeDelay={80}>
			<HoverCardTrigger asChild>
				<button
					type="button"
					aria-label={label}
					className="flex h-full w-8 items-center justify-center"
				>
					<Icon
						className={cn(
							"size-3.5",
							state === "syncing" && "animate-pulse text-sky-400",
							state === "synced" && "text-emerald-500",
							state === "paused" && "text-amber-500",
							state === "error" && "text-destructive",
						)}
					/>
				</button>
			</HoverCardTrigger>
			<HoverCardContent side="bottom" align="end" className="w-64 text-xs">
				<div className="space-y-1.5">
					<div className="flex items-center justify-between gap-3">
						<span className="font-medium text-foreground">Google Drive</span>
						<span className="text-muted-foreground">{label}</span>
					</div>
					<p className="text-muted-foreground">Last synced: {lastSynced}</p>
					{friendlyError ? (
						<p className="text-destructive">{friendlyError}</p>
					) : null}
				</div>
			</HoverCardContent>
		</HoverCard>
	);
}

function friendlySyncError(error: string) {
	if (
		error.includes("Properties and app properties are limited to 124 bytes")
	) {
		return "Sync metadata is too large. Shorten the note path or sync again after the Drive metadata fix.";
	}

	if (error.includes("Google Drive API has not been used")) {
		return "Google Drive API is disabled for this project. Enable it in Google Cloud, then sync again.";
	}

	if (error.includes("insufficient") || error.includes("permission")) {
		return "Google Drive needs permission again. Disconnect, reconnect, then sync.";
	}

	return "Google Drive sync failed. Try syncing again.";
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
	const { theme } = useTheme();
	const isDark =
		theme === "dark" ||
		(theme === "system" &&
			window.matchMedia("(prefers-color-scheme: dark)").matches);

	const src = isDark ? icon.replace(".png", "-dark.png") : icon;

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
				src={src}
				alt=""
				className="size-3.5 object-contain"
				draggable={false}
			/>
		</button>
	);
}
