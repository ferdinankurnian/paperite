import { useEffect, useState } from "react";
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
	| "quote"
	| "code-block"
	| "typography-heading-1"
	| "typography-heading-2"
	| "typography-heading-3"
	| "typography-body"
	| "bullet-list"
	| "ordered-list"
	| "task-list";

export function AppTitlebar() {
	const [title, setTitle] = useState(() => document.title || fallbackTitle);

	useEffect(() => {
		const syncTitle = () => setTitle(document.title || fallbackTitle);
		const observer = new MutationObserver(syncTitle);
		const titleElement = document.querySelector("title");

		if (titleElement) {
			observer.observe(titleElement, { childList: true });
		}

		window.addEventListener("paperite:title-change", syncTitle);

		return () => {
			observer.disconnect();
			window.removeEventListener("paperite:title-change", syncTitle);
		};
	}, []);

	return (
		<header className="app-region-drag relative z-50 grid h-9 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-border/60 bg-background/95 text-foreground">
			<AppMenu />
			<div className="pointer-events-none min-w-0 px-4 text-center text-[13px] font-medium text-muted-foreground">
				<span className="block max-w-[48vw] truncate">{title}</span>
			</div>
			<WindowControls />
		</header>
	);
}

function AppMenu() {
	const runAction = (action: WindowAction) => {
		window.electron?.window.action(action);
	};

	const runFormat = (command: EditorFormatCommand) => {
		window.dispatchEvent(
			new CustomEvent("paperite:editor-format", {
				detail: { command },
			}),
		);
	};

	const toggleFocusMode = () => {
		window.dispatchEvent(new Event("paperite:toggle-focus-mode"));
	};

	return (
		<div className="app-region-no-drag flex min-w-0 items-center px-1">
			<Menubar className="border-none bg-transparent p-0">
				<MenubarMenu>
					<MenubarTrigger>File</MenubarTrigger>
					<MenubarContent>
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
						<MenubarSeparator />
						<MenubarGroup>
							<MenubarItem
								variant="destructive"
								onSelect={() => runAction("quit")}
							>
								Quit
								<MenubarShortcut>Ctrl+Q</MenubarShortcut>
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
							<MenubarItem onSelect={toggleFocusMode}>
								Toggle Focus Mode
								<MenubarShortcut>Ctrl+Shift+F</MenubarShortcut>
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
						</MenubarGroup>
					</MenubarContent>
				</MenubarMenu>
				<MenubarMenu>
					<MenubarTrigger>Format</MenubarTrigger>
					<MenubarContent>
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
							<MenubarItem onSelect={() => runFormat("typography-heading-1")}>
								Typography: Heading 1
							</MenubarItem>
							<MenubarItem onSelect={() => runFormat("typography-heading-2")}>
								Typography: Heading 2
							</MenubarItem>
							<MenubarItem onSelect={() => runFormat("typography-heading-3")}>
								Typography: Heading 3
							</MenubarItem>
							<MenubarItem onSelect={() => runFormat("typography-body")}>
								Typography: Body
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
