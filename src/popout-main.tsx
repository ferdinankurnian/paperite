import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppTitlebar } from "@/components/app-titlebar";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createEmptyNoteContent } from "@/lib/note-content";
import "./index.css";

const NoteEditor = lazy(() =>
	import("@/components/note-editor").then((m) => ({ default: m.NoteEditor })),
);

type PageFormat = {
	firstLineIndent: boolean;
	lineHeight: "normal" | "1.5";
	paragraphSpacing: "default" | "compact";
};

const defaultPageFormat: PageFormat = {
	firstLineIndent: false,
	lineHeight: "normal",
	paragraphSpacing: "default",
};

function fileName(notePath: string) {
	return notePath.split("/").at(-1) ?? notePath;
}

function stripNoteExtension(filename: string) {
	return filename.replace(/\.(?:json|md)$/i, "");
}

const params = new URLSearchParams(window.location.search);
const noteParam = params.get("note");
const notePath = noteParam ? decodeURIComponent(noteParam) : null;

function EditorSkeleton() {
	return (
		<div className="flex h-full flex-col items-center pt-24 text-muted-foreground">
			<div className="h-8 w-48 animate-pulse rounded bg-muted" />
			<div className="mt-6 flex flex-col gap-3">
				<div className="h-4 w-80 animate-pulse rounded bg-muted" />
				<div className="h-4 w-64 animate-pulse rounded bg-muted" />
				<div className="h-4 w-72 animate-pulse rounded bg-muted" />
			</div>
		</div>
	);
}

function PopoutNote() {
	const [noteContent, setNoteContent] = useState(() =>
		createEmptyNoteContent(),
	);
	const [noteTitle, setNoteTitle] = useState("");
	const [loadedNotePath, setLoadedNotePath] = useState<string | null>(null);
	const [currentNotePath, setCurrentNotePath] = useState<string | null>(
		notePath,
	);
	const noteContentRef = useRef(noteContent);
	const activeEditorContentRef = useRef<(() => typeof noteContent) | null>(
		null,
	);

	const getActiveContent = useCallback(
		() => activeEditorContentRef.current?.() ?? noteContentRef.current,
		[],
	);

	const enqueueNoteWrite = useCallback(
		(path: string, content: typeof noteContent) => {
			if (!window.electron) return Promise.resolve();
			return window.electron.notes.writeNote(path, content);
		},
		[],
	);

	const saveNote = useCallback(
		(path: string, content: typeof noteContent) => {
			if (!path) return;
			enqueueNoteWrite(path, content).catch(() => undefined);
		},
		[enqueueNoteWrite],
	);

	useEffect(() => {
		if (!notePath || !window.electron) return;

		window.electron.notes.readNote(notePath).then((content) => {
			setNoteContent(content);
			noteContentRef.current = content;
			setLoadedNotePath(notePath);
			setNoteTitle(stripNoteExtension(fileName(notePath)) || "Untitled");
		});
	}, [notePath]);

	useEffect(() => {
		if (!window.electron) return;

		const cleanup = window.electron.onNotePathChanged((data) => {
			setCurrentNotePath(data.to);
			setNoteTitle(stripNoteExtension(fileName(data.to)) || "Untitled");
		});

		return cleanup;
	}, []);

	useEffect(() => {
		if (!loadedNotePath || !currentNotePath) return;

		const saveTimeout = setTimeout(() => {
			const content = getActiveContent();
			if (JSON.stringify(content) !== JSON.stringify(noteContentRef.current)) {
				saveNote(currentNotePath, content);
				noteContentRef.current = content;
			}
		}, 500);

		return () => clearTimeout(saveTimeout);
	}, [loadedNotePath, currentNotePath, getActiveContent, saveNote]);

	const handleContentChange = useCallback((content: typeof noteContent) => {
		setNoteContent(content);
		noteContentRef.current = content;
	}, []);

	const handleContentRendered = useCallback((_notePath: string) => {}, []);

	const handleTitleChange = useCallback((title: string) => {
		setNoteTitle(title);
	}, []);

	const handleRename = useCallback(
		async (title: string) => {
			const activePath = currentNotePath;
			if (!activePath || !window.electron) return;

			try {
				const renamed = await window.electron.notes.renameItem(
					activePath,
					title,
				);
				const nextTitle = stripNoteExtension(fileName(renamed.path));
				setCurrentNotePath(renamed.path);
				setNoteTitle(nextTitle);

				if (loadedNotePath === activePath) {
					setLoadedNotePath(renamed.path);
				}
			} catch {
				// rename failed
			}
		},
		[currentNotePath, loadedNotePath],
	);

	if (!notePath) {
		return (
			<div className="flex h-svh items-center justify-center bg-background text-muted-foreground">
				No note specified
			</div>
		);
	}

	return (
		<ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
			<TooltipProvider>
				<div className="paperite-shell flex h-svh flex-col overflow-hidden bg-background">
					<AppTitlebar />
					<div className="min-h-0 flex-1 overflow-hidden">
						{loadedNotePath ? (
							<Suspense fallback={<EditorSkeleton />}>
								<NoteEditor
									content={noteContent}
									notePath={currentNotePath || notePath}
									noteTitle={noteTitle}
									pageFormat={defaultPageFormat}
									readOnly={false}
									searchQuery=""
									onChange={handleContentChange}
									onContentRendered={handleContentRendered}
									onRename={handleRename}
									onTitleChange={handleTitleChange}
								/>
							</Suspense>
						) : (
							<EditorSkeleton />
						)}
					</div>
				</div>
			</TooltipProvider>
		</ThemeProvider>
	);
}

const rootElement = document.getElementById("root")!;
if (!rootElement.innerHTML) {
	createRoot(rootElement).render(<PopoutNote />);
}
