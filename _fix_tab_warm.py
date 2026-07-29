from pathlib import Path
import re

p = Path("paperite/src/routes/_main/index.tsx")
t = p.read_text()

old = '''type SortableTabProps = {
	note: OpenNoteTab;
	isActive: boolean;
	displayTitle: (title: string) => string;
	spacePath: string;
	spaceTitle: string;
	spaceIcon?: string;
	spaceColor?: string;
	onSelect: () => void;
	onDoubleClick: () => void;
	onClose: () => void;
	onTogglePin: () => void;
};'''

new = '''type SortableTabProps = {
	note: OpenNoteTab;
	isActive: boolean;
	displayTitle: (title: string) => string;
	spacePath: string;
	spaceTitle: string;
	spaceIcon?: string;
	spaceColor?: string;
	openDelay: number;
	onHoverOpen: () => void;
	onSelect: () => void;
	onDoubleClick: () => void;
	onClose: () => void;
	onTogglePin: () => void;
};'''
assert old in t, "props"
t = t.replace(old, new, 1)
print("1 props")

old = '''function SortableTab({
	note,
	isActive,
	displayTitle,
	spacePath,
	spaceTitle,
	spaceIcon,
	spaceColor,
	onSelect,
	onDoubleClick,
	onClose,
	onTogglePin,
}: SortableTabProps) {'''

new = '''function SortableTab({
	note,
	isActive,
	displayTitle,
	spacePath,
	spaceTitle,
	spaceIcon,
	spaceColor,
	openDelay,
	onHoverOpen,
	onSelect,
	onDoubleClick,
	onClose,
	onTogglePin,
}: SortableTabProps) {'''
assert old in t, "sig"
t = t.replace(old, new, 1)
print("2 sig")

old = "\t\t<HoverCard openDelay={1000} closeDelay={100}>"
new = '''\t\t<HoverCard
\t\t\topenDelay={openDelay}
\t\t\tcloseDelay={100}
\t\t\tonOpenChange={(open) => {
\t\t\t\tif (open) onHoverOpen();
\t\t\t}}
\t\t>'''
assert old in t, "HoverCard"
t = t.replace(old, new, 1)
print("3 HoverCard")

m = re.search(r"const tabListRef = useRef[^;]+;", t)
assert m, "tabListRef"
insert_after = m.group(0)
extra = """
	const [tabHoverWarm, setTabHoverWarm] = useState(false);
	const tabHoverCoolTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const markTabHoverWarm = useCallback(() => {
		if (tabHoverCoolTimerRef.current) {
			clearTimeout(tabHoverCoolTimerRef.current);
			tabHoverCoolTimerRef.current = null;
		}
		setTabHoverWarm(true);
	}, []);
	const scheduleTabHoverCool = useCallback(() => {
		if (tabHoverCoolTimerRef.current) clearTimeout(tabHoverCoolTimerRef.current);
		tabHoverCoolTimerRef.current = setTimeout(() => {
			setTabHoverWarm(false);
			tabHoverCoolTimerRef.current = null;
		}, 200);
	}, []);"""

if "tabHoverWarm" not in t:
	t = t.replace(insert_after, insert_after + extra, 1)
	print("4 state")
else:
	print("4 state already")

old = '''\t\t\t\t\t\t<div
\t\t\t\t\t\t\tref={tabListRef}
\t\t\t\t\t\t\tclassName="no-scrollbar flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain"
\t\t\t\t\t\t\tonWheel={(e) => {
\t\t\t\t\t\t\t\tif (e.deltaY !== 0) {
\t\t\t\t\t\t\t\t\te.preventDefault();
\t\t\t\t\t\t\t\t\ttabListRef.current?.scrollBy({
\t\t\t\t\t\t\t\t\t\tleft: e.deltaY,
\t\t\t\t\t\t\t\t\t\tbehavior: "auto",
\t\t\t\t\t\t\t\t\t});
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t}}
\t\t\t\t\t\t>'''

new = '''\t\t\t\t\t\t<div
\t\t\t\t\t\t\tref={tabListRef}
\t\t\t\t\t\t\tclassName="no-scrollbar flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain"
\t\t\t\t\t\t\tonMouseEnter={() => {
\t\t\t\t\t\t\t\tif (tabHoverCoolTimerRef.current) {
\t\t\t\t\t\t\t\t\tclearTimeout(tabHoverCoolTimerRef.current);
\t\t\t\t\t\t\t\t\ttabHoverCoolTimerRef.current = null;
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t}}
\t\t\t\t\t\t\tonMouseLeave={scheduleTabHoverCool}
\t\t\t\t\t\t\tonWheel={(e) => {
\t\t\t\t\t\t\t\tif (e.deltaY !== 0) {
\t\t\t\t\t\t\t\t\te.preventDefault();
\t\t\t\t\t\t\t\t\ttabListRef.current?.scrollBy({
\t\t\t\t\t\t\t\t\t\tleft: e.deltaY,
\t\t\t\t\t\t\t\t\t\tbehavior: "auto",
\t\t\t\t\t\t\t\t\t});
\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t}}
\t\t\t\t\t\t>'''
assert old in t, "tab list"
t = t.replace(old, new, 1)
print("5 tab list")

old = '''\t\t\t\t\t\t\t\t\t\t\t\tspaceIcon={appState.spaceIcons[spacePath]}
\t\t\t\t\t\t\t\t\t\t\t\tspaceColor={appState.spaceColors[spacePath]}
\t\t\t\t\t\t\t\t\t\t\t\tonSelect={() => selectTab(note.path)}'''

new = '''\t\t\t\t\t\t\t\t\t\t\t\tspaceIcon={appState.spaceIcons[spacePath]}
\t\t\t\t\t\t\t\t\t\t\t\tspaceColor={appState.spaceColors[spacePath]}
\t\t\t\t\t\t\t\t\t\t\t\topenDelay={tabHoverWarm ? 0 : 1000}
\t\t\t\t\t\t\t\t\t\t\t\tonHoverOpen={markTabHoverWarm}
\t\t\t\t\t\t\t\t\t\t\t\tonSelect={() => selectTab(note.path)}'''
assert old in t, "call site"
t = t.replace(old, new, 1)
print("6 call site")

p.write_text(t)
print("OK")
