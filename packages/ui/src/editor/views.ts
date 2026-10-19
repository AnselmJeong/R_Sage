// Which view (source or visual) each open .qmd shows, and the live visual
// editors, so the Outline and Search views can jump into the right one.

import { create } from "zustand";
import type { Editor } from "@tiptap/react";
import { editorsByPath, openInEditor } from "./files";

export const visualEditors = new Map<string, Editor>();

/** The chunk (cell id) the user last typed in or ran in each visual view. */
export const focusedCells = new Map<string, string>();

export const useEditorModes = create<Record<string, "source" | "visual">>(() => ({}));

export function isVisual(path: string) {
  return useEditorModes.getState()[path] === "visual" && visualEditors.has(path);
}

/** Open a file and show a place in it: a top-level block in the visual view, otherwise a line. */
export async function reveal(path: string, at: { line: number; column?: number; block?: number; length?: number }) {
  await openInEditor(path);
  const ve = visualEditors.get(path);
  if (isVisual(path) && ve && !ve.isDestroyed) {
    if (at.block !== undefined && at.block < ve.state.doc.childCount) {
      let pos = 0;
      for (let i = 0; i < at.block; i++) pos += ve.state.doc.child(i).nodeSize;
      const dom = ve.view.nodeDOM(pos) as HTMLElement | null;
      dom?.scrollIntoView({ block: "start", behavior: "smooth" });
      const node = ve.state.doc.child(at.block);
      if (node.isTextblock) ve.chain().focus(null, { scrollIntoView: false }).setTextSelection(pos + 1).run();
      flash(dom);
    }
    return;
  }
  setTimeout(() => {
    const ed = editorsByPath.get(path);
    if (!ed) return;
    ed.revealLineInCenter(at.line);
    const col = at.column ?? 1;
    ed.setSelection({ startLineNumber: at.line, startColumn: col, endLineNumber: at.line, endColumn: col + (at.length ?? 0) });
    ed.focus();
  }, 30);
}

function flash(el: HTMLElement | null) {
  if (!el) return;
  el.classList.remove("qv-flash");
  void el.offsetWidth;
  el.classList.add("qv-flash");
  setTimeout(() => el.classList.remove("qv-flash"), 1200);
}
