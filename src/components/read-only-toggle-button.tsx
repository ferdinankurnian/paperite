import { memo, useCallback, useEffect, useState } from "react";
import { BookOpenIcon, PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getNoteReadOnlyController, subscribeNoteReadOnlyRegistry } from "@/components/note-editor";
import { useAppStore } from "@/lib/stores/app-store";

export const ReadOnlyToggleButton = memo(function ReadOnlyToggleButton() {
  const activeNotePath = useAppStore((s) => s.activeNotePath);
  const [isReadOnly, setIsReadOnly] = useState(false);
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    const attach = () => { unsubscribe?.(); const controller = getNoteReadOnlyController(activeNotePath); if (!controller) { setIsReadOnly(false); return; } setIsReadOnly(controller.get()); unsubscribe = controller.subscribe(setIsReadOnly); };
    attach(); const registry = subscribeNoteReadOnlyRegistry(attach); return () => { registry(); unsubscribe?.(); };
  }, [activeNotePath]);
  const toggle = useCallback(() => getNoteReadOnlyController(useAppStore.getState().activeNotePath)?.toggle(), []);
  if (!activeNotePath) return null;
  return <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={isReadOnly ? "Edit note" : "Reading view"} onClick={toggle}>{isReadOnly ? <PencilIcon /> : <BookOpenIcon />}</Button>;
});
