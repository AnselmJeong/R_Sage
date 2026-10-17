// Monaco setup: workers, theme, R language extras and LSP-backed providers.

import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import { host } from "../host/client";
import { useStore } from "../store";

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

async function lsp<T>(method: string, params: unknown): Promise<T | null> {
  if (!lspReady()) return null;
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

export function registerRLanguage() {
  if (registered) return;
  registered = true;

  monaco.editor.defineTheme("rsage-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: { "editor.background": "#1b1d21", "editorGutter.background": "#1b1d21" },
  });
  monaco.editor.defineTheme("rsage-light", { base: "vs", inherit: true, rules: [], colors: {} });

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

  monaco.languages.registerCompletionItemProvider("r", {
    triggerCharacters: ["$", "@", ":", "(", ",", '"', "/"],
    async provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const snippets: monaco.languages.CompletionItem[] = SNIPPETS.map((s) => ({
        label: s.label,
        kind: monaco.languages.CompletionItemKind.Snippet,
        insertText: s.insert,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        documentation: s.doc,
        range,
        sortText: "zz" + s.label,
      }));
      const res = await lsp<any>("textDocument/completion", {
        textDocument: { uri: model.uri.toString() },
        position: toPos(position),
      });
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
          range: edit?.range ? toRange(edit.range) : edit?.insert ? toRange(edit.insert) : range,
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

  monaco.languages.registerHoverProvider("r", {
    async provideHover(model, position) {
      const r = await lsp<any>("textDocument/hover", { textDocument: { uri: model.uri.toString() }, position: toPos(position) });
      if (!r?.contents) return null;
      const contents = Array.isArray(r.contents) ? r.contents.map(markdown) : [markdown(r.contents)];
      return { contents: contents.filter(Boolean) as monaco.IMarkdownString[], range: r.range ? toRange(r.range) : undefined };
    },
  });

  monaco.languages.registerSignatureHelpProvider("r", {
    signatureHelpTriggerCharacters: ["(", ","],
    signatureHelpRetriggerCharacters: [","],
    async provideSignatureHelp(model, position) {
      const r = await lsp<any>("textDocument/signatureHelp", {
        textDocument: { uri: model.uri.toString() },
        position: toPos(position),
      });
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
