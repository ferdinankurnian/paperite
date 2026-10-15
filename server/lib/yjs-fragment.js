const Y = require("yjs");

// Must match the `collaborationField` in src/components/note-editor.tsx:
// the live TipTap body lives in this top-level XmlFragment, shared by every
// surface. The `content.body` Y.Map is legacy/v vestigial — full-state
// encodes still write it for old readers, but the fragment is the body
// source of truth (it is what keystrokes actually mutate).
const FRAGMENT_FIELD = "prosemirror";

// Yjs hashes overlapping mark names (`bold--a1b2c3d4`); strip back to the
// mark type. Mirrors yattr2markname in @tiptap/y-tiptap.
const hashedMarkNameRegex = /(.*)(--[a-zA-Z0-9+/=]{8})$/;
const yAttrToMarkName = (attrName) =>
	hashedMarkNameRegex.exec(attrName)?.[1] ?? attrName;

// Schema-free port of yXmlFragmentToProsemirrorJSON: fragment → TipTap JSON.
// Runs on the server on every Y append (projection) and fold-compare, so it
// must stay dependency-free and total (never throw on unknown nodes).
const yFragmentToNoteBody = (doc) => {
	let fragment;
	try {
		fragment = doc.getXmlFragment(FRAGMENT_FIELD);
	} catch {
		return { type: "doc", content: [] };
	}

	const serialize = (item) => {
		if (item instanceof Y.XmlText) {
			let delta;
			try {
				delta = item.toDelta();
			} catch {
				return [];
			}
			return delta.flatMap((d) => {
				if (typeof d.insert !== "string" || d.insert.length === 0) return [];
				const text = { type: "text", text: d.insert };
				if (d.attributes) {
					// ychange is ephemeral collab bookkeeping, never file content.
					const marks = Object.keys(d.attributes)
						.filter((attrName) => attrName !== "ychange")
						.map((attrName) => {
							const attrs = d.attributes[attrName];
							const mark = { type: yAttrToMarkName(attrName) };
							if (attrs && Object.keys(attrs).length > 0) mark.attrs = attrs;
							return mark;
						});
					if (marks.length > 0) text.marks = marks;
				}
				return [text];
			});
		}
		if (item instanceof Y.XmlElement) {
			const node = { type: item.nodeName || "paragraph" };
			let attrs = {};
			try {
				attrs = item.getAttributes();
			} catch {
				attrs = {};
			}
			if (attrs && Object.keys(attrs).length > 0) node.attrs = { ...attrs };
			let children = [];
			try {
				children = item.toArray();
			} catch {
				children = [];
			}
			if (children.length > 0) node.content = children.flatMap(serialize);
			return [node];
		}
		return [];
	};

	let items = [];
	try {
		items = fragment.toArray();
	} catch {
		items = [];
	}
	return { type: "doc", content: items.flatMap(serialize) };
};

// Mirror of prosemirrorToYXmlFragment, from TipTap JSON directly (no schema
// on the server): replaces the fragment so a full-state write (PUT, agent
// fold, first seed) sets the body deterministically instead of coin-flipping
// a Y.Map key merge against concurrent state.
const writeNoteBodyToYFragment = (doc, body) => {
	const fragment = doc.getXmlFragment(FRAGMENT_FIELD);
	const normalized =
		body && typeof body === "object" && !Array.isArray(body) ? body : {};
	const blocks = Array.isArray(normalized.content) ? normalized.content : [];

	doc.transact(() => {
		if (fragment.length > 0) fragment.delete(0, fragment.length);
		let offset = 0;
		for (const block of blocks) {
			offset = insertNode(fragment, offset, block);
		}
	});
};

// Insert `node` into an already-integrated `parent` at `index`, then fill it
// (reads/writes on detached types warn and misbehave, so integration first).
// Returns the next sibling offset.
const insertNode = (parent, index, node) => {
	if (!node || typeof node !== "object") return index;
	if (node.type === "text") {
		const text = typeof node.text === "string" ? node.text : "";
		if (!text) return index;
		const yText = new Y.XmlText();
		parent.insert(index, [yText]);
		try {
			yText.insert(0, text);
		} catch {
			return index + 1;
		}
		const marks = Array.isArray(node.marks) ? node.marks : [];
		for (const mark of marks) {
			if (!mark || typeof mark.type !== "string") continue;
			if (mark.type === "ychange") continue;
			try {
				yText.format(0, text.length, {
					[mark.type]: mark.attrs ?? {},
				});
			} catch {
				// A mark the fragment cannot represent is dropped, never fatal.
			}
		}
		return index + 1;
	}
	const element = new Y.XmlElement(
		typeof node.type === "string" ? node.type : "paragraph",
	);
	parent.insert(index, [element]);
	if (
		node.attrs &&
		typeof node.attrs === "object" &&
		!Array.isArray(node.attrs)
	) {
		for (const [key, value] of Object.entries(node.attrs)) {
			if (value === undefined) continue;
			try {
				element.setAttribute(key, value);
			} catch {
				// Ignore unrepresentable attributes.
			}
		}
	}
	const children = Array.isArray(node.content) ? node.content : [];
	let childOffset = 0;
	for (const child of children) {
		childOffset = insertNode(element, childOffset, child);
	}
	return index + 1;
};

module.exports = {
	FRAGMENT_FIELD,
	yFragmentToNoteBody,
	writeNoteBodyToYFragment,
};
