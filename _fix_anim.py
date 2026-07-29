from pathlib import Path
import re

p = Path("paperite/src/index.css")
t = p.read_text()

pat = r'/\*\n \* Radix portals mount content already.*?\[data-slot="sheet-overlay"\]\n\)\[data-state="open"\] \{\n\tanimation: paperite-overlay-enter var\(--tw-duration, 0.2s\) ease both;\n\}\n'

new = r'''/*
 * Radix portals mount already open. Enter must grow from the trigger origin
 * (--radix-*-content-transform-origin). Plain center scale looks wrong next to
 * exit, which already respects that origin. @starting-style runs after layout
 * so the origin var is set before the transition starts.
 */
:is(
	[data-slot="dropdown-menu-content"],
	[data-slot="dropdown-menu-sub-content"]
) {
	transform-origin: var(--radix-dropdown-menu-content-transform-origin);
}

:is(
	[data-slot="context-menu-content"],
	[data-slot="context-menu-sub-content"]
) {
	transform-origin: var(--radix-context-menu-content-transform-origin);
}

[data-slot="popover-content"] {
	transform-origin: var(--radix-popover-content-transform-origin);
}

[data-slot="select-content"] {
	transform-origin: var(--radix-select-content-transform-origin);
}

:is(
	[data-slot="menubar-content"],
	[data-slot="menubar-sub-content"]
) {
	transform-origin: var(--radix-menubar-content-transform-origin);
}

[data-slot="hover-card-content"] {
	transform-origin: var(--radix-hover-card-content-transform-origin);
}

[data-slot="tooltip-content"] {
	transform-origin: var(--radix-tooltip-content-transform-origin);
}

:is(
	[data-slot="dropdown-menu-content"],
	[data-slot="dropdown-menu-sub-content"],
	[data-slot="context-menu-content"],
	[data-slot="context-menu-sub-content"],
	[data-slot="popover-content"],
	[data-slot="select-content"],
	[data-slot="menubar-content"],
	[data-slot="menubar-sub-content"],
	[data-slot="hover-card-content"],
	[data-slot="tooltip-content"],
	[data-slot="dialog-content"],
	[data-slot="alert-dialog-content"],
	[data-slot="sheet-content"]
)[data-state="open"] {
	/* kill center-origin keyframe enter from tw-animate */
	animation: none;
	opacity: 1;
	transform: scale(1);
	transition:
		opacity var(--tw-duration, 0.2s) ease,
		transform var(--tw-duration, 0.2s) ease;
}

@starting-style {
	:is(
			[data-slot="dropdown-menu-content"],
			[data-slot="dropdown-menu-sub-content"],
			[data-slot="context-menu-content"],
			[data-slot="context-menu-sub-content"],
			[data-slot="popover-content"],
			[data-slot="select-content"],
			[data-slot="menubar-content"],
			[data-slot="menubar-sub-content"],
			[data-slot="hover-card-content"],
			[data-slot="tooltip-content"],
			[data-slot="dialog-content"],
			[data-slot="alert-dialog-content"],
			[data-slot="sheet-content"]
	)[data-state="open"] {
		opacity: 0;
		transform: scale(0.96);
	}
}

:is(
	[data-slot="dialog-overlay"],
	[data-slot="alert-dialog-overlay"],
	[data-slot="sheet-overlay"]
)[data-state="open"] {
	animation: none;
	opacity: 1;
	transition: opacity var(--tw-duration, 0.2s) ease;
}

@starting-style {
	:is(
			[data-slot="dialog-overlay"],
			[data-slot="alert-dialog-overlay"],
			[data-slot="sheet-overlay"]
	)[data-state="open"] {
		opacity: 0;
	}
}
'''

t2, n = re.subn(pat, new, t, count=1, flags=re.S)
print("replacements", n)
assert n == 1, "pattern not found"
p.write_text(t2)
print("ok")
