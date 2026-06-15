export type CommandCategory = "General" | "Notes" | "Tabs" | "View" | "Window";

export type CommandId =
	| "settings.open"
	| "note.create"
	| "folder.create"
	| "note.setup"
	| "note.find"
	| "note.replace"
	| "tab.next"
	| "tab.previous"
	| "tab.close"
	| "view.toggleZen"
	| "view.toggleSidebar"
	| "window.quit";

export type CommandDefinition = {
	id: CommandId;
	label: string;
	category: CommandCategory;
	defaultShortcut: string | null;
	editable: boolean;
	description?: string;
};

export const commands = [
	{
		id: "settings.open",
		label: "Open settings",
		category: "General",
		defaultShortcut: "Mod+,",
		editable: true,
	},
	{
		id: "note.create",
		label: "Create note",
		category: "Notes",
		defaultShortcut: "Mod+N",
		editable: true,
	},
	{
		id: "folder.create",
		label: "Create folder",
		category: "Notes",
		defaultShortcut: "Mod+Shift+N",
		editable: true,
	},
	{
		id: "note.setup",
		label: "Open note setup",
		category: "Notes",
		defaultShortcut: "Mod+Shift+,",
		editable: true,
	},
	{
		id: "note.find",
		label: "Find in note",
		category: "Notes",
		defaultShortcut: "Mod+F",
		editable: true,
	},
	{
		id: "note.replace",
		label: "Replace in note",
		category: "Notes",
		defaultShortcut: "Mod+Alt+F",
		editable: true,
	},
	{
		id: "tab.next",
		label: "Next tab",
		category: "Tabs",
		defaultShortcut: "Mod+Tab",
		editable: true,
	},
	{
		id: "tab.previous",
		label: "Previous tab",
		category: "Tabs",
		defaultShortcut: "Mod+Shift+Tab",
		editable: true,
	},
	{
		id: "tab.close",
		label: "Close tab",
		category: "Tabs",
		defaultShortcut: "Mod+W",
		editable: true,
	},
	{
		id: "view.toggleZen",
		label: "Toggle zen mode",
		category: "View",
		defaultShortcut: "Mod+Shift+F",
		editable: true,
	},
	{
		id: "view.toggleSidebar",
		label: "Toggle sidebar",
		category: "View",
		defaultShortcut: "Alt+B",
		editable: true,
		description: "Uses Alt+B so Mod+B stays available for editor bold.",
	},
	{
		id: "window.quit",
		label: "Quit Paperite",
		category: "Window",
		defaultShortcut: "Mod+Q",
		editable: true,
	},
] satisfies CommandDefinition[];

export const commandById = new Map(
	commands.map((command) => [command.id, command]),
);
