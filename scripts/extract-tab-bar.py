#!/usr/bin/env python3
from pathlib import Path

src = Path("src/routes/_main/index.tsx").read_text()
start = src.index("type SortableTabProps")
end = src.index("function Index()")
chunk = src[start:end].rstrip() + "\n"
chunk = chunk.replace(
    "const TabBar = memo(function TabBar(",
    "export const TabBar = memo(function TabBar(",
)

header = '''import {
\tclosestCenter,
\tdefaultDropAnimationSideEffects,
\tDndContext,
\ttype DragEndEvent,
\ttype DragStartEvent,
\tDragOverlay,
\ttype DropAnimation,
\ttype Modifier,
\tPointerSensor,
\tuseSensor,
\tuseSensors,
} from "@dnd-kit/core";
import {
\tarrayMove,
\thorizontalListSortingStrategy,
\tSortableContext,
\tuseSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
\tCloudIcon,
\tFolderIcon,
\tInboxIcon,
\tPinIcon,
\tXIcon,
} from "lucide-react";
import {
\ttype CSSProperties,
\tmemo,
\tuseCallback,
\tuseEffect,
\tuseMemo,
\tuseRef,
\tuseState,
} from "react";
import {
\tHoverCard,
\tHoverCardContent,
\tHoverCardTrigger,
} from "@/components/ui/hover-card";
import {
\tContextMenu,
\tContextMenuContent,
\tContextMenuItem,
\tContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useAppStore } from "@/lib/stores/app-store";
import { useEditorUiStore } from "@/lib/stores/editor-ui-store";

function displayNoteTitle(title: string) {
\treturn title.trim() || "Untitled";
}

function topLevelPath(notePath: string) {
\treturn notePath.split("/")[0] || "Inbox";
}

'''

out = Path("src/components/tab-bar.tsx")
out.write_text(header + chunk)
print(f"wrote {out} ({out.stat().st_size} bytes)")
