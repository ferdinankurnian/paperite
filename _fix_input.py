from pathlib import Path

p = Path("paperite/src/routes/_main/index.tsx")
t = p.read_text()

if 'from "@/components/ui/input"' not in t:
    needle = 'import { Button } from "@/components/ui/button";\n'
    assert needle in t, "button import not found"
    t = t.replace(
        needle,
        needle + 'import { Input } from "@/components/ui/input";\n',
        1,
    )
    print("1 added Input import")
else:
    print("1 Input import already present")

old_find = '''\t\t\t\t\t\t\t\t\t<input
\t\t\t\t\t\t\t\t\t\tref={findInputRef}
\t\t\t\t\t\t\t\t\t\tvalue={findText}
\t\t\t\t\t\t\t\t\t\tplaceholder="Find..."
\t\t\t\t\t\t\t\t\t\tclassName="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 outline-none focus-visible:border-ring"
\t\t\t\t\t\t\t\t\t\tonChange={(event) => setFindText(event.target.value)}
\t\t\t\t\t\t\t\t\t\tonKeyDown={(event) => {
\t\t\t\t\t\t\t\t\t\t\tif (event.key === "Escape") setFloatingPanelMode(null);
\t\t\t\t\t\t\t\t\t\t}}
\t\t\t\t\t\t\t\t\t/>'''

new_find = '''\t\t\t\t\t\t\t\t\t<Input
\t\t\t\t\t\t\t\t\t\tref={findInputRef}
\t\t\t\t\t\t\t\t\t\tvalue={findText}
\t\t\t\t\t\t\t\t\t\tplaceholder="Find..."
\t\t\t\t\t\t\t\t\t\tclassName="min-w-0 flex-1"
\t\t\t\t\t\t\t\t\t\tonChange={(event) => setFindText(event.target.value)}
\t\t\t\t\t\t\t\t\t\tonKeyDown={(event) => {
\t\t\t\t\t\t\t\t\t\t\tif (event.key === "Escape") setFloatingPanelMode(null);
\t\t\t\t\t\t\t\t\t\t}}
\t\t\t\t\t\t\t\t\t/>'''

assert old_find in t, "find input not found"
t = t.replace(old_find, new_find, 1)
print("2 find Input")

old_replace = '''\t\t\t\t\t\t\t\t\t\t<input
\t\t\t\t\t\t\t\t\t\t\tvalue={replaceText}
\t\t\t\t\t\t\t\t\t\t\tplaceholder="Replace..."
\t\t\t\t\t\t\t\t\t\t\tclassName="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 outline-none focus-visible:border-ring"
\t\t\t\t\t\t\t\t\t\t\tonChange={(event) => setReplaceText(event.target.value)}
\t\t\t\t\t\t\t\t\t\t\tonKeyDown={(event) => {
\t\t\t\t\t\t\t\t\t\t\t\tif (event.key === "Escape") setFloatingPanelMode(null);
\t\t\t\t\t\t\t\t\t\t\t}}
\t\t\t\t\t\t\t\t\t\t/>'''

new_replace = '''\t\t\t\t\t\t\t\t\t\t<Input
\t\t\t\t\t\t\t\t\t\t\tvalue={replaceText}
\t\t\t\t\t\t\t\t\t\t\tplaceholder="Replace..."
\t\t\t\t\t\t\t\t\t\t\tclassName="min-w-0 flex-1"
\t\t\t\t\t\t\t\t\t\t\tonChange={(event) => setReplaceText(event.target.value)}
\t\t\t\t\t\t\t\t\t\t\tonKeyDown={(event) => {
\t\t\t\t\t\t\t\t\t\t\t\tif (event.key === "Escape") setFloatingPanelMode(null);
\t\t\t\t\t\t\t\t\t\t\t}}
\t\t\t\t\t\t\t\t\t\t/>'''

assert old_replace in t, "replace input not found"
t = t.replace(old_replace, new_replace, 1)
print("3 replace Input")

p.write_text(t)
print("OK")
