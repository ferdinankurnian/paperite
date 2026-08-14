import type {
	WorkspaceItem,
	WorkspaceNote,
	WorkspaceSnapshot,
} from "@/lib/storage/types";

export function updateWorkspaceNote(
	workspace: WorkspaceSnapshot,
	notePath: string,
	patch: Pick<WorkspaceNote, "preview" | "updatedAt">,
): WorkspaceSnapshot {
	return {
		...workspace,
		spaces: workspace.spaces.map((space) => ({
			...space,
			children: updateWorkspaceItems(space.children, notePath, patch),
		})),
	};
}

function updateWorkspaceItems(
	items: WorkspaceItem[],
	notePath: string,
	patch: Pick<WorkspaceNote, "preview" | "updatedAt">,
): WorkspaceItem[] {
	let changed = false;
	const nextItems = items.map((item) => {
		if (item.type === "note") {
			if (item.path !== notePath) return item;
			changed = true;
			return { ...item, ...patch };
		}
		const children = updateWorkspaceItems(item.children, notePath, patch);
		if (children === item.children) return item;
		changed = true;
		return { ...item, children };
	});
	if (!changed) return items;
	return nextItems;
}
