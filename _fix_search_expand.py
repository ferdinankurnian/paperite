from pathlib import Path

p = Path("paperite/src/components/app-sidebar.tsx")
t = p.read_text()

# 1) Add SearchExpandPathsContext + collector near SearchQueryContext
old = '''const SearchQueryContext = React.createContext("");'''
new = '''const SearchQueryContext = React.createContext("");
const SearchExpandPathsContext = React.createContext<ReadonlySet<string>>(
	new Set(),
);

/** Folder paths that must stay open so search hits inside them are visible. */
function collectSearchExpandPaths(
	items: WorkspaceItem[],
	query: string,
): Set<string> {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const paths = new Set<string>();
	if (!normalizedQuery) return paths;

	const walk = (nodes: WorkspaceItem[]): boolean => {
		let anyMatch = false;
		for (const item of nodes) {
			if (item.type === "note") {
				if (
					item.title.toLocaleLowerCase().includes(normalizedQuery) ||
					item.preview.toLocaleLowerCase().includes(normalizedQuery)
				) {
					anyMatch = true;
				}
				continue;
			}

			const selfMatch = item.title
				.toLocaleLowerCase()
				.includes(normalizedQuery);
			const childMatch = walk(item.children);
			if (selfMatch || childMatch) {
				paths.add(item.path);
				anyMatch = true;
			}
		}
		return anyMatch;
	};

	walk(items);
	return paths;
}'''

if "collectSearchExpandPaths" not in t:
	assert old in t, "SearchQueryContext missing"
	t = t.replace(old, new, 1)
	print("1 collector")
else:
	print("1 skip")

# 2) useIsFolderExpanded respects force-expand paths
old = '''function useIsFolderExpanded(path: string) {
	const store = React.useContext(ExpandedFoldersContext);
	return React.useSyncExternalStore(
		React.useCallback((cb) => store.subscribe(path, cb), [store, path]),
		React.useCallback(() => store.isExpanded(path), [store, path]),
	);
}'''

new = '''function useIsFolderExpanded(path: string) {
	const store = React.useContext(ExpandedFoldersContext);
	const forceExpandPaths = React.useContext(SearchExpandPathsContext);
	const expanded = React.useSyncExternalStore(
		React.useCallback((cb) => store.subscribe(path, cb), [store, path]),
		React.useCallback(() => store.isExpanded(path), [store, path]),
	);
	// While searching, keep match folders open without mutating saved expand state.
	return expanded || forceExpandPaths.has(path);
}'''

assert old in t, "useIsFolderExpanded"
t = t.replace(old, new, 1)
print("2 useIsFolderExpanded")

# 3) Compute expand paths in AppSidebar near filtered items
# Find: filterWorkspaceItems(activeSpace?.children
# Look for searchQuery filter useMemo

if "collectSearchExpandPaths(" not in t.split("function collectSearchExpandPaths")[1] if False else t:
	pass

# Find the useMemo that filters active space children
old = '''		() => filterWorkspaceItems(activeSpace?.children ?? [], searchQuery),
		[activeSpace?.children, searchQuery],
	);'''

# may have different deps formatting
import re
m = re.search(
	r"\(\) => filterWorkspaceItems\(activeSpace\?\.children \?\? \[\], searchQuery\),\s*\[([^\]]+)\],\s*\);",
	t,
)
if not m:
	# print nearby
	i = t.find("filterWorkspaceItems(activeSpace")
	print("NEAR", repr(t[i:i+200]))
	raise SystemExit("filter memo not found")

# Add after that useMemo a new one for expand paths
# Find exact block
block_start = t.find("() => filterWorkspaceItems(activeSpace?.children ?? [], searchQuery)")
# find the closing of useMemo
# Actually search for full assignment
m2 = re.search(
	r"(const \w+ = React\.useMemo\(\s*\(\) => filterWorkspaceItems\(activeSpace\?\.children \?\? \[\], searchQuery\),\s*\[[^\]]+\],\s*\);)",
	t,
)
if not m2:
	i = t.find("filterWorkspaceItems(activeSpace")
	print(repr(t[i-80:i+180]))
	raise SystemExit("assignment not found")

print("found filter memo", m2.group(1)[:80])

# Get variable name for filtered children
m3 = re.search(
	r"const (\w+) = React\.useMemo\(\s*\(\) => filterWorkspaceItems\(activeSpace\?\.children",
	t,
)
var_name = m3.group(1) if m3 else "filteredItems"
print("var", var_name)

# Insert expand paths memo after this useMemo
insert_after = m2.group(1)
expand_memo = f'''{insert_after}

	const searchExpandPaths = React.useMemo(
		() => collectSearchExpandPaths(activeSpace?.children ?? [], searchQuery),
		[activeSpace?.children, searchQuery],
	);'''

if "searchExpandPaths" not in t:
	t = t.replace(insert_after, expand_memo, 1)
	print("3 searchExpandPaths memo")
else:
	print("3 skip")

# 4) Wrap providers - SearchExpandPathsContext around same area as SearchQuery
old = "<SearchQueryContext.Provider value={searchQuery}>"
new = '''<SearchQueryContext.Provider value={searchQuery}>
			<SearchExpandPathsContext.Provider value={searchExpandPaths}>'''
assert old in t, "SearchQuery provider"
if "SearchExpandPathsContext.Provider" not in t:
	t = t.replace(old, new, 1)
	old_c = "</SearchQueryContext.Provider>"
	new_c = '''</SearchExpandPathsContext.Provider>
			</SearchQueryContext.Provider>'''
	assert old_c in t
	t = t.replace(old_c, new_c, 1)
	print("4 provider")
else:
	print("4 skip")

# Also need expand paths for multi-space mounted view if they filter per space
# Check if other filterWorkspaceItems calls exist for mounted spaces
idx = 0
count = 0
while True:
	j = t.find("filterWorkspaceItems(", idx)
	if j < 0:
		break
	count += 1
	print("call", count, t[j:j+80].replace("\n", " "))
	idx = j + 1

p.write_text(t)
print("OK")
