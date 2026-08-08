#!/usr/bin/env python3
from pathlib import Path

p = Path("src/routes/_main/index.tsx")
src = p.read_text()
start = src.index("type SortableTabProps")
end = src.index("function Index()")
new_src = src[:start] + src[end:]
needle = 'import { AppSidebar } from "@/components/app-sidebar";\n'
if "tab-bar" not in new_src:
    new_src = new_src.replace(
        needle,
        needle + 'import { TabBar } from "@/components/tab-bar";\n',
    )
p.write_text(new_src)
print("ok, lines", new_src.count("\n") + 1)
