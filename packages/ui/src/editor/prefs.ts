// App-wide preferences: colour theme, editor font, size, ligatures, format on
// save. Kept deliberately few; they live in this window's storage and apply live
// to the whole window and every Monaco editor (files, console, diffs and
// visual-mode chunks).

import { create } from "zustand";
import { defineThemes, monaco } from "./monaco";

export type ThemeChoice = "dark" | "light" | "system";

export interface EditorPrefs {
  theme: ThemeChoice;
  font: string;
  fontSize: number;
  ligatures: boolean;
  formatOnSave: boolean;
}

/** Fira Code ships with the app; the others are used when installed. */
export const EDITOR_FONTS = ["Fira Code", "JetBrains Mono", "SF Mono", "Menlo", "D2Coding"];

const DEFAULTS: EditorPrefs = { theme: "dark", font: "Fira Code", fontSize: 13, ligatures: true, formatOnSave: true };
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

const systemDark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined;

/** The theme actually shown: "system" follows macOS. */
export function resolvedTheme(choice = useEditorPrefs.getState().theme): "dark" | "light" {
  if (choice === "system") return systemDark?.matches === false ? "light" : "dark";
  return choice;
}

/** Monaco's theme is window-wide; editors are created with the current one. */
export function monacoTheme() {
  return `rsage-${resolvedTheme()}`;
}

function applyTheme(p: EditorPrefs) {
  const t = resolvedTheme(p.theme);
  document.documentElement.dataset.theme = t;
  defineThemes();
  monaco.editor.setTheme(`rsage-${t}`);
  window.dispatchEvent(new CustomEvent("rsage-theme", { detail: t }));
}
systemDark?.addEventListener("change", () => applyTheme(useEditorPrefs.getState()));

function apply(p: EditorPrefs) {
  applyTheme(p);
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
