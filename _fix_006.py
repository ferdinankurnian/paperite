from pathlib import Path

# types.ts
p = Path("src/lib/storage/types.ts")
t = p.read_text()
t = t.replace(
    "export type OpenNoteTab = {\n\tpath: string;\n\ttitle: string;\n\tpreview: boolean;\n};",
    "export type OpenNoteTab = {\n\tpath: string;\n\ttitle: string;\n\tpreview: boolean;\n\tpinned: boolean;\n};",
)
p.write_text(t)
print("types updated")

# sidebar: rename pinned mode -> fixed
p = Path("src/components/app-sidebar.tsx")
t = p.read_text()
t = t.replace('mode: "preview" | "pinned"', 'mode: "preview" | "fixed"')
t = t.replace('"pinned"', '"fixed"')  # careful - might over-replace
p.write_text(t)
print("sidebar mode rename done - check manually if over-replaced")
