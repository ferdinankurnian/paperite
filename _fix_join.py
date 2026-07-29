from pathlib import Path
import re

p = Path("paperite/src/components/app-sidebar.tsx")
t = p.read_text()

old = '''const handleOpenNote = React.useCallback(
		(note: WorkspaceNote, mode: preview | fixed) => {
			const parts = note.path.split("/");
			// path segments before the note name are folders (space/folder/.../note)
			for (let i = 1; i < parts.length - 1; i++) {
				const folderPath = parts.slice(0, i + 1).join(/);
				handleToggleFolder(folderPath, true);
			}
			onOpenNote(note, mode);
		},
		[handleToggleFolder, onOpenNote],
	);'''

new = '''const handleOpenNote = React.useCallback(
		(note: WorkspaceNote, mode: "preview" | "fixed") => {
			const parts = note.path.split("/");
			// path segments before the note name are folders (space/folder/.../note)
			for (let i = 1; i < parts.length - 1; i++) {
				const folderPath = parts.slice(0, i + 1).join("/");
				handleToggleFolder(folderPath, true);
			}
			onOpenNote(note, mode);
		},
		[handleToggleFolder, onOpenNote],
	);'''

if old not in t:
    idx = t.find("const handleOpenNote")
    print("NOT FOUND, actual:")
    print(repr(t[idx:idx+400]))
    # try regex replace on join(/) and mode types
    t2 = t.replace(".join(/)", '.join("/")')
    t2 = re.sub(
        r"\(note: WorkspaceNote, mode: preview \| fixed\)",
        '(note: WorkspaceNote, mode: "preview" | "fixed")',
        t2,
        count=1,
    )
    p.write_text(t2)
    idx = p.read_text().find("const handleOpenNote")
    print("after regex:", repr(p.read_text()[idx:idx+400]))
else:
    p.write_text(t.replace(old, new, 1))
    print("replaced block OK")
    idx = p.read_text().find("const handleOpenNote")
    print(repr(p.read_text()[idx:idx+400]))
