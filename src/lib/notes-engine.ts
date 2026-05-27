export type NotesEngine = NonNullable<Window["electron"]>["notes"];

export function getNotesEngine(): NotesEngine | null {
	return window.electron?.notes ?? null;
}
