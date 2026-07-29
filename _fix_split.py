from pathlib import Path
p = Path("paperite/src/components/app-sidebar.tsx")
t = p.read_text()
idx = t.find("const parts = note.path.split")
print("before", repr(t[idx:idx+45]))
# Fix whatever broken form is there
import re
t2, n = re.subn(
    r"const parts = note\.path\.split\(/\);",
    'const parts = note.path.split("/");',
    t,
    count=1,
)
if n == 0:
    t2, n = re.subn(
        r"const parts = note\.path\.split\([^)]*\);",
        'const parts = note.path.split("/");',
        t,
        count=1,
    )
print("replacements", n)
p.write_text(t2)
idx = p.read_text().find("const parts = note.path.split")
print("after", repr(p.read_text()[idx:idx+45]))
