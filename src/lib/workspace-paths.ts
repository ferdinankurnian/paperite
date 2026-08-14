import type { WorkspaceSnapshot } from "@/lib/storage/types";

export function unique(values: string[]) {
	return Array.from(new Set(values.filter(Boolean)));
}

export function topLevelPath(notePath: string) {
	return notePath.split("/")[0] || "Inbox";
}

/** Resolve active space without React subscription (plan 015). */
export function resolveSpacePath(
	activeSpacePath: string,
	workspace: WorkspaceSnapshot | null | undefined,
): string {
	if (activeSpacePath === "Trash") return "Trash";
	if (!workspace?.spaces.some((space) => space.path === activeSpacePath)) {
		return workspace?.spaces[0]?.path ?? "Inbox";
	}
	return activeSpacePath;
}

export function parentPath(itemPath: string) {
	const separatorIndex = itemPath.lastIndexOf("/");
	return separatorIndex === -1 ? "" : itemPath.slice(0, separatorIndex);
}

export function fileName(notePath: string) {
	return notePath.split("/").at(-1) ?? notePath;
}

export function stripNoteExtension(filename: string) {
	return filename.replace(/\.(?:json|md)$/i, "");
}

export function isSameOrChildPath(parent: string, childPath: string) {
	return childPath === parent || childPath.startsWith(`${parent}/`);
}

export function movePath(path: string, fromPath: string, toPath: string) {
	if (path === fromPath) return toPath;
	return `${toPath}/${path.slice(fromPath.length + 1)}`;
}

export function moveDecorations<T>(
	decorations: Record<string, T>,
	fromPath: string,
	toPath: string,
) {
	return Object.fromEntries(
		Object.entries(decorations).map(([path, value]) => [
			isSameOrChildPath(fromPath, path)
				? movePath(path, fromPath, toPath)
				: path,
			value,
		]),
	);
}

export function moveCustomItemOrders(
	customItemOrders: Record<string, string[]>,
	fromPath: string,
	toPath: string,
) {
	if (fromPath === toPath) return customItemOrders;

	const fromParentPath = parentPath(fromPath);
	const toParentPath = parentPath(toPath);
	const movedAcrossParents = fromParentPath !== toParentPath;
	const movedOrders: Record<string, string[]> = {};

	for (const [parent, order] of Object.entries(customItemOrders)) {
		const nextParent = isSameOrChildPath(fromPath, parent)
			? movePath(parent, fromPath, toPath)
			: parent;
		const nextOrder = order
			.filter(
				(path) =>
					!(
						movedAcrossParents &&
						parent === fromParentPath &&
						path === fromPath
					),
			)
			.map((path) =>
				isSameOrChildPath(fromPath, path)
					? movePath(path, fromPath, toPath)
					: path,
			);

		movedOrders[nextParent] = unique([
			...(movedOrders[nextParent] ?? []),
			...nextOrder,
		]);
	}

	if (movedAcrossParents && movedOrders[toParentPath]) {
		movedOrders[toParentPath] = unique([...movedOrders[toParentPath], toPath]);
	}

	return movedOrders;
}

export function omitCustomItemOrders(
	customItemOrders: Record<string, string[]>,
	pathToOmit: string,
) {
	return Object.fromEntries(
		Object.entries(customItemOrders)
			.filter(([parent]) => !isSameOrChildPath(pathToOmit, parent))
			.map(([parent, order]) => [
				parent,
				order.filter((path) => !isSameOrChildPath(pathToOmit, path)),
			]),
	) as Record<string, string[]>;
}

export function omitDecoration<T>(
	decorations: Record<string, T>,
	pathToOmit: string,
) {
	return Object.fromEntries(
		Object.entries(decorations).filter(
			([path]) => !isSameOrChildPath(pathToOmit, path),
		),
	);
}

export function omitExact<T>(record: Record<string, T>, pathToOmit: string) {
	const { [pathToOmit]: _omitted, ...rest } = record;
	return rest;
}
