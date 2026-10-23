// Monaco setup: workers, theme, R language extras and LSP-backed providers.

import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import { host } from "../host/client";
import { useStore } from "../store";
import { qmdRChunks } from "@rsage/shared";

(self as any).MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === "json") return new JsonWorker();
    return new EditorWorker();
  },
};

export { monaco };

export function languageFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "r":
    case "rprofile":
      return "r";
    case "qmd":
    case "rmd":
    case "md":
      return "markdown";
    case "json":
      return "json";
    case "yml":
    case "yaml":
      return "yaml";
    case "js":
      return "javascript";
    case "ts":
      return "typescript";
    case "css":
      return "css";
    case "html":
      return "html";
    case "py":
      return "python";
    case "sh":
      return "shell";
    case "sql":
      return "sql";
    case "tex":
      return "latex";
    default:
      return path.endsWith(".Rprofile") ? "r" : "plaintext";
  }
}

let localId = 0;
const localKeys = new WeakMap<monaco.editor.ICodeEditor, string>();

/**
 * editor.addCommand() registers its keybinding app-wide in standalone Monaco,
 * so the last editor to bind a key wins in every editor (the console's Enter
 * swallowed Enter everywhere). This keeps a command to its own editor.
 */
export function addLocalCommand(ed: monaco.editor.IStandaloneCodeEditor, keybinding: number, handler: () => void, when?: string) {
  let key = localKeys.get(ed);
  if (!key) {
    key = `rsageEditor${++localId}`;
    ed.createContextKey(key, true);
    localKeys.set(ed, key);
  }
  return ed.addCommand(keybinding, handler, when ? `${key} && ${when}` : key);
}

export function uriFor(path: string) {
  return monaco.Uri.file(path);
}

// ---------- LSP helpers ----------

type LspPos = { line: number; character: number };
type LspRange = { start: LspPos; end: LspPos };

const toRange = (r: LspRange) =>
  new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1);
const toPos = (p: monaco.IPosition): LspPos => ({ line: p.lineNumber - 1, character: p.column - 1 });

function lspReady() {
  return useStore.getState().lspRunning;
}

let autoStarted = false;
async function lsp<T>(method: string, params: unknown): Promise<T | null> {
  if (!lspReady()) {
    // Completion and help come from the live R session (Ark), like Positron: start it once on first need.
    const st = useStore.getState().session.state;
    if (!autoStarted && (st === "stopped" || st === "exited")) {
      autoStarted = true;
      void host.call("session.start", {}).catch(() => {});
    }
    return null;
  }
  try {
    return (await host.call("lsp.request", { method, params })) as T;
  } catch {
    return null;
  }
}

function markdown(v: any): monaco.IMarkdownString | undefined {
  if (!v) return undefined;
  if (typeof v === "string") return { value: v };
  return { value: v.value ?? "" };
}

const kindMap: Record<number, monaco.languages.CompletionItemKind> = {
  1: monaco.languages.CompletionItemKind.Text,
  2: monaco.languages.CompletionItemKind.Method,
  3: monaco.languages.CompletionItemKind.Function,
  4: monaco.languages.CompletionItemKind.Constructor,
  5: monaco.languages.CompletionItemKind.Field,
  6: monaco.languages.CompletionItemKind.Variable,
  7: monaco.languages.CompletionItemKind.Class,
  9: monaco.languages.CompletionItemKind.Module,
  10: monaco.languages.CompletionItemKind.Property,
  12: monaco.languages.CompletionItemKind.Value,
  14: monaco.languages.CompletionItemKind.Keyword,
  15: monaco.languages.CompletionItemKind.Snippet,
  17: monaco.languages.CompletionItemKind.File,
  18: monaco.languages.CompletionItemKind.Reference,
  19: monaco.languages.CompletionItemKind.Folder,
  21: monaco.languages.CompletionItemKind.Constant,
};

const symbolKind = (k: number) => (k - 1) as monaco.languages.SymbolKind;

const SNIPPETS: { label: string; insert: string; doc: string }[] = [
  { label: "fun", insert: "${1:name} <- function(${2:args}) {\n\t$0\n}", doc: "함수 정의" },
  { label: "if", insert: "if (${1:condition}) {\n\t$0\n}", doc: "if 문" },
  { label: "ife", insert: "if (${1:condition}) {\n\t$2\n} else {\n\t$0\n}", doc: "if-else 문" },
  { label: "for", insert: "for (${1:i} in ${2:seq_along(x)}) {\n\t$0\n}", doc: "for 반복문" },
  { label: "while", insert: "while (${1:condition}) {\n\t$0\n}", doc: "while 반복문" },
  { label: "lib", insert: "library(${1:package})", doc: "library()" },
  { label: "pipe", insert: "${1:data} |>\n\t${0}", doc: "파이프" },
  { label: "ggplot", insert: "ggplot(${1:data}, aes(${2:x}, ${3:y})) +\n\tgeom_${4:point}()", doc: "ggplot 골격" },
  { label: "tryc", insert: "tryCatch({\n\t$1\n}, error = function(e) {\n\t$0\n})", doc: "tryCatch" },
];

let registered = false;
let themesDefined = false;

/**
 * The editor themes. The editor background is transparent so each editor
 * shows the surface it sits on (a panel, or a chunk's inset canvas in visual
 * mode); the colours follow the app's tokens in styles.css. Syntax colours are
 * kept quiet: mauve keywords, sand strings, desaturated blue constants.
 */
export function defineThemes() {
  if (themesDefined) return;
  themesDefined = true;
  const clear = "#00000000";
  monaco.editor.defineTheme("rsage-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "e4e4e7" },
      { token: "comment", foreground: "6e6e78", fontStyle: "italic" },
      { token: "keyword", foreground: "c3a6e6" },
      { token: "string", foreground: "dcbc8f" },
      { token: "number", foreground: "e3a98a" },
      { token: "constant", foreground: "8fb3e0" },
      { token: "type", foreground: "8fb3e0" },
      { token: "delimiter", foreground: "a1a1aa" },
      { token: "operator", foreground: "a1a1aa" },
      { token: "keyword.md", foreground: "e4e4e7", fontStyle: "bold" },
      { token: "variable.md", foreground: "8fb3e0" },
      { token: "string.link.md", foreground: "8fb3e0" },
    ],
    colors: {
      "editor.background": clear,
      "editorGutter.background": clear,
      "editor.foreground": "#e4e4e7",
      "editorLineNumber.foreground": "#4b4b52",
      "editorLineNumber.activeForeground": "#a1a1aa",
      "editor.lineHighlightBackground": "#ffffff08",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#8fb3e040",
      "editor.inactiveSelectionBackground": "#8fb3e024",
      "editorCursor.foreground": "#e4e4e7",
      "editorIndentGuide.background1": "#ffffff0d",
      "editorIndentGuide.activeBackground1": "#ffffff24",
      "editorWhitespace.foreground": "#ffffff1f",
      "editorBracketHighlight.foreground1": "#b9b9c2",
      "editorBracketHighlight.foreground2": "#c3a6e6",
      "editorBracketHighlight.foreground3": "#8fb3e0",
      "editorBracketMatch.background": "#ffffff14",
      "editorBracketMatch.border": "#ffffff30",
      "editorWidget.background": "#1d1d1f",
      "editorWidget.border": "#ffffff1a",
      "editorSuggestWidget.background": "#1d1d1f",
      "editorSuggestWidget.border": "#ffffff1a",
      "editorSuggestWidget.selectedBackground": "#ffffff12",
      "editorHoverWidget.background": "#1d1d1f",
      "editorHoverWidget.border": "#ffffff1a",
      "editorStickyScroll.background": "#181819",
      "scrollbarSlider.background": "#ffffff14",
      "scrollbarSlider.hoverBackground": "#ffffff24",
      "scrollbarSlider.activeBackground": "#ffffff30",
      "scrollbar.shadow": "#00000000",
      "focusBorder": "#00000000",
    },
  });
  monaco.editor.defineTheme("rsage-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: "27272a" },
      { token: "comment", foreground: "8e8e96", fontStyle: "italic" },
      { token: "keyword", foreground: "7a4fb0" },
      { token: "string", foreground: "9a6a2c" },
      { token: "number", foreground: "b4563a" },
      { token: "constant", foreground: "3d6aa8" },
      { token: "type", foreground: "3d6aa8" },
      { token: "delimiter", foreground: "71717a" },
      { token: "operator", foreground: "71717a" },
      { token: "keyword.md", foreground: "18181b", fontStyle: "bold" },
      { token: "variable.md", foreground: "3d6aa8" },
      { token: "string.link.md", foreground: "3d6aa8" },
    ],
    colors: {
      "editor.background": clear,
      "editorGutter.background": clear,
      "editor.foreground": "#27272a",
      "editorLineNumber.foreground": "#c4c4ca",
      "editorLineNumber.activeForeground": "#71717a",
      "editor.lineHighlightBackground": "#0000000a",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#3d6aa833",
      "editor.inactiveSelectionBackground": "#3d6aa81f",
      "editorCursor.foreground": "#18181b",
      "editorIndentGuide.background1": "#0000000f",
      "editorIndentGuide.activeBackground1": "#00000026",
      "editorWhitespace.foreground": "#00000026",
      "editorBracketHighlight.foreground1": "#52525b",
      "editorBracketHighlight.foreground2": "#7a4fb0",
      "editorBracketHighlight.foreground3": "#3d6aa8",
      "editorBracketMatch.background": "#0000000f",
      "editorBracketMatch.border": "#00000033",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#0000001a",
      "editorSuggestWidget.background": "#ffffff",
      "editorSuggestWidget.border": "#0000001a",
      "editorSuggestWidget.selectedBackground": "#0000000d",
      "editorHoverWidget.background": "#ffffff",
      "editorHoverWidget.border": "#0000001a",
      "editorStickyScroll.background": "#ffffff",
      "scrollbarSlider.background": "#0000001a",
      "scrollbarSlider.hoverBackground": "#0000002b",
      "scrollbarSlider.activeBackground": "#00000038",
      "scrollbar.shadow": "#00000000",
      "focusBorder": "#00000000",
    },
  });
}

export function registerRLanguage() {
  if (registered) return;
  registered = true;

  defineThemes();

  monaco.languages.setLanguageConfiguration("r", {
    comments: { lineComment: "#" },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"', notIn: ["string"] },
      { open: "'", close: "'", notIn: ["string"] },
      { open: "`", close: "`", notIn: ["string"] },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    indentationRules: {
      increaseIndentPattern: /^.*(\{[^}]*|\([^)]*|\[[^\]]*)$/,
      decreaseIndentPattern: /^\s*[}\])]/,
    },
    onEnterRules: [{ beforeText: /^\s*#'.*$/, action: { indentAction: monaco.languages.IndentAction.None, appendText: "#' " } }],
    folding: { markers: { start: /^\s*#\s*region\b|^.*----\s*$/, end: /^\s*#\s*endregion\b/ } },
  });

  // R files, R chunks in .qmd source mode (markdown models) and visual-mode chunk editors all go
  // through lspTarget(), which maps chunk positions into a virtual R document Ark can read.
  for (const lang of ["r", "markdown"]) {
    monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: ["$", "@", ":", "(", ",", '"', "/"],
      async provideCompletionItems(model, position) {
        const t = lspTarget(model, position);
        if (!t) return { suggestions: [] };
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        // Snippets only while typing a word, and never after x$, x@ or pkg:: (only members belong there).
        const before = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
        const snippets: monaco.languages.CompletionItem[] = !word.word || /[$@:]$/.test(before) ? [] : SNIPPETS.map((s) => ({
          label: s.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: s.insert,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: s.doc,
          range,
          sortText: "zz" + s.label,
        }));
        const res = await lsp<any>("textDocument/completion", { textDocument: { uri: t.uri }, position: t.pos });
        const items: any[] = Array.isArray(res) ? res : res?.items ?? [];
        const suggestions = items.map((it): monaco.languages.CompletionItem => {
          const edit = it.textEdit;
          return {
            label: it.label,
            kind: kindMap[it.kind] ?? monaco.languages.CompletionItemKind.Text,
            detail: it.detail,
            documentation: markdown(it.documentation),
            insertText: edit?.newText ?? it.insertText ?? it.label,
            insertTextRules:
              it.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
            range: edit?.range ? t.toModel(edit.range) : edit?.insert ? t.toModel(edit.insert) : range,
            sortText: it.sortText,
            filterText: it.filterText,
            command: it.command?.command === "editor.action.triggerParameterHints"
              ? { id: "editor.action.triggerParameterHints", title: "" }
              : undefined,
            // Kept for resolve
            ...({ _lsp: it } as object),
          };
        });
        return { suggestions: [...suggestions, ...snippets], incomplete: res?.isIncomplete };
      },
      async resolveCompletionItem(item) {
        const raw = (item as any)._lsp;
        if (!raw || item.documentation) return item;
        const r = await lsp<any>("completionItem/resolve", raw);
        if (r) {
          item.documentation = markdown(r.documentation);
          item.detail = r.detail ?? item.detail;
        }
        return item;
      },
    });

    monaco.languages.registerHoverProvider(lang, {
      async provideHover(model, position) {
        const t = lspTarget(model, position);
        if (!t) return null;
        const r = await lsp<any>("textDocument/hover", { textDocument: { uri: t.uri }, position: t.pos });
        if (!r?.contents) return null;
        const contents = Array.isArray(r.contents) ? r.contents.map(markdown) : [markdown(r.contents)];
        return { contents: contents.filter(Boolean) as monaco.IMarkdownString[], range: r.range ? t.toModel(r.range) : undefined };
      },
    });

    monaco.languages.registerSignatureHelpProvider(lang, {
      signatureHelpTriggerCharacters: ["(", ","],
      signatureHelpRetriggerCharacters: [","],
      async provideSignatureHelp(model, position) {
        const t = lspTarget(model, position);
        if (!t) return null;
        const r = await lsp<any>("textDocument/signatureHelp", { textDocument: { uri: t.uri }, position: t.pos });
        if (!r?.signatures?.length) return null;
        return {
          value: {
            activeSignature: r.activeSignature ?? 0,
            activeParameter: r.activeParameter ?? 0,
            signatures: r.signatures.map((s: any) => ({
              label: s.label,
              documentation: markdown(s.documentation),
              parameters: (s.parameters ?? []).map((p: any) => ({ label: p.label, documentation: markdown(p.documentation) })),
            })),
          },
          dispose() {},
        };
      },
    });
  }

  monaco.languages.registerDefinitionProvider("r", {
    async provideDefinition(model, position) {
      const r = await lsp<any>("textDocument/definition", { textDocument: { uri: model.uri.toString() }, position: toPos(position) });
      if (!r) return null;
      const list = Array.isArray(r) ? r : [r];
      return list.map((loc: any) => ({
        uri: monaco.Uri.parse(loc.uri ?? loc.targetUri),
        range: toRange(loc.range ?? loc.targetSelectionRange ?? loc.targetRange),
      }));
    },
  });

  monaco.languages.registerDocumentSymbolProvider("r", {
    async provideDocumentSymbols(model) {
      const r = await lsp<any[]>("textDocument/documentSymbol", { textDocument: { uri: model.uri.toString() } });
      if (r) return r.map(convertSymbol);
      return regexSymbols(model);
    },
  });
}

function convertSymbol(s: any): monaco.languages.DocumentSymbol {
  const range = toRange(s.range ?? s.location?.range);
  return {
    name: s.name,
    detail: s.detail ?? "",
    kind: symbolKind(s.kind),
    tags: [],
    range,
    selectionRange: s.selectionRange ? toRange(s.selectionRange) : range,
    children: (s.children ?? []).map(convertSymbol),
  };
}

/** Function list without the LSP (session not running). */
export function regexSymbols(model: monaco.editor.ITextModel): monaco.languages.DocumentSymbol[] {
  const out: monaco.languages.DocumentSymbol[] = [];
  const re = /^\s*([A-Za-z.][\w.]*|`[^`]+`)\s*(<-|=)\s*function\b/;
  for (let i = 1; i <= model.getLineCount(); i++) {
    const m = model.getLineContent(i).match(re);
    if (!m) continue;
    const range = new monaco.Range(i, 1, i, model.getLineMaxColumn(i));
    out.push({ name: m[1]!, detail: "", kind: monaco.languages.SymbolKind.Function, tags: [], range, selectionRange: range });
  }
  return out;
}

// ---------- R chunks in Quarto documents ----------
//
// Like Positron/Quarto, Ark never sees the .qmd itself: the R chunks are
// joined into a virtual R document next to it, and positions are mapped
// between the chunk and that document.

export interface LspTarget {
  uri: string;
  pos: LspPos;
  /** Maps a range in the LSP document back to the editor's model. */
  toModel: (r: LspRange) => monaco.Range;
}

type CellContext = () => { path: string; cells: string[]; index: number } | null;
const cellModels = new Map<string, CellContext>();

/** Visual-mode chunk editors register their model so completions see the whole document's R code. */
export function registerRCellModel(model: monaco.editor.ITextModel, ctx: CellContext) {
  const uri = model.uri.toString();
  cellModels.set(uri, ctx);
  return () => void cellModels.delete(uri);
}

const virtualText = new Map<string, string>();

function syncVirtual(uri: string, text: string) {
  if (!lspReady() || virtualText.get(uri) === text) return;
  virtualText.set(uri, text);
  const v = (versions.get(uri) ?? 0) + 1;
  versions.set(uri, v);
  void host.call(
    "lsp.notify",
    v === 1
      ? { method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "r", version: 1, text } } }
      : { method: "textDocument/didChange", params: { textDocument: { uri, version: v }, contentChanges: [{ text }] } },
  );
}

/** Where to send an LSP request for this position, or null when it is not R code. */
export function lspTarget(model: monaco.editor.ITextModel, position: monaco.IPosition): LspTarget | null {
  const pos = toPos(position);
  const cell = cellModels.get(model.uri.toString())?.();
  let path: string;
  let cells: string[];
  let index: number;
  let base = 0; // model line of the chunk's first code line
  if (cell) {
    ({ path, cells, index } = cell);
    cells = [...cells];
    cells[index] = model.getValue();
  } else if (model.getLanguageId() === "markdown" && /\.(qmd|rmd)$/i.test(model.uri.path)) {
    const chunks = qmdRChunks(model.getValue());
    index = chunks.findIndex((c) => pos.line >= c.start && pos.line < c.start + c.code.split("\n").length);
    if (index < 0) return null;
    path = model.uri.path;
    cells = chunks.map((c) => c.code);
    base = chunks[index]!.start;
  } else if (model.getLanguageId() === "r") {
    return { uri: model.uri.toString(), pos, toModel: toRange };
  } else return null;
  let offset = 0;
  for (let i = 0; i < index; i++) offset += cells[i]!.split("\n").length;
  const uri = monaco.Uri.file(`${path}.rsage-chunks.R`).toString();
  syncVirtual(uri, cells.join("\n"));
  const back = (p: LspPos) => ({ line: p.line - offset + base, character: p.character });
  return {
    uri,
    pos: { line: pos.line - base + offset, character: pos.character },
    toModel: (r) => toRange({ start: back(r.start), end: back(r.end) }),
  };
}

// ---------- LSP document sync & diagnostics ----------

const versions = new Map<string, number>();

export function lspDidOpen(model: monaco.editor.ITextModel) {
  if (model.getLanguageId() !== "r" || !lspReady()) return;
  versions.set(model.uri.toString(), 1);
  void host.call("lsp.notify", {
    method: "textDocument/didOpen",
    params: { textDocument: { uri: model.uri.toString(), languageId: "r", version: 1, text: model.getValue() } },
  });
}

export function lspDidChange(model: monaco.editor.ITextModel) {
  if (model.getLanguageId() !== "r" || !lspReady()) return;
  const uri = model.uri.toString();
  if (!versions.has(uri)) return lspDidOpen(model);
  const v = (versions.get(uri) ?? 1) + 1;
  versions.set(uri, v);
  void host.call("lsp.notify", {
    method: "textDocument/didChange",
    params: { textDocument: { uri, version: v }, contentChanges: [{ text: model.getValue() }] },
  });
}

export function lspDidSave(model: monaco.editor.ITextModel) {
  if (model.getLanguageId() !== "r" || !lspReady()) return;
  void host.call("lsp.notify", { method: "textDocument/didSave", params: { textDocument: { uri: model.uri.toString() } } });
}

export function lspDidClose(model: monaco.editor.ITextModel) {
  const uri = model.uri.toString();
  if (!versions.delete(uri) || !lspReady()) return;
  void host.call("lsp.notify", { method: "textDocument/didClose", params: { textDocument: { uri } } });
}

export function lspVersion(model: monaco.editor.ITextModel) {
  return versions.get(model.uri.toString()) ?? 1;
}

/** After the LSP (re)starts, every open R model must be announced again. */
export function lspReopenAll() {
  versions.clear();
  for (const m of monaco.editor.getModels()) if (m.uri.scheme === "file") lspDidOpen(m);
}

export function initLspEvents() {
  host.on("lsp.notification", ({ method, params }) => {
    if (method !== "textDocument/publishDiagnostics") return;
    const model = monaco.editor.getModel(monaco.Uri.parse(params.uri));
    if (!model) return;
    const sev = (s: number) =>
      s === 1
        ? monaco.MarkerSeverity.Error
        : s === 2
          ? monaco.MarkerSeverity.Warning
          : s === 3
            ? monaco.MarkerSeverity.Info
            : monaco.MarkerSeverity.Hint;
    monaco.editor.setModelMarkers(
      model,
      "ark",
      (params.diagnostics ?? []).map((d: any) => ({
        ...toRange(d.range),
        startLineNumber: d.range.start.line + 1,
        startColumn: d.range.start.character + 1,
        endLineNumber: d.range.end.line + 1,
        endColumn: d.range.end.character + 1,
        message: d.message,
        severity: sev(d.severity ?? 1),
        source: d.source,
      })),
    );
  });
  host.on("lsp.state", ({ running }) => {
    virtualText.clear();
    if (running) setTimeout(lspReopenAll, 0);
    else versions.clear();
  });
}

/** Ark's statement range at a position, or null without the LSP. */
export type StatementRange =
  | { kind: "ok"; range: monaco.Range; code: string | null }
  | { kind: "rejected"; line?: number };

export async function statementRange(model: monaco.editor.ITextModel, position: monaco.IPosition): Promise<StatementRange | null> {
  const r = await lsp<any>("positron/textDocument/statementRange", {
    textDocument: { uri: model.uri.toString(), version: lspVersion(model) },
    position: toPos(position),
  });
  if (!r) return null;
  if (r.kind === "success") return { kind: "ok", range: toRange(r.range), code: r.code ?? null };
  return { kind: "rejected", line: r.line ?? undefined };
}
