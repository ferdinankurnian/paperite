from pathlib import Path

p = Path("paperite/src/components/app-sidebar.tsx")
t = p.read_text()

# --- 1) helper + context before NoteTree ---
if "highlightSearchText" not in t:
	insert_at = t.find("function NoteTree({")
	assert insert_at > 0
	helper = '''const SearchQueryContext = React.createContext("");

/** Highlight case-insensitive matches — same yellow mark as in-note find. */
function highlightSearchText(text: string, query: string): React.ReactNode {
	const needle = query.trim();
	if (!needle || !text) return text;

	const lowerText = text.toLocaleLowerCase();
	const lowerNeedle = needle.toLocaleLowerCase();
	const parts: React.ReactNode[] = [];
	let start = 0;
	let matchIndex = lowerText.indexOf(lowerNeedle, start);
	let key = 0;

	while (matchIndex >= 0) {
		if (matchIndex > start) {
			parts.push(text.slice(start, matchIndex));
		}
		parts.push(
			<mark
				key={key}
				className="search-match rounded-[2px] px-0.5 text-inherit"
			>
				{text.slice(matchIndex, matchIndex + needle.length)}
			</mark>,
		);
		key += 1;
		start = matchIndex + needle.length;
		matchIndex = lowerText.indexOf(lowerNeedle, start);
	}

	if (start < text.length) parts.push(text.slice(start));
	return parts.length > 0 ? <>{parts}</> : text;
}

'''
	t = t[:insert_at] + helper + t[insert_at:]
	print("1 helper")
else:
	print("1 skip")

# --- 2) NoteCard (list): inject context + highlight ---
old_hook = '''\tconst setNodeRef = React.useCallback(
\t\t(node: HTMLButtonElement | null) => {
\t\t\tsetDraggableRef(node);
\t\t\tsetDroppableRef(node);
\t\t},
\t\t[setDraggableRef, setDroppableRef],
\t);

\treturn (
\t\t<>
\t\t\t<ContextMenu>
\t\t\t\t<ContextMenuTrigger asChild>
\t\t\t\t\t<button
\t\t\t\t\t\tref={setNodeRef}'''

if "const searchQuery = React.useContext(SearchQueryContext)" not in t[t.find("MemoizedNoteCard"):t.find("MemoizedNoteCard")+2500]:
	new_hook = '''\tconst setNodeRef = React.useCallback(
\t\t(node: HTMLButtonElement | null) => {
\t\t\tsetDraggableRef(node);
\t\t\tsetDroppableRef(node);
\t\t},
\t\t[setDraggableRef, setDroppableRef],
\t);
\tconst searchQuery = React.useContext(SearchQueryContext);
\tconst displayTitle = item.title.trim() || "Untitled";

\treturn (
\t\t<>
\t\t\t<ContextMenu>
\t\t\t\t<ContextMenuTrigger asChild>
\t\t\t\t\t<button
\t\t\t\t\t\tref={setNodeRef}'''
	assert old_hook in t, "NoteCard hook"
	t = t.replace(old_hook, new_hook, 1)
	print("2 NoteCard hook")
else:
	print("2 NoteCard hook skip")

old_title = '''\t\t\t\t\t\t\t<span className="min-w-0 flex-1 truncate font-medium">
\t\t\t\t\t\t\t\t<>
\t\t\t\t\t\t\t\t{item.pinned ? (
\t\t\t\t\t\t\t\t\t<PinIcon className="mr-1 inline size-3.5 shrink-0 text-muted-foreground" />
\t\t\t\t\t\t\t\t) : null}
\t\t\t\t\t\t\t\t{item.title.trim() || "Untitled"}
\t\t\t\t\t\t\t</>
\t\t\t\t\t\t\t</span>
\t\t\t\t\t\t</div>
\t\t\t\t\t\t{showPreview && item.preview ? (
\t\t\t\t\t\t\t<span className="line-clamp-2 w-full text-xs whitespace-break-spaces text-sidebar-foreground/65">
\t\t\t\t\t\t\t\t{item.preview}
\t\t\t\t\t\t\t</span>
\t\t\t\t\t\t) : null}'''

if "highlightSearchText(displayTitle, searchQuery)" not in t:
	new_title = '''\t\t\t\t\t\t\t<span className="min-w-0 flex-1 truncate font-medium">
\t\t\t\t\t\t\t\t<>
\t\t\t\t\t\t\t\t{item.pinned ? (
\t\t\t\t\t\t\t\t\t<PinIcon className="mr-1 inline size-3.5 shrink-0 text-muted-foreground" />
\t\t\t\t\t\t\t\t) : null}
\t\t\t\t\t\t\t\t{highlightSearchText(displayTitle, searchQuery)}
\t\t\t\t\t\t\t</>
\t\t\t\t\t\t\t</span>
\t\t\t\t\t\t</div>
\t\t\t\t\t\t{showPreview && item.preview ? (
\t\t\t\t\t\t\t<span className="line-clamp-2 w-full text-xs whitespace-break-spaces text-sidebar-foreground/65">
\t\t\t\t\t\t\t\t{highlightSearchText(item.preview, searchQuery)}
\t\t\t\t\t\t\t</span>
\t\t\t\t\t\t) : null}'''
	assert old_title in t, "NoteCard title"
	t = t.replace(old_title, new_title, 1)
	print("3 NoteCard title")
else:
	print("3 NoteCard title skip")

# --- 3) NoteGridCard ---
old_g = '''\tconst { attributes, isDragging, listeners, setNodeRef } = useDraggable({
\t\tid: note.path,
\t\tdata: {
\t\t\tpreview: note.preview,
\t\t\ttitle: note.title,
\t\t\ttype: "note" satisfies DragPreviewItem["type"],
\t\t},
\t});'''

if t.count(old_g) == 1 and "displayTitle = note.title" not in t:
	new_g = old_g + '''
\tconst searchQuery = React.useContext(SearchQueryContext);
\tconst displayTitle = note.title.trim() || "Untitled";'''
	t = t.replace(old_g, new_g, 1)
	print("4 NoteGridCard hook")
else:
	print("4 NoteGridCard hook skip", t.count(old_g))

# title in grid card
old_gt = '''\t\t\t\t\t\t\t{note.pinned ? (
\t\t\t\t\t\t\t\t<PinIcon className="mr-1 inline size-3.5 shrink-0 text-muted-foreground" />
\t\t\t\t\t\t\t) : null}
\t\t\t\t\t\t\t{note.title.trim() || "Untitled"}'''

if old_gt in t:
	new_gt = '''\t\t\t\t\t\t\t{note.pinned ? (
\t\t\t\t\t\t\t\t<PinIcon className="mr-1 inline size-3.5 shrink-0 text-muted-foreground" />
\t\t\t\t\t\t\t) : null}
\t\t\t\t\t\t\t{highlightSearchText(displayTitle, searchQuery)}'''
	t = t.replace(old_gt, new_gt, 1)
	print("5 NoteGridCard title")
else:
	print("5 NoteGridCard title skip")

# preview in grid - find after NoteGridCard function
gi = t.find("function NoteGridCard")
rest = t[gi:]
# find note.preview in grid card section only (before next function or MoveToSpace)
# try common patterns
for clamp in ("line-clamp-3", "line-clamp-2", "line-clamp-4"):
	old_gp = f'''{{showPreview && note.preview ? (
\t\t\t\t\t\t\t<span className="{clamp} w-full text-xs whitespace-break-spaces text-sidebar-foreground/65">
\t\t\t\t\t\t\t\t{{note.preview}}
\t\t\t\t\t\t\t</span>'''
	if old_gp in t:
		new_gp = old_gp.replace("{note.preview}", "{highlightSearchText(note.preview, searchQuery)}")
		t = t.replace(old_gp, new_gp, 1)
		print("6 NoteGridCard preview", clamp)
		break
else:
	# dump context
	j = t.find("note.preview", gi + 200)
	print("6 preview context", repr(t[j-80:j+60]))

# --- 4) Provider ---
if "SearchQueryContext.Provider" not in t:
	old_p = "<ExpandedFoldersContext.Provider value={expandedFoldersStore}>"
	new_p = '''<SearchQueryContext.Provider value={searchQuery}>
\t\t\t<ExpandedFoldersContext.Provider value={expandedFoldersStore}>'''
	assert old_p in t
	t = t.replace(old_p, new_p, 1)
	old_c = "</ExpandedFoldersContext.Provider>"
	# only the one that closes the note sidebar provider
	new_c = '''</ExpandedFoldersContext.Provider>
\t\t\t</SearchQueryContext.Provider>'''
	assert t.count(old_c) == 1
	t = t.replace(old_c, new_c, 1)
	print("7 provider")
else:
	print("7 provider skip")

p.write_text(t)
print("OK")
