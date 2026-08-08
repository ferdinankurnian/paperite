import { RotateCcwIcon, SearchIcon } from "lucide-react";
import { type KeyboardEvent, useMemo, useState } from "react";
import { useKeyboardShortcuts } from "@/components/keyboard-shortcuts-provider";
import { Button } from "@/components/ui/button";
import {
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	type CommandDefinition,
	type CommandId,
	commands,
} from "@/lib/commands";
import {
	findShortcutConflict,
	formatShortcut,
	normalizeShortcut,
} from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

export function KeyboardSettings() {
	const {
		shortcutOverrides,
		getShortcut,
		setShortcutOverride,
		resetShortcut,
		resetAllShortcuts,
	} = useKeyboardShortcuts();
	const [query, setQuery] = useState("");
	const [capturing, setCapturing] = useState<CommandId | null>(null);
	const [conflict, setConflict] = useState<{
		command: CommandDefinition;
		targetCommandId: CommandId;
		shortcut: string;
	} | null>(null);

	const groupedCommands = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		const filteredCommands = normalizedQuery
			? commands.filter((command) =>
					[
						command.label,
						command.category,
						formatShortcut(getShortcut(command.id)),
					]
						.join(" ")
						.toLowerCase()
						.includes(normalizedQuery),
				)
			: commands;

		return filteredCommands.reduce(
			(groups, command) => {
				groups[command.category] = [
					...(groups[command.category] ?? []),
					command,
				];
				return groups;
			},
			{} as Partial<Record<CommandDefinition["category"], CommandDefinition[]>>,
		);
	}, [getShortcut, query]);

	const captureShortcut = (
		command: CommandDefinition,
		event: KeyboardEvent<HTMLButtonElement>,
	) => {
		event.preventDefault();
		event.stopPropagation();

		if (event.key === "Escape") {
			setCapturing(null);
			setConflict(null);
			return;
		}

		if (event.key === "Backspace" || event.key === "Delete") {
			setShortcutOverride(command.id, null);
			setCapturing(null);
			setConflict(null);
			return;
		}

		const shortcut = normalizeShortcut(event.nativeEvent);
		if (!shortcut) return;

		const conflictingCommand = findShortcutConflict(
			command.id,
			shortcut,
			commands,
			shortcutOverrides,
		);

		if (conflictingCommand) {
			setConflict({
				command: conflictingCommand,
				targetCommandId: command.id,
				shortcut,
			});
			return;
		}

		setShortcutOverride(command.id, shortcut);
		setCapturing(null);
		setConflict(null);
	};

	return (
		<>
			<DialogHeader className="mb-5 gap-1">
				<DialogTitle className="text-lg">Keyboard</DialogTitle>
				<DialogDescription>
					Customize Paperite shortcuts. Changes are saved immediately.
				</DialogDescription>
			</DialogHeader>
			<div className="mb-4 flex items-center gap-2">
				<div className="relative min-w-0 flex-1">
					<SearchIcon className="-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground" />
					<Input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search shortcuts..."
						className="pl-8"
					/>
				</div>
				<Button type="button" variant="outline" onClick={resetAllShortcuts}>
					<RotateCcwIcon className="size-4" />
					Reset all
				</Button>
			</div>
			<div className="space-y-4">
				{Object.entries(groupedCommands).map(([category, categoryCommands]) => (
					<section key={category} className="space-y-2">
						<h3 className="px-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
							{category}
						</h3>
						<div className="overflow-hidden rounded-xl bg-muted/45">
							{categoryCommands.map((command) => (
								<div
									key={command.id}
									className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
								>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium">{command.label}</p>
										{command.description ? (
											<p className="text-xs text-muted-foreground">
												{command.description}
											</p>
										) : null}
									</div>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() => setCapturing(command.id)}
										onKeyDown={(event) => captureShortcut(command, event)}
										className={cn(
											"min-w-28 tabular-nums",
											capturing === command.id && "border-ring text-ring",
											getShortcut(command.id) === null &&
												"text-muted-foreground",
										)}
									>
										{capturing === command.id
											? "Press shortcut..."
											: formatShortcut(getShortcut(command.id))}
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										onClick={() => resetShortcut(command.id)}
									>
										<RotateCcwIcon className="size-4" />
										<span className="sr-only">Reset {command.label}</span>
									</Button>
								</div>
							))}
						</div>
					</section>
				))}
			</div>
			{conflict ? (
				<div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
					<p className="font-medium">Shortcut already used</p>
					<p className="text-xs text-muted-foreground">
						{formatShortcut(conflict.shortcut)} is assigned to{" "}
						{conflict.command.label}.
					</p>
					<div className="mt-3 flex gap-2">
						<Button
							type="button"
							size="sm"
							onClick={() => {
								setShortcutOverride(conflict.command.id, null);
								setShortcutOverride(
									conflict.targetCommandId,
									conflict.shortcut,
								);
								setCapturing(null);
								setConflict(null);
							}}
						>
							Replace
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => setConflict(null)}
						>
							Cancel
						</Button>
					</div>
				</div>
			) : null}
		</>
	);
}
