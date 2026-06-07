# CodeMirror migration

## Core migration

- [x] Replace Tiptap with a markdown-first CodeMirror 6 editor.
- [x] Keep note switching, read-only mode, title focus handoff, autosave, and search highlighting.
- [x] Keep markdown formatting actions for bold, italic, underline, strike, headings, lists, and tasks.
- [x] Remove HTML-to-markdown serialization and obsolete Tiptap dependencies.
- [ ] Benchmark a large markdown fixture against the previous editor.

## Live preview

- [x] Style markdown headings, lists, quotes, inline code, and fenced code blocks with viewport decorations.
- [x] Hide common markdown markers outside the active cursor line.
- [x] Add interactive checkbox widgets for `- [ ]` and `- [x]`.
- [ ] Style links and tags. Markdown links are done; tags remain.
- [ ] Add focused regression tests for large paste and note switching.

## Deliberate removals

- [x] Remove text alignment controls. Alignment is not portable Markdown.
