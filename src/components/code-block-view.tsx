import type { NodeViewProps } from "@tiptap/react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { CheckIcon, CopyIcon, SearchIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Languages available in lowlight `common` bundle (+ plaintext). */
const CODE_LANGUAGES = [
	{ value: "text", label: "text" },
	{ value: "bash", label: "bash" },
	{ value: "c", label: "c" },
	{ value: "cpp", label: "c++" },
	{ value: "csharp", label: "c#" },
	{ value: "css", label: "css" },
	{ value: "diff", label: "diff" },
	{ value: "go", label: "go" },
	{ value: "graphql", label: "graphql" },
	{ value: "ini", label: "ini" },
	{ value: "java", label: "java" },
	{ value: "javascript", label: "javascript" },
	{ value: "json", label: "json" },
	{ value: "kotlin", label: "kotlin" },
	{ value: "less", label: "less" },
	{ value: "lua", label: "lua" },
	{ value: "makefile", label: "makefile" },
	{ value: "markdown", label: "markdown" },
	{ value: "objectivec", label: "objective-c" },
	{ value: "perl", label: "perl" },
	{ value: "php", label: "php" },
	{ value: "python", label: "python" },
	{ value: "r", label: "r" },
	{ value: "ruby", label: "ruby" },
	{ value: "rust", label: "rust" },
	{ value: "scss", label: "scss" },
	{ value: "shell", label: "shell" },
	{ value: "sql", label: "sql" },
	{ value: "swift", label: "swift" },
	{ value: "typescript", label: "typescript" },
	{ value: "xml", label: "xml" },
	{ value: "yaml", label: "yaml" },
] as const;

const LANGUAGE_VALUES = new Set(CODE_LANGUAGES.map((l) => l.value));

function normalizeLanguage(raw: string | null | undefined): string {
	if (!raw || raw === "plaintext" || raw === "plain") return "text";
	if (raw === "js") return "javascript";
	if (raw === "ts") return "typescript";
	if (raw === "py") return "python";
	if (raw === "sh") return "bash";
	return LANGUAGE_VALUES.has(raw) ? raw : "text";
}

export function CodeBlockView({
	node,
	updateAttributes,
	editor,
}: NodeViewProps) {
	const language = normalizeLanguage(
		node.attrs.language as string | null | undefined,
	);
	const [copied, setCopied] = useState(false);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const editable = editor.isEditable;

	const filtered = useMemo(
		() =>
			CODE_LANGUAGES.filter((l) =>
				l.label.toLowerCase().includes(query.toLowerCase()),
			),
		[query],
	);

	const handleCopy = useCallback(async () => {
		const text = node.textContent;
		if (!text) return;

		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1500);
		} catch {
			// clipboard may be unavailable; ignore
		}
	}, [node.textContent]);

	const handleLanguageChange = useCallback(
		(value: string) => {
			updateAttributes({
				language: value === "text" ? null : value,
			});
			setOpen(false);
			setQuery("");
		},
		[updateAttributes],
	);

	const currentLabel =
		CODE_LANGUAGES.find((l) => l.value === language)?.label ?? language;

	return (
		<NodeViewWrapper
			className="paperite-code-block group my-4 overflow-hidden rounded-md border border-border/50 bg-muted/70"
			data-language={language}
		>
			<div
				className="flex items-center justify-between gap-2 border-b border-border/50 px-2 py-1"
				contentEditable={false}
			>
				{editable ? (
					<Popover
						open={open}
						onOpenChange={(next) => {
							setOpen(next);
							if (next) {
								setQuery("");
								requestAnimationFrame(() => inputRef.current?.focus());
							}
						}}
					>
						<PopoverTrigger asChild>
							<button
								type="button"
								className={cn(
									"h-6 min-w-0 rounded-sm border-0 bg-transparent px-1.5 text-[11px] font-medium",
									"text-muted-foreground lowercase shadow-none",
									"hover:bg-muted/80 hover:text-foreground",
									"dark:bg-transparent dark:hover:bg-muted/50",
									"inline-flex items-center gap-1 outline-none focus-visible:ring-1",
								)}
								aria-label="Code language"
							>
								{currentLabel}
							</button>
						</PopoverTrigger>
						<PopoverContent
							align="start"
							className="w-48 p-0"
							onOpenAutoFocus={(e) => e.preventDefault()}
						>
							<div className="flex items-center gap-2 border-b px-2 py-1.5">
								<SearchIcon className="size-4 shrink-0 text-muted-foreground" />
								<input
									ref={inputRef}
									type="text"
									placeholder="Search language..."
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
									onKeyDown={(e) => {
										if (e.key === "Enter" && filtered.length === 1) {
											handleLanguageChange(filtered[0].value);
										}
										if (e.key === "Escape") {
											setOpen(false);
										}
									}}
								/>
							</div>
							<div className="max-h-64 overflow-y-auto p-1">
								{filtered.length === 0 ? (
									<div className="px-2 py-1.5 text-sm text-muted-foreground">
										No language found
									</div>
								) : (
									filtered.map((lang) => {
										const isCurrent = lang.value === language;
										return (
											<button
												key={lang.value}
												type="button"
												onClick={() => handleLanguageChange(lang.value)}
												className={cn(
													"relative flex w-full cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm lowercase outline-none select-none",
													"hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
													isCurrent && "bg-accent/50",
												)}
											>
												<span className="min-w-0 flex-1 truncate">
													{lang.label}
												</span>
												{isCurrent && (
													<CheckIcon className="ml-auto size-4 shrink-0" />
												)}
											</button>
										);
									})
								)}
							</div>
						</PopoverContent>
					</Popover>
				) : (
					<span className="select-none px-1.5 text-[11px] font-medium text-muted-foreground lowercase">
						{currentLabel}
					</span>
				)}
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className={cn(
						"text-muted-foreground opacity-70 transition-opacity hover:opacity-100",
						"group-hover:opacity-100",
					)}
					onClick={handleCopy}
					aria-label={copied ? "Copied" : "Copy code"}
				>
					{copied ? (
						<CheckIcon className="size-3.5 text-emerald-500" />
					) : (
						<CopyIcon className="size-3.5" />
					)}
				</Button>
			</div>
			<pre className="m-0 overflow-x-auto px-3 py-2 font-mono text-sm text-foreground">
				<NodeViewContent as="code" />
			</pre>
		</NodeViewWrapper>
	);
}
