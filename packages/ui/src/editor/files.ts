// Open documents: Monaco models, save/reload, conflict handling, backups,
// and sending code from an editor to the R console.

import type { DockviewApi } from "dockview";
import { host } from "../host/client";
import { useStore } from "../store";
import { confirmDialog } from "../components/Dialogs";
import { useEditorPrefs } from "./prefs";
import {
  languageFor,
  lspDidChange,
  lspDidClose,
  lspDidOpen,
  lspDidSave,
  monaco,
  regexSymbols,
  statementRange,
  uriFor,
} from "./monaco";

let dock: DockviewApi | undefined;
export const setDockApi = (api: DockviewApi) => (dock = api);
export const getDockApi = () => dock;

const backupTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Last content written to / read from disk, to compute dirty state. */
const savedVersion = new Map<string, number>();
/** Monaco editor currently focused per file, set by EditorPanel. */
export const editorsByPath = new Map<string, monaco.editor.IStandaloneCodeEditor>();
let lastEditorPath: string | undefined;

export function basename(p: string) {
  return p.split("/").pop() ?? p;
}

export function getModel(path: string) {
  return monaco.editor.getModel(uriFor(path));
}

function markDirty(path: string) {
  const model = getModel(path);
  if (!model) return;
  const dirty = model.getAlternativeVersionId() !== savedVersion.get(path);
  const f = useStore.getState().openFiles[path];
  if (!f || f.dirty !== dirty) useStore.getState().setFile(path, { dirty });
  updateTitle(path);
}

function updateTitle(path: string) {
  const panel = dock?.getPanel(`editor:${path}`);
  const f = useStore.getState().openFiles[path];
  panel?.api.setTitle(`${f?.dirty ? "● " : ""}${basename(path)}`);
}

async function ensureModel(path: string): Promise<monaco.editor.ITextModel> {
  const existing = getModel(path);
  if (existing) return existing;
  const { content, mtimeMs } = await host.call("fs.read", { path });
  const model = monaco.editor.createModel(content, languageFor(path), uriFor(path));
  savedVersion.set(path, model.getAlternativeVersionId());
  useStore.getState().setFile(path, { path, dirty: false, mtimeMs });
  model.onDidChangeContent(() => {
    markDirty(path);
    lspDidChange(model);
    scheduleBackup(path);
  });
  lspDidOpen(model);
  // Offer crash recovery if a backup survived.
  const backup = await host.call("backup.read", { path });
  if (backup !== null && backup !== content) useStore.getState().setFile(path, { hasBackup: true });
  return model;
}

function scheduleBackup(path: string) {
  clearTimeout(backupTimers.get(path));
  backupTimers.set(
    path,
    setTimeout(() => {
      const model = getModel(path);
      const f = useStore.getState().openFiles[path];
      if (model && f?.dirty) void host.call("backup.write", { path, content: model.getValue() });
    }, 1500),
  );
}

export async function openFile(path: string, at?: { line: number; column?: number }) {
  // HTML and PDF files are shown rendered; the preview's "소스 보기" opens the HTML text.
  if (!at && /\.(html?|pdf)$/i.test(path)) {
    const { previewFile } = await import("../quarto/render");
    return previewFile(path);
  }
  return openInEditor(path, at);
}

/** Opens the file as text in an editor tab. */
export async function openInEditor(path: string, at?: { line: number; column?: number }) {
  if (!dock) return;
  try {
    await ensureModel(path);
  } catch (err) {
    useStore.getState().notify(`파일을 열 수 없습니다: ${(err as Error).message}`, "error");
    return;
  }
  const id = `editor:${path}`;
  let panel = dock.getPanel(id);
  if (!panel) {
    const active = dock.activePanel?.id.startsWith("editor:") ? dock.activePanel : undefined;
    const ref = active ?? dock.panels.find((p) => p.id.startsWith("editor:")) ?? dock.getPanel("welcome-editor");
    const consolePanel = dock.getPanel("console");
    panel = dock.addPanel({
      id,
      component: "editor",
      tabComponent: "editorTab",
      title: basename(path),
      params: { path },
      position: ref
        ? { referencePanel: ref.id, direction: "within" }
        : consolePanel
          ? { referencePanel: consolePanel.id, direction: "above" }
          : undefined,
    });
    dock.getPanel("welcome-editor")?.api.close();
  }
  panel.api.setActive();
  useStore.setState({ activeFile: path });
  if (at) {
    setTimeout(() => {
      const ed = editorsByPath.get(path);
      if (!ed) return;
      ed.revealLineInCenter(at.line);
      ed.setPosition({ lineNumber: at.line, column: at.column ?? 1 });
      ed.focus();
    }, 30);
  }
  persistWorkspaceSoon();
}

export async function saveFile(path: string, force = false): Promise<boolean> {
  const model = getModel(path);
  const f = useStore.getState().openFiles[path];
  if (!model || !f) return false;
  if (!force && useEditorPrefs.getState().formatOnSave && /\.(r|qmd|rmd)$/i.test(path)) await formatModel(path, model);
  const res = await host.call("fs.write", { path, content: model.getValue(), expectedMtimeMs: f.mtimeMs, force });
  if (!res.ok) {
    const overwrite = await confirmDialog({
      title: "디스크의 파일이 바뀌었습니다",
      message: `${basename(path)} 파일이 앱 밖에서 수정되었습니다. 내 변경으로 덮어쓸까요?`,
      confirm: "덮어쓰기",
      cancel: "취소",
      danger: true,
    });
    if (!overwrite) return false;
    return saveFile(path, true);
  }
  savedVersion.set(path, model.getAlternativeVersionId());
  useStore.getState().setFile(path, { dirty: false, mtimeMs: res.mtimeMs, externalChange: false, hasBackup: false });
  updateTitle(path);
  lspDidSave(model);
  return true;
}

/** Formats R code with Air before saving, as one undoable edit that touches only the changed lines. */
async function formatModel(path: string, model: monaco.editor.ITextModel) {
  const before = model.getValue();
  let r: { text: string; failed: number; error?: string };
  try {
    r = await host.call("format.document", { path, text: before });
  } catch (e) {
    useStore.getState().notify(`코드 정리를 건너뛰고 저장합니다: ${(e as Error).message}`, "error");
    return;
  }
  if (r.error && !r.failed) {
    useStore.getState().notify(`코드 정리를 건너뛰고 저장합니다: ${r.error}`, "error");
    return;
  }
  if (r.failed && !/\.(qmd|rmd)$/i.test(path)) return; // a syntax error: save as typed
  if (r.failed) useStore.getState().notify(`R 청크 ${r.failed}개는 문법 오류가 있어 정리하지 않았습니다.`);
  if (r.text === before || model.getValue() !== before) return;
  const next = r.text;
  let top = 0;
  while (top < before.length && top < next.length && before[top] === next[top]) top++;
  let end = 0;
  while (end < before.length - top && end < next.length - top && before[before.length - 1 - end] === next[next.length - 1 - end]) end++;
  const from = model.getPositionAt(top);
  const to = model.getPositionAt(before.length - end);
  const range = new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column);
  model.pushEditOperations([], [{ range, text: next.slice(top, next.length - end) }], () => null);
}

export async function saveAll() {
  for (const f of Object.values(useStore.getState().openFiles)) if (f.dirty) await saveFile(f.path);
}

export async function reloadFromDisk(path: string) {
  const model = getModel(path);
  if (!model) return;
  const { content, mtimeMs } = await host.call("fs.read", { path });
  const ed = editorsByPath.get(path);
  const pos = ed?.getPosition();
  if (content !== model.getValue()) {
    // pushEditOperations keeps undo history, unlike setValue.
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null);
  }
  savedVersion.set(path, model.getAlternativeVersionId());
  useStore.getState().setFile(path, { dirty: false, mtimeMs, externalChange: false });
  updateTitle(path);
  if (pos) ed?.setPosition(pos);
}

export async function restoreBackup(path: string) {
  const model = getModel(path);
  const content = await host.call("backup.read", { path });
  if (!model || content === null) return;
  model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null);
  useStore.getState().setFile(path, { hasBackup: false });
}

export async function discardBackup(path: string) {
  await host.call("backup.discard", { path });
  useStore.getState().setFile(path, { hasBackup: false });
}

export async function closeFile(path: string): Promise<boolean> {
  const f = useStore.getState().openFiles[path];
  if (f?.dirty) {
    const choice = await confirmDialog({
      title: "저장하지 않은 변경",
      message: `${basename(path)}의 변경 내용을 저장할까요?`,
      confirm: "저장",
      cancel: "저장 안 함",
      allowDismiss: true,
    });
    if (choice === null) return false;
    if (choice) {
      if (!(await saveFile(path))) return false;
    } else {
      await host.call("backup.discard", { path });
    }
  }
  disposeFile(path);
  return true;
}

/** Drop the model without prompting (panel already closing). */
export function disposeFile(path: string) {
  const model = getModel(path);
  if (model) {
    lspDidClose(model);
    model.dispose();
  }
  editorsByPath.delete(path);
  savedVersion.delete(path);
  useStore.getState().setFile(path, null);
  if (useStore.getState().activeFile === path) useStore.setState({ activeFile: undefined });
  dock?.getPanel(`editor:${path}`)?.api.close();
  persistWorkspaceSoon();
}

/** Called for fs.changed events from the host's watcher. */
export async function onExternalChange(paths: string[]) {
  for (const p of paths) {
    const f = useStore.getState().openFiles[p];
    if (!f) continue;
    try {
      const { mtimeMs } = await host.call("fs.read", { path: p });
      if (Math.abs(mtimeMs - f.mtimeMs) < 1) continue;
    } catch {
      continue; // deleted or unreadable; keep the buffer
    }
    if (f.dirty) useStore.getState().setFile(p, { externalChange: true });
    else await reloadFromDisk(p);
  }
}

export function setActiveEditor(path: string) {
  // A background tab (e.g. a delayed focus while tabs are restored) must not take over.
  const shown = dock?.activePanel?.id;
  if (shown?.startsWith("editor:") && shown !== `editor:${path}`) return;
  lastEditorPath = path;
  if (useStore.getState().activeFile !== path) useStore.setState({ activeFile: path });
}

export function activeEditor(): { path: string; editor: monaco.editor.IStandaloneCodeEditor } | undefined {
  const path = useStore.getState().activeFile ?? lastEditorPath;
  const editor = path ? editorsByPath.get(path) : undefined;
  return path && editor ? { path, editor } : undefined;
}

// ---------- running code ----------

export async function runCode(code: string, source?: { file: string; line: number; endLine?: number }) {
  const s = useStore.getState().session;
  if (s.state === "stopped" || s.state === "exited") {
    await host.call("session.start", {});
  }
  await host.call("console.execute", { code, origin: source ? "editor" : "console", source });
}

/** Cmd+Enter: run the selection, or the statement under the cursor and advance. */
export async function runCurrentStatement(editor: monaco.editor.IStandaloneCodeEditor, path: string) {
  const model = editor.getModel();
  const sel = editor.getSelection();
  if (!model || !sel) return;
  if (!sel.isEmpty()) {
    await runCode(model.getValueInRange(sel), { file: path, line: sel.startLineNumber, endLine: sel.endLineNumber });
    return;
  }
  const pos = editor.getPosition()!;
  let range: monaco.Range;
  let code: string;
  const r = await statementRange(model, pos);
  if (r?.kind === "ok") {
    range = r.range;
    code = r.code ?? model.getValueInRange(r.range);
  } else if (r?.kind === "rejected") {
    useStore.getState().notify(`문법 오류로 실행할 문장을 정하지 못했습니다${r.line !== undefined ? ` (${r.line + 1}행)` : ""}.`, "error");
    return;
  } else {
    // No LSP yet: fall back to the current line.
    range = new monaco.Range(pos.lineNumber, 1, pos.lineNumber, model.getLineMaxColumn(pos.lineNumber));
    code = model.getLineContent(pos.lineNumber);
  }
  if (!code.trim()) {
    moveToNextCode(editor, pos.lineNumber + 1);
    return;
  }
  await runCode(code, { file: path, line: range.startLineNumber, endLine: range.endLineNumber });
  moveToNextCode(editor, range.endLineNumber + 1);
}

function moveToNextCode(editor: monaco.editor.IStandaloneCodeEditor, fromLine: number) {
  const model = editor.getModel()!;
  let line = Math.min(fromLine, model.getLineCount());
  while (line < model.getLineCount() && /^\s*(#.*)?$/.test(model.getLineContent(line))) line++;
  editor.setPosition({ lineNumber: line, column: 1 });
  editor.revealLine(line);
}

/** Run the whole function enclosing the cursor. */
export async function runEnclosingFunction(editor: monaco.editor.IStandaloneCodeEditor, path: string) {
  const model = editor.getModel();
  const pos = editor.getPosition();
  if (!model || !pos) return;
  const symbols = regexSymbols(model);
  // Find the function whose definition starts at or above the cursor and whose
  // braces enclose it.
  for (const s of symbols.reverse()) {
    if (s.range.startLineNumber > pos.lineNumber) continue;
    editor.setPosition({ lineNumber: s.range.startLineNumber, column: 1 });
    const r = await statementRange(model, { lineNumber: s.range.startLineNumber, column: 1 });
    editor.setPosition(pos);
    if (r?.kind === "ok" && r.range.endLineNumber >= pos.lineNumber) {
      await runCode(model.getValueInRange(r.range), { file: path, line: r.range.startLineNumber, endLine: r.range.endLineNumber });
      return;
    }
  }
  useStore.getState().notify("커서를 감싸는 함수를 찾지 못했습니다.", "error");
}

/** Cmd+Shift+S: save then source() the file. */
export async function sourceFile(path: string) {
  if (useStore.getState().openFiles[path]?.dirty) await saveFile(path);
  await runCode(`source(${JSON.stringify(path)}, echo = TRUE, max.deparse.length = Inf)`, { file: path, line: 1 });
}

// ---------- workspace persistence ----------

let persistTimer: ReturnType<typeof setTimeout> | undefined;
export function persistWorkspaceSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    if (!useStore.getState().project || !dock) return;
    const openFiles = dock.panels
      .filter((p) => p.id.startsWith("editor:"))
      .map((p) => {
        const path = p.id.slice("editor:".length);
        const pos = editorsByPath.get(path)?.getPosition();
        return { path, cursor: pos ? { line: pos.lineNumber, column: pos.column } : undefined };
      });
    let layout: unknown;
    try {
      layout = dock.toJSON();
    } catch {}
    void host.call("project.saveState", { state: { openFiles, activeFile: useStore.getState().activeFile, layout } });
  }, 500);
}
