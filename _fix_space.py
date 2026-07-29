from pathlib import Path

p = Path("paperite/src/components/app-sidebar.tsx")
t = p.read_text()

# 1) Add mountedSpacePaths state after existing local state
old = '''\tconst [dragPreviewItem, setDragPreviewItem] =
\t\tReact.useState<DragPreviewItem | null>(null);
\tconst activeSpace = spaces.find((space) => space.path === activeSpacePath);'''

new = '''\tconst [dragPreviewItem, setDragPreviewItem] =
\t\tReact.useState<DragPreviewItem | null>(null);
\t// Keep previously visited space lists mounted (hide/show) so switching
\t// spaces is instant — same idea as browser tabs / editor tabs.
\tconst [mountedSpacePaths, setMountedSpacePaths] = React.useState<string[]>(
\t\t() =>
\t\t\tactiveSpacePath && activeSpacePath !== "Trash"
\t\t\t\t? [activeSpacePath]
\t\t\t\t: ["Inbox"],
\t);
\tReact.useEffect(() => {
\t\tif (!activeSpacePath || activeSpacePath === "Trash") return;
\t\tsetMountedSpacePaths((prev) =>
\t\t\tprev.includes(activeSpacePath) ? prev : [...prev, activeSpacePath],
\t\t);
\t}, [activeSpacePath]);
\tReact.useEffect(() => {
\t\tconst valid = new Set(spaces.map((space) => space.path));
\t\tsetMountedSpacePaths((prev) => {
\t\t\tconst next = prev.filter((path) => valid.has(path));
\t\t\treturn next.length === prev.length ? prev : next;
\t\t});
\t}, [spaces]);
\tconst activeSpace = spaces.find((space) => space.path === activeSpacePath);'''

assert old in t, "state insert point not found"
t = t.replace(old, new, 1)
print("1 mountedSpacePaths state")

# 2) Precompute items per mounted space
old = '''\tconst sortedVisibleChildren = React.useMemo(
\t\t() =>
\t\t\tsortWorkspaceItems(
\t\t\t\tvisibleChildren,
\t\t\t\tactiveSpacePath === "Inbox" && sortOrder === "custom"
\t\t\t\t\t? "newest"
\t\t\t\t\t: sortOrder,
\t\t\t\tcustomItemOrders,
\t\t\t\tactiveSpacePath,
\t\t\t),
\t\t[activeSpacePath, customItemOrders, visibleChildren, sortOrder],
\t);'''

new = '''\tconst sortedVisibleChildren = React.useMemo(
\t\t() =>
\t\t\tsortWorkspaceItems(
\t\t\t\tvisibleChildren,
\t\t\t\tactiveSpacePath === "Inbox" && sortOrder === "custom"
\t\t\t\t\t? "newest"
\t\t\t\t\t: sortOrder,
\t\t\t\tcustomItemOrders,
\t\t\t\tactiveSpacePath,
\t\t\t),
\t\t[activeSpacePath, customItemOrders, visibleChildren, sortOrder],
\t);
\tconst mountedSpaceItems = React.useMemo(() => {
\t\tconst map = new Map<
\t\t\tstring,
\t\t\t{ space: (typeof spaces)[number]; items: typeof sortedVisibleChildren }
\t\t>();
\t\tfor (const path of mountedSpacePaths) {
\t\t\tconst space = spaces.find((entry) => entry.path === path);
\t\t\tif (!space) continue;
\t\t\tconst effectiveSort =
\t\t\t\tpath === "Inbox" && sortOrder === "custom" && path === activeSpacePath
\t\t\t\t\t? "newest"
\t\t\t\t\t: path === activeSpacePath
\t\t\t\t\t\t? sortOrder
\t\t\t\t\t\t: path === "Inbox"
\t\t\t\t\t\t\t? "newest"
\t\t\t\t\t\t\t: sortOrder;
\t\t\tmap.set(path, {
\t\t\t\tspace,
\t\t\t\titems: sortWorkspaceItems(
\t\t\t\t\tfilterWorkspaceItems(space.children ?? [], searchQuery),
\t\t\t\t\teffectiveSort,
\t\t\t\t\tcustomItemOrders,
\t\t\t\t\tpath,
\t\t\t\t),
\t\t\t});
\t\t}
\t\treturn map;
\t}, [
\t\tmountedSpacePaths,
\t\tspaces,
\t\tactiveSpacePath,
\t\tsortOrder,
\t\tcustomItemOrders,
\t\tsearchQuery,
\t]);'''

assert old in t, "sortedVisibleChildren not found"
t = t.replace(old, new, 1)
print("2 mountedSpaceItems")

# 3) Replace the content render block with keep-alive panels
old = '''\t\t\t\t\t\t\t\t{activeSpacePath === "Trash" ? (
\t\t\t\t\t\t\t\t\ttrashNotes.length > 0 ? (
\t\t\t\t\t\t\t\t\t\t<NoteGrid
\t\t\t\t\t\t\t\t\t\t\titems={trashNotes.map((n) => ({
\t\t\t\t\t\t\t\t\t\t\t\ttype: "note" as const,
\t\t\t\t\t\t\t\t\t\t\t\ttitle: n.title,
\t\t\t\t\t\t\t\t\t\t\t\tpath: n.trashPath,
\t\t\t\t\t\t\t\t\t\t\t\tpreview: n.preview,
\t\t\t\t\t\t\t\t\t\t\t\tupdatedAt: n.deletedAt,
\t\t\t\t\t\t\t\t\t\t\t}))}
\t\t\t\t\t\t\t\t\t\t\tactiveNotePath={activeNotePath}
\t\t\t\t\t\t\t\t\t\t\tonDeleteItem={() => {}}
\t\t\t\t\t\t\t\t\t\t\tonMoveItem={() => {}}
\t\t\t\t\t\t\t\t\t\t\tonOpenNote={onOpenNote}
\t\t\t\t\t\t\t\t\t\t\tspaces={spaces}
\t\t\t\t\t\t\t\t\t\t\tspaceIcons={spaceIcons}
\t\t\t\t\t\t\t\t\t\t\tspaceColors={spaceColors}
\t\t\t\t\t\t\t\t\t\t\tshowPreview={resolvedShowPreview}
\t\t\t\t\t\t\t\t\t\t\tisTrash
\t\t\t\t\t\t\t\t\t\t\tonRestoreItem={onRestoreItem}
\t\t\t\t\t\t\t\t\t\t\tonPermanentDeleteItem={onPermanentDeleteItem}
\t\t\t\t\t\t\t\t\t\t/>
\t\t\t\t\t\t\t\t\t) : (
\t\t\t\t\t\t\t\t\t\t<Empty>
\t\t\t\t\t\t\t\t\t\t\t<EmptyHeader>
\t\t\t\t\t\t\t\t\t\t\t\t<EmptyMedia variant="icon">
\t\t\t\t\t\t\t\t\t\t\t\t\t<Trash2Icon />
\t\t\t\t\t\t\t\t\t\t\t\t</EmptyMedia>
\t\t\t\t\t\t\t\t\t\t\t\t<EmptyTitle>Trash is empty</EmptyTitle>
\t\t\t\t\t\t\t\t\t\t\t\t<EmptyDescription>
\t\t\t\t\t\t\t\t\t\t\t\t\tDeleted notes will appear here.
\t\t\t\t\t\t\t\t\t\t\t\t</EmptyDescription>
\t\t\t\t\t\t\t\t\t\t\t</EmptyHeader>
\t\t\t\t\t\t\t\t\t\t</Empty>
\t\t\t\t\t\t\t\t\t)
\t\t\t\t\t\t\t\t) : activeSpace && sortedVisibleChildren.length > 0 ? (
\t\t\t\t\t\t\t\t\tviewMode === "grid" && activeSpacePath === "Inbox" ? (
\t\t\t\t\t\t\t\t\t\t<NoteGrid
\t\t\t\t\t\t\t\t\t\t\titems={sortedVisibleChildren}
\t\t\t\t\t\t\t\t\t\t\tactiveNotePath={activeNotePath}
\t\t\t\t\t\t\t\t\t\t\tonDeleteItem={onDeleteItem}
\t\t\t\t\t\t\t\t\t\t\tonMoveItem={onMoveItem}
\t\t\t\t\t\t\t\t\t\t\tonOpenNote={onOpenNote}
\t\t\t\t\t\t\t\t\t\t\tspaces={spaces}
\t\t\t\t\t\t\t\t\t\t\tspaceIcons={spaceIcons}
\t\t\t\t\t\t\t\t\t\t\tspaceColors={spaceColors}
\t\t\t\t\t\t\t\t\t\t\tshowPreview={resolvedShowPreview}
\t\t\t\t\t\t\t\t\t\t/>
\t\t\t\t\t\t\t\t\t) : (
\t\t\t\t\t\t\t\t\t\t<MemoizedNoteTree
\t\t\t\t\t\t\t\t\t\t\tactiveNotePath={activeNotePath}
\t\t\t\t\t\t\t\t\t\t\tcanDragItems={canDragItems}
\t\t\t\t\t\t\t\t\t\t\titems={sortedVisibleChildren}
\t\t\t\t\t\t\t\t\t\t\tonCreateFolder={onCreateFolder}
\t\t\t\t\t\t\t\t\t\t\tonCreateNote={onCreateNote}
\t\t\t\t\t\t\t\t\t\t\tonDeleteItem={onDeleteItem}
\t\t\t\t\t\t\t\t\t\t\tonMoveItem={onMoveItem}
\t\t\t\t\t\t\t\t\t\t\tonOpenNote={onOpenNote}
\t\t\t\t\t\t\t\t\t\t\tonRenameItem={onRenameItem}
\t\t\t\t\t\t\t\t\t\t\tonToggleFolder={handleToggleFolder}
\t\t\t\t\t\t\t\t\t\t\tparentPath={activeSpacePath}
\t\t\t\t\t\t\t\t\t\t\tspaces={spaces}
\t\t\t\t\t\t\t\t\t\t\tspaceIcons={spaceIcons}
\t\t\t\t\t\t\t\t\t\t\tspaceColors={spaceColors}
\t\t\t\t\t\t\t\t\t\t\tshowPreview={resolvedShowPreview}
\t\t\t\t\t\t\t\t\t\t\tisInbox={activeSpacePath === "Inbox"}
\t\t\t\t\t\t\t\t\t\t\tnewlyCreatedFolderPath={newlyCreatedFolderPath}
\t\t\t\t\t\t\t\t\t\t\tonRenameComplete={onRenameComplete}
\t\t\t\t\t\t\t\t\t\t/>
\t\t\t\t\t\t\t\t\t)
\t\t\t\t\t\t\t\t) : (
\t\t\t\t\t\t\t\t\t<Empty>
\t\t\t\t\t\t\t\t\t\t<EmptyHeader>
\t\t\t\t\t\t\t\t\t\t\t<EmptyMedia variant="icon">
\t\t\t\t\t\t\t\t\t\t\t\t<FileTextIcon />
\t\t\t\t\t\t\t\t\t\t\t</EmptyMedia>
\t\t\t\t\t\t\t\t\t\t\t<EmptyTitle>No notes yet</EmptyTitle>
\t\t\t\t\t\t\t\t\t\t\t<EmptyDescription>
\t\t\t\t\t\t\t\t\t\t\t\tCreate a note or drop one into this space.
\t\t\t\t\t\t\t\t\t\t\t</EmptyDescription>
\t\t\t\t\t\t\t\t\t\t</EmptyHeader>
\t\t\t\t\t\t\t\t\t\t<EmptyContent className="flex-row justify-center">
\t\t\t\t\t\t\t\t\t\t\t{activeSpacePath !== "Inbox" && (
\t\t\t\t\t\t\t\t\t\t\t\t<Button
\t\t\t\t\t\t\t\t\t\t\t\t\ttype="button"
\t\t\t\t\t\t\t\t\t\t\t\t\tsize="sm"
\t\t\t\t\t\t\t\t\t\t\t\t\tvariant="outline"
\t\t\t\t\t\t\t\t\t\t\t\t\tonClick={() => onCreateFolder(activeSpacePath)}
\t\t\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t\t\t\t<FolderPlusIcon />
\t\t\t\t\t\t\t\t\t\t\t\t\tNew folder
\t\t\t\t\t\t\t\t\t\t\t\t</Button>
\t\t\t\t\t\t\t\t\t\t\t)}
\t\t\t\t\t\t\t\t\t\t\t<Button
\t\t\t\t\t\t\t\t\t\t\t\ttype="button"
\t\t\t\t\t\t\t\t\t\t\t\tsize="sm"
\t\t\t\t\t\t\t\t\t\t\t\tonClick={() => onCreateNote(activeSpacePath)}
\t\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t\t\t<StickyNotePlusIcon />
\t\t\t\t\t\t\t\t\t\t\t\tNew note
\t\t\t\t\t\t\t\t\t\t\t</Button>
\t\t\t\t\t\t\t\t\t\t</EmptyContent>
\t\t\t\t\t\t\t\t\t</Empty>
\t\t\t\t\t\t\t\t)}'''

new = '''\t\t\t\t\t\t\t\t{activeSpacePath === "Trash" ? (
\t\t\t\t\t\t\t\t\ttrashNotes.length > 0 ? (
\t\t\t\t\t\t\t\t\t\t<NoteGrid
\t\t\t\t\t\t\t\t\t\t\titems={trashNotes.map((n) => ({
\t\t\t\t\t\t\t\t\t\t\t\ttype: "note" as const,
\t\t\t\t\t\t\t\t\t\t\t\ttitle: n.title,
\t\t\t\t\t\t\t\t\t\t\t\tpath: n.trashPath,
\t\t\t\t\t\t\t\t\t\t\t\tpreview: n.preview,
\t\t\t\t\t\t\t\t\t\t\t\tupdatedAt: n.deletedAt,
\t\t\t\t\t\t\t\t\t\t\t}))}
\t\t\t\t\t\t\t\t\t\t\tactiveNotePath={activeNotePath}
\t\t\t\t\t\t\t\t\t\t\tonDeleteItem={() => {}}
\t\t\t\t\t\t\t\t\t\t\tonMoveItem={() => {}}
\t\t\t\t\t\t\t\t\t\t\tonOpenNote={onOpenNote}
\t\t\t\t\t\t\t\t\t\t\tspaces={spaces}
\t\t\t\t\t\t\t\t\t\t\tspaceIcons={spaceIcons}
\t\t\t\t\t\t\t\t\t\t\tspaceColors={spaceColors}
\t\t\t\t\t\t\t\t\t\t\tshowPreview={resolvedShowPreview}
\t\t\t\t\t\t\t\t\t\t\tisTrash
\t\t\t\t\t\t\t\t\t\t\tonRestoreItem={onRestoreItem}
\t\t\t\t\t\t\t\t\t\t\tonPermanentDeleteItem={onPermanentDeleteItem}
\t\t\t\t\t\t\t\t\t\t/>
\t\t\t\t\t\t\t\t\t) : (
\t\t\t\t\t\t\t\t\t\t<Empty>
\t\t\t\t\t\t\t\t\t\t\t<EmptyHeader>
\t\t\t\t\t\t\t\t\t\t\t\t<EmptyMedia variant="icon">
\t\t\t\t\t\t\t\t\t\t\t\t\t<Trash2Icon />
\t\t\t\t\t\t\t\t\t\t\t\t</EmptyMedia>
\t\t\t\t\t\t\t\t\t\t\t\t<EmptyTitle>Trash is empty</EmptyTitle>
\t\t\t\t\t\t\t\t\t\t\t\t<EmptyDescription>
\t\t\t\t\t\t\t\t\t\t\t\t\tDeleted notes will appear here.
\t\t\t\t\t\t\t\t\t\t\t\t</EmptyDescription>
\t\t\t\t\t\t\t\t\t\t\t</EmptyHeader>
\t\t\t\t\t\t\t\t\t\t</Empty>
\t\t\t\t\t\t\t\t\t)
\t\t\t\t\t\t\t\t) : (
\t\t\t\t\t\t\t\t\tmountedSpacePaths.map((spacePath) => {
\t\t\t\t\t\t\t\t\t\tconst entry = mountedSpaceItems.get(spacePath);
\t\t\t\t\t\t\t\t\t\tif (!entry) return null;
\t\t\t\t\t\t\t\t\t\tconst isActive = spacePath === activeSpacePath;
\t\t\t\t\t\t\t\t\t\tconst { items: spaceItems } = entry;
\t\t\t\t\t\t\t\t\t\treturn (
\t\t\t\t\t\t\t\t\t\t\t<div
\t\t\t\t\t\t\t\t\t\t\t\tkey={spacePath}
\t\t\t\t\t\t\t\t\t\t\t\tclassName={isActive ? undefined : "hidden"}
\t\t\t\t\t\t\t\t\t\t\t\thidden={!isActive}
\t\t\t\t\t\t\t\t\t\t\t\taria-hidden={!isActive}
\t\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t\t\t{spaceItems.length > 0 ? (
\t\t\t\t\t\t\t\t\t\t\t\t\tviewMode === "grid" && spacePath === "Inbox" ? (
\t\t\t\t\t\t\t\t\t\t\t\t\t\t<NoteGrid
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\titems={spaceItems}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tactiveNotePath={activeNotePath}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tonDeleteItem={onDeleteItem}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tonMoveItem={onMoveItem}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tonOpenNote={onOpenNote}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tspaces={spaces}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tspaceIcons={spaceIcons}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tspaceColors={spaceColors}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tshowPreview={resolvedShowPreview}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t/>
\t\t\t\t\t\t\t\t\t\t\t\t\t) : (
\t\t\t\t\t\t\t\t\t\t\t\t\t\t<MemoizedNoteTree
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tactiveNotePath={activeNotePath}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tcanDragItems={canDragItems}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\titems={spaceItems}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tonCreateFolder={onCreateFolder}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tonCreateNote={onCreateNote}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tonDeleteItem={onDeleteItem}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tonMoveItem={onMoveItem}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tonOpenNote={onOpenNote}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tonRenameItem={onRenameItem}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tonToggleFolder={handleToggleFolder}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tparentPath={spacePath}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tspaces={spaces}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tspaceIcons={spaceIcons}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tspaceColors={spaceColors}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tshowPreview={resolvedShowPreview}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tisInbox={spacePath === "Inbox"}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tnewlyCreatedFolderPath={
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tisActive ? newlyCreatedFolderPath : null
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tonRenameComplete={onRenameComplete}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t/>
\t\t\t\t\t\t\t\t\t\t\t\t\t)
\t\t\t\t\t\t\t\t\t\t\t\t) : isActive ? (
\t\t\t\t\t\t\t\t\t\t\t\t\t<Empty>
\t\t\t\t\t\t\t\t\t\t\t\t\t\t<EmptyHeader>
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t<EmptyMedia variant="icon">
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t<FileTextIcon />
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t</EmptyMedia>
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t<EmptyTitle>No notes yet</EmptyTitle>
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t<EmptyDescription>
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tCreate a note or drop one into this space.
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t</EmptyDescription>
\t\t\t\t\t\t\t\t\t\t\t\t\t\t</EmptyHeader>
\t\t\t\t\t\t\t\t\t\t\t\t\t\t<EmptyContent className="flex-row justify-center">
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t{spacePath !== "Inbox" && (
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t<Button
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\ttype="button"
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tsize="sm"
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tvariant="outline"
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tonClick={() => onCreateFolder(spacePath)}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t<FolderPlusIcon />
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tNew folder
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t</Button>
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t)}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t<Button
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\ttype="button"
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tsize="sm"
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tonClick={() => onCreateNote(spacePath)}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t<StickyNotePlusIcon />
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tNew note
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t</Button>
\t\t\t\t\t\t\t\t\t\t\t\t\t\t</EmptyContent>
\t\t\t\t\t\t\t\t\t\t\t\t\t</Empty>
\t\t\t\t\t\t\t\t\t\t\t\t) : null}
\t\t\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t\t);
\t\t\t\t\t\t\t\t\t})
\t\t\t\t\t\t\t\t)}'''

assert old in t, "content block not found"
t = t.replace(old, new, 1)
print("3 keep-alive render")

p.write_text(t)
print("OK")
