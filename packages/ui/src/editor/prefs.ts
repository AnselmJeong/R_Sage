// App-wide editor preferences: font, size, ligatures, format on save. Kept
// deliberately few; they live in this window's storage and apply live to every
// Monaco editor (files, console, diffs and visual-mode chunks).

import { create } from "zustand";
import { monaco } from "./monaco";

export interface EditorPrefs {
  font: string;
  fontSize: number;
  ligatures: boolean;
  formatOnSave: boolean;
}

/** Fira Code ships with the app; the others are used when installed. */
export const EDITOR_FONTS = ["Fira Code", "JetBrains Mono", "SF Mono", "Menlo", "D2Coding"];

const DEFAULTS: EditorPrefs = { font: "Fira Code", fontSize: 13, ligatures: true, formatOnSave: true };
const KEY = "rsage.editorPrefs";

function load(): EditorPrefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

export const useEditorPrefs = create<EditorPrefs>(load);

/** The font stack: the chosen font, then fallbacks that cover Hangul. */
export function fontStack(font = useEditorPrefs.getState().font) {
  return [font, "D2Coding", "SF Mono", "Menlo", "monospace"]
    .filter((f, i, a) => a.indexOf(f) === i)
    .map((f) => (f === "monospace" ? f : `"${f}"`))
    .join(", ");
}

/** Options every Monaco editor is created with. */
export function editorFontOptions(): monaco.editor.IEditorOptions {
  const p = useEditorPrefs.getState();
  return { fontFamily: fontStack(p.font), fontSize: p.fontSize, fontLigatures: p.ligatures };
}

function apply(p: EditorPrefs) {
  // Code shown outside Monaco (outputs, inline code) follows the same font.
  document.documentElement.style.setProperty("--mono", fontStack(p.font));
  for (const e of monaco.editor.getEditors()) e.updateOptions(editorFontOptions());
  // Monaco measures glyph widths once; measure again when the web font arrives.
  void document.fonts?.load(`${p.fontSize}px "${p.font}"`).then(() => monaco.editor.remeasureFonts(), () => {});
}

useEditorPrefs.subscribe((p) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
  apply(p);
});
apply(useEditorPrefs.getState());
