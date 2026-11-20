// Tiptap nodes for the .qmd visual editor: R chunks (with their own code
// editor, run button and results), YAML front matter, display math, inline
// math, raw blocks that keep unsupported Quarto syntax as source, and the
// round-trip attributes every top-level block carries (see qmd.ts).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Extension, Node, NodeViewWrapper, ReactNodeViewRenderer, mergeAttributes, type Editor, type NodeViewProps } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import katex from "katex";
import { create } from "zustand";
import { host } from "../host/client";
import { useStore } from "../store";
import { addLocalCommand, monaco, registerRCellModel } from "../editor/monaco";
import { formDialog } from "../components/Dialogs";
import { focusedCells } from "../editor/views";
import { editorFontOptions, monacoTheme } from "../editor/prefs";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { cellLabel, copyCell, mergeCellCode, readCellOptions, setCellOptions, splitCellCode, stripCellOptions } from "./chunkOps";
import { useAssistant } from "../assistant";
import { allCommands } from "../commands";

const TOP_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "table",
  "frontMatter",
  "rCell",
  "rawBlock",
  "mathBlock",
];

const plainAttr = (def: unknown = null) => ({ default: def, rendered: false, keepOnSplit: false });

/** src/ser0/before on every block, plus list tightness and table alignment. */
export const RoundTrip = Extension.create({
  name: "roundTrip",
  addGlobalAttributes() {
    return [
      { types: TOP_TYPES, attributes: { src: plainAttr(), ser0: plainAttr(), before: plainAttr() } },
      { types: ["bulletList", "orderedList"], attributes: { tight: { default: true, rendered: false } } },
      { types: ["table"], attributes: { align: { default: "[]", rendered: false } } },
    ];
  },
});

// ---------------------------------------------------------------- chunk results

export interface CellResult {
  running?: boolean;
  /** Waiting for earlier chunks of the same run. */
  queued?: boolean;
  text?: string;
  isError?: boolean;
  images?: { mime: string; data: string }[];
}

/** Results of chunks run in the visual editor, by `${file}#${cellId}`. Not saved to the file. */
export const useCellResults = create<Record<string, CellResult>>(() => ({}));

/** The file the visual editor is showing, for chunk runs and image paths. */
export interface DocContext {
  path: string;
  /** http URL of the file's folder (ending in /), for relative images. */
  base?: string;
}
const docContexts = new WeakMap<object, DocContext>();
export const setDocContext = (editor: object, ctx: DocContext) => docContexts.set(editor, ctx);
const docContext = (editor: object) => docContexts.get(editor);

/** The chunk just inserted from the toolbar, whose code editor takes the focus. */
let focusCell: string | undefined;

/** Inserts a block at the top level: after the block holding the cursor, or in place of an empty paragraph. */
export function insertTopLevel(editor: any, node: Record<string, any>) {
  const { $from } = editor.state.selection;
  if ($from.depth === 1 && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0) return editor.chain().focus().insertContent(node).run();
  const pos = $from.depth >= 1 ? $from.after(1) : $from.pos;
  return editor.chain().focus().insertContentAt(pos, node).run();
}

/** Adds an empty R chunk below the block holding the cursor and focuses its code. */
export function insertRCell(editor: any) {
  const cid = newCellId();
  focusCell = cid;
  return insertTopLevel(editor, { type: "rCell", attrs: { header: "{r}", code: "", cid } });
}

let cellSeq = 0;
export const newCellId = () => `c${Date.now().toString(36)}${(cellSeq++).toString(36)}`;

export async function runCell(path: string, cellId: string, code: string) {
  const key = `${path}#${cellId}`;
  useCellResults.setState({ [key]: { ...useCellResults.getState()[key], running: true, queued: false } });
  try {
    const r = await host.call("console.runCell", { code, source: { file: path, line: 1 } });
    useCellResults.setState({ [key]: { text: r.text, isError: r.isError, images: r.images } });
    return !r.isError;
  } catch (e: any) {
    useCellResults.setState({ [key]: { text: String(e?.message ?? e), isError: true } });
    return false;
  }
}

export type CellRange = "this" | "above" | "below" | "all";

/**
 * Runs chunks in document order: this one, from the top through this one,
 * from this one to the end, or all. Stops at the first error.
 */
export async function runCellRange(editor: Editor, path: string, range: CellRange, cid?: string) {
  const cells: { cid: string; code: string }[] = [];
  editor.state.doc.forEach((n) => {
    if (n.type.name === "rCell") cells.push({ cid: n.attrs.cid, code: n.attrs.code ?? "" });
  });
  const at = cid ? cells.findIndex((c) => c.cid === cid) : -1;
  const pick =
    range === "all" ? cells : range === "this" ? cells.slice(at, at + 1) : range === "above" ? cells.slice(0, at + 1) : cells.slice(Math.max(at, 0));
  const key = (c: { cid: string }) => `${path}#${c.cid}`;
  useCellResults.setState(Object.fromEntries(pick.map((c) => [key(c), { ...useCellResults.getState()[key(c)], queued: true }])));
  let ok = true;
  for (const c of pick) {
    if (ok) ok = await runCell(path, c.cid, c.code);
    else useCellResults.setState({ [key(c)]: { ...useCellResults.getState()[key(c)], queued: false } });
  }
  return ok;
}

function RCellView({ node, updateAttributes, editor, selected, getPos }: NodeViewProps) {
  const hostEl = useRef<HTMLDivElement>(null);
  const ed = useRef<monaco.editor.IStandaloneCodeEditor>();
  const cid = node.attrs.cid as string;
  const cidRef = useRef(cid);
  cidRef.current = cid;
  const path = docContext(editor)?.path ?? "";
  const result = useCellResults((s) => s[`${path}#${cid}`]);
  const latest = useRef(node.attrs.code as string);
  latest.current = node.attrs.code;
  const header = String(node.attrs.header ?? "{r}");
  const label = cellLabel(header, node.attrs.code ?? "");
  const wrap = useRef<HTMLDivElement>(null);
  const [popup, setPopup] = useState<{ kind: "options" | "more"; anchor: DOMRect }>();
  const foldKey = `${path}#${cid}`;
  const [folded, setFolded] = useState(() => foldedCells.has(foldKey));
  const toggleFold = () => {
    const f = !folded;
    if (f) foldedCells.add(foldKey);
    else foldedCells.delete(foldKey);
    setFolded(f);
  };
  const pos = () => (typeof getPos === "function" ? getPos() : undefined);
  const ops = () => cellOps(editor, pos, ed.current);

  const run = () => {
    focusedCells.set(path, cid);
    void runCell(path, cid, ed.current?.getValue() ?? latest.current);
  };
  const runRange = (r: CellRange) => {
    // Make sure the doc has this chunk's latest text before reading the others.
    const v = ed.current?.getValue();
    if (v !== undefined && v !== latest.current) updateAttributes({ code: v });
    setTimeout(() => void runCellRange(editor, path, r, cid), 0);
  };

  // Chunks pasted or dragged in may arrive without an id.
  useEffect(() => {
    if (!cid) updateAttributes({ cid: newCellId() });
  }, [cid]);

  useEffect(() => {
    if (!hostEl.current) return;
    const model = monaco.editor.createModel(node.attrs.code ?? "", "r");
    const e = monaco.editor.create(hostEl.current, {
      model,
      theme: monacoTheme(),
      ...editorFontOptions(),
      minimap: { enabled: false },
      lineNumbers: "off",
      folding: false,
      glyphMargin: false,
      lineDecorationsWidth: 6,
      scrollBeyondLastLine: false,
      scrollbar: { vertical: "hidden", horizontal: "auto", alwaysConsumeMouseWheel: false },
      overviewRulerLanes: 0,
      renderLineHighlight: "none",
      automaticLayout: true,
      tabSize: 2,
      wordWrap: "on",
      padding: { top: 8, bottom: 8 },
      // Suggestions, hover help and signature hints float above the document instead of being clipped by the chunk.
      fixedOverflowWidgets: true,
      overflowWidgetsDomNode: overflowHost(),
      unicodeHighlight: { ambiguousCharacters: false },
    });
    ed.current = e;
    // Completion sees every R chunk of the document, in order, like Positron.
    const unregister = registerRCellModel(model, () => {
      const cells: string[] = [];
      let index = -1;
      editor.state.doc.forEach((n) => {
        if (n.type.name !== "rCell") return;
        if (n.attrs.cid === cidRef.current) index = cells.length;
        cells.push(n.attrs.code ?? "");
      });
      const p = docContext(editor)?.path;
      return p && index >= 0 ? { path: p, cells, index } : null;
    });
    const fit = () => {
      if (hostEl.current) hostEl.current.style.height = `${Math.max(38, e.getContentHeight())}px`;
      e.layout();
    };
    e.onDidContentSizeChange(fit);
    fit();
    e.onDidChangeModelContent(() => {
      const v = e.getValue();
      if (v !== latest.current) updateAttributes({ code: v });
    });
    e.onDidFocusEditorText(() => focusedCells.set(docContext(editor)?.path ?? "", cidRef.current));
    if (focusCell && focusCell === node.attrs.cid) {
      focusCell = undefined;
      setTimeout(() => e.focus(), 0);
    }
    addLocalCommand(e, monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, run);
    addLocalCommand(e, monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => runRange("above"));
    return () => {
      unregister();
      e.dispose();
      model.dispose();
    };
  }, []);

  // The document changed underneath (source edit, AI edit): follow it.
  useEffect(() => {
    const e = ed.current;
    if (e && e.getValue() !== node.attrs.code) e.setValue(node.attrs.code ?? "");
  }, [node.attrs.code]);

  return (
    <NodeViewWrapper ref={wrap} className={`qv-cell ${selected ? "selected" : ""} ${popup ? "tools-open" : ""} ${folded ? "folded" : ""}`} data-cell={cid}>
      <div
        className="qv-cell-handle"
        contentEditable={false}
        title="끌어서 청크 옮기기"
        onPointerDown={(e) => wrap.current && dragCell(e, editor, pos, wrap.current)}
      >
        <svg viewBox="0 0 16 16" className="qv-grip-icon">
          {[5, 8, 11].flatMap((y) => [6, 10].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" />))}
        </svg>
      </div>
      <div className="qv-cell-head" contentEditable={false}>
        <span className="qv-cell-lang">R</span>
        {label && <span className="qv-cell-label">{label}</span>}
        <input
          className="qv-cell-header"
          value={header}
          title="청크 머리글 (예: {r} 또는 {r label, echo=FALSE})"
          onChange={(e) => updateAttributes({ header: e.target.value })}
        />
        <span className="qv-spacer" />
        {result?.running || result?.queued ? (
          <span className="qv-cell-status">{result.running ? "실행 중…" : "대기 중"}</span>
        ) : (
          <div className="qv-run-group">
            <button className="qv-run" onClick={() => runRange("above")} title="처음부터 이 청크까지 실행 (⌘⇧↩)">
              <RunIcon arrow="up" />
            </button>
            <button className="qv-run" onClick={() => runRange("below")} title="이 청크부터 아래 모두 실행">
              <RunIcon arrow="down" />
            </button>
            <button className="qv-run main" onClick={run} title="이 청크 실행 (⌘↩)">
              <RunIcon />
            </button>
          </div>
        )}
        {result && !result.running && !result.queued && (result.text !== undefined || result.images) && (
          <button className="qv-run" title="결과 지우기" onClick={() => clearResult(path, cid)}>
            <svg viewBox="0 0 16 16" className="qv-run-icon">
              <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
            </svg>
          </button>
        )}
        <div className="qv-cell-tools">
          <button className="qv-run" title="청크 옵션 (label, echo, 그림 크기…)" onClick={(e) => setPopup({ kind: "options", anchor: e.currentTarget.getBoundingClientRect() })}>
            <ToolIcon kind="options" />
          </button>
          <button className="qv-run" title="아래에 복제" onClick={() => ops().duplicate()}>
            <ToolIcon kind="copy" />
          </button>
          <button className="qv-run" title="청크 삭제 (⌘Z로 되돌리기)" onClick={() => ops().remove()}>
            <ToolIcon kind="trash" />
          </button>
          <button className="qv-run" title="더 보기" onClick={(e) => setPopup({ kind: "more", anchor: e.currentTarget.getBoundingClientRect() })}>
            <ToolIcon kind="more" />
          </button>
        </div>
      </div>
      {popup?.kind === "options" && (
        <Popup anchor={popup.anchor} onClose={() => setPopup(undefined)}>
          <CellOptionsForm header={header} code={node.attrs.code ?? ""} update={(a) => updateAttributes(a)} />
        </Popup>
      )}
      {popup?.kind === "more" && (
        <Popup anchor={popup.anchor} onClose={() => setPopup(undefined)} menu>
          {(() => {
            const o = ops();
            const item = (text: string, act: (() => void) | null, hint?: string) => (
              <div
                className={`menu-item ${act ? "" : "disabled"}`}
                title={hint}
                onClick={() => {
                  if (!act) return;
                  setPopup(undefined);
                  act();
                }}
              >
                {text}
              </div>
            );
            const hasResult = !!result && (result.text !== undefined || !!result.images);
            return (
              <>
                {item(folded ? "코드 펼치기" : "코드 접기", toggleFold)}
                {item("커서 위치에서 나누기", o.canSplit() ? o.split : null, o.canSplit() ? undefined : "코드 안에 커서를 두면 그 줄부터 새 청크로 나눕니다")}
                {item("아래 청크와 합치기", o.canMerge() ? o.merge : null, o.canMerge() ? undefined : "바로 아래가 R 청크일 때만 합칠 수 있습니다")}
                {item("결과 지우기", hasResult ? () => clearResult(path, cid) : null)}
                <div className="menu-sep" />
                {item("어시스턴트에게 묻기", () => askAboutCell(path, label, ed.current?.getValue() ?? latest.current))}
              </>
            );
          })()}
        </Popup>
      )}
      {folded && (
        <div className="qv-cell-fold" contentEditable={false} onClick={toggleFold} title="펼치기">
          <span className="ellipsis">{foldSummary(node.attrs.code ?? "")}</span>
        </div>
      )}
      <div
        className="qv-cell-code"
        ref={hostEl}
        contentEditable={false}
        // In WebKit (the Mac app) a click into a chunk of a freshly opened document can leave the keyboard
        // on the surrounding document editor, so typing goes nowhere until some chunk was focused by code.
        // Hand the focus to this chunk's editor explicitly.
        onMouseUp={() => setTimeout(() => ed.current && !ed.current.hasTextFocus() && ed.current.focus(), 0)}
      />
      {result && !result.running && (result.text?.trim() || result.images?.length) ? (
        <div className="qv-cell-out" contentEditable={false}>
          {result.text?.trim() && <pre className={result.isError ? "error" : ""}>{result.text.trimEnd()}</pre>}
          {result.images?.map((img, i) => (
            <img key={i} src={`data:${img.mime};base64,${img.data}`} alt="R plot" />
          ))}
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------- chunk tools

/** Chunks whose code is folded, by `${file}#${cellId}`. Not saved to the file. */
const foldedCells = new Set<string>();

const clearResult = (path: string, cid: string) => useCellResults.setState({ [`${path}#${cid}`]: undefined as any });

function foldSummary(code: string) {
  const lines = stripCellOptions(code).split("\n");
  const first = lines.find((l) => l.trim()) ?? "";
  const n = lines.filter((l) => l.trim()).length;
  return n > 1 ? `${first.trim()}  … ${n}줄` : first.trim() || "(빈 청크)";
}

/** Labels used by the document's chunks. */
function docLabels(editor: Editor) {
  const out = new Set<string>();
  editor.state.doc.forEach((n) => {
    if (n.type.name !== "rCell") return;
    const l = cellLabel(String(n.attrs.header ?? ""), n.attrs.code ?? "");
    if (l) out.add(l);
  });
  return out;
}

/** Delete, duplicate, split and merge for the chunk at `pos()`, each one undo step. */
function cellOps(editor: Editor, pos: () => number | undefined, code?: monaco.editor.IStandaloneCodeEditor) {
  const at = () => {
    const p = pos();
    const node = p === undefined ? null : editor.state.doc.nodeAt(p);
    return p !== undefined && node?.type.name === "rCell" ? { p, node } : null;
  };
  /** The next top-level chunk, if only empty paragraphs lie between. */
  const nextCell = () => {
    const c = at();
    if (!c) return null;
    const doc = editor.state.doc;
    let q = c.p + c.node.nodeSize;
    while (q < doc.content.size) {
      const n = doc.nodeAt(q)!;
      if (n.type.name === "rCell") return { p: q, node: n };
      if (n.type.name !== "paragraph" || n.content.size) return null;
      q += n.nodeSize;
    }
    return null;
  };
  const splitAt = () => {
    const c = at();
    const line = code?.getPosition()?.lineNumber;
    return c && line ? splitCellCode(c.node.attrs.code ?? "", line) : null;
  };
  return {
    remove() {
      const c = at();
      if (!c) return;
      const tr = editor.state.tr.delete(c.p, c.p + c.node.nodeSize);
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(c.p, tr.doc.content.size)), -1));
      editor.view.dispatch(tr.scrollIntoView());
      editor.view.focus();
      useStore.getState().notify("청크를 지웠습니다. ⌘Z로 되돌릴 수 있습니다.");
    },
    duplicate() {
      const c = at();
      if (!c) return;
      const copy = copyCell(String(c.node.attrs.header ?? "{r}"), c.node.attrs.code ?? "", docLabels(editor));
      const cid = newCellId();
      const node = c.node.type.create({ ...c.node.attrs, ...copy, cid, src: null, ser0: null, before: null });
      const end = c.p + c.node.nodeSize;
      const tr = editor.state.tr.insert(end, node);
      tr.setSelection(NodeSelection.create(tr.doc, end));
      editor.view.dispatch(tr.scrollIntoView());
    },
    canSplit: () => !!splitAt(),
    split() {
      const c = at();
      const parts = splitAt();
      if (!c || !parts) return;
      const tr = editor.state.tr.setNodeMarkup(c.p, undefined, { ...c.node.attrs, code: parts[0] });
      const end = c.p + c.node.nodeSize;
      const cid = newCellId();
      focusCell = cid;
      tr.insert(end, c.node.type.create({ header: "{r}", code: parts[1], fence: c.node.attrs.fence, cid }));
      editor.view.dispatch(tr.scrollIntoView());
    },
    canMerge: () => !!nextCell(),
    merge() {
      const c = at();
      const n = nextCell();
      if (!c || !n) return;
      const tr = editor.state.tr.delete(c.p + c.node.nodeSize, n.p + n.node.nodeSize);
      tr.setNodeMarkup(c.p, undefined, { ...c.node.attrs, code: mergeCellCode(c.node.attrs.code ?? "", n.node.attrs.code ?? "") });
      editor.view.dispatch(tr);
    },
  };
}

/**
 * Moves a chunk by dragging its handle. Done with pointer events and one
 * transaction on drop rather than HTML drag and drop, which WebKit (the Mac
 * app) and Chromium handle differently for ProseMirror node views.
 */
function dragCell(e: React.PointerEvent, editor: Editor, pos: () => number | undefined, cellEl: HTMLElement) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const view = editor.view;
  const startY = e.clientY;
  let lastY = e.clientY;
  let started = false;
  let target: number | null = null;
  const line = document.createElement("div");
  line.className = "qv-drop-line";
  const scroller = scrollParent(view.dom);
  let raf = 0;

  const place = () => {
    const blocks: { pos: number; rect: DOMRect }[] = [];
    view.state.doc.forEach((_n, offset) => {
      const dom = view.nodeDOM(offset) as HTMLElement | null;
      if (dom?.getBoundingClientRect) blocks.push({ pos: offset, rect: dom.getBoundingClientRect() });
    });
    if (!blocks.length) return;
    let i = blocks.findIndex((b) => lastY < b.rect.top + b.rect.height / 2);
    if (i < 0) i = blocks.length;
    target = i < blocks.length ? blocks[i]!.pos : view.state.doc.content.size;
    const prev = blocks[i - 1]?.rect;
    const next = blocks[i]?.rect;
    const y = prev && next ? (prev.bottom + next.top) / 2 : next ? next.top - 4 : prev!.bottom + 4;
    const box = view.dom.getBoundingClientRect();
    const cs = getComputedStyle(view.dom);
    const left = box.left + parseFloat(cs.paddingLeft);
    line.style.top = `${y - 1}px`;
    line.style.left = `${left}px`;
    line.style.width = `${box.right - parseFloat(cs.paddingRight) - left}px`;
  };
  const tick = () => {
    raf = 0;
    if (!started) return;
    // Scroll while the pointer is near the top or bottom edge.
    const r = scroller.getBoundingClientRect();
    const edge = 40;
    const dy = lastY < r.top + edge ? -Math.ceil((r.top + edge - lastY) / 3) : lastY > r.bottom - edge ? Math.ceil((lastY - r.bottom + edge) / 3) : 0;
    if (dy) scroller.scrollTop += dy;
    place();
    if (dy) raf = requestAnimationFrame(tick);
  };
  const move = (ev: PointerEvent) => {
    lastY = ev.clientY;
    if (!started) {
      if (Math.abs(lastY - startY) < 4) return;
      started = true;
      cellEl.classList.add("dragging");
      document.body.classList.add("qv-dragging");
      document.body.appendChild(line);
    }
    if (!raf) raf = requestAnimationFrame(tick);
  };
  const finish = (drop: boolean) => {
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", cancel, true);
    window.removeEventListener("keydown", key, true);
    cancelAnimationFrame(raf);
    line.remove();
    cellEl.classList.remove("dragging");
    document.body.classList.remove("qv-dragging");
    const from = pos();
    if (!drop || !started || target === null || from === undefined) return;
    const node = view.state.doc.nodeAt(from);
    if (!node || target === from || target === from + node.nodeSize) return;
    const tr = view.state.tr.delete(from, from + node.nodeSize);
    const to = tr.mapping.map(target);
    tr.insert(to, node);
    tr.setSelection(NodeSelection.create(tr.doc, to));
    view.dispatch(tr.scrollIntoView());
    // So ⌘Z right after the drop undoes the move.
    view.focus();
  };
  const up = () => finish(true);
  const cancel = () => finish(false);
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    finish(false);
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", cancel, true);
  window.addEventListener("keydown", key, true);
}

function scrollParent(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement as HTMLElement;
}

/** A small panel or menu under a chunk's button, on <body> so the dock does not clip or shift it. */
function Popup({ anchor, onClose, menu, children }: { anchor: DOMRect; onClose: () => void; menu?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ top: anchor.bottom + 4, right: window.innerWidth - anchor.right, visibility: "hidden" });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const top = anchor.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, anchor.top - 4 - h) : anchor.bottom + 4;
    setStyle({ top, right: Math.max(8, window.innerWidth - anchor.right) });
    if (!menu) el.querySelector<HTMLElement>("input, select")?.focus();
  }, []);
  return createPortal(
    <>
      <div className="dv-menu-shield" onMouseDown={onClose} />
      <div
        ref={ref}
        className={menu ? "context-menu dv-menu qv-cell-menu" : "context-menu qv-cell-popup"}
        style={style}
        onKeyDown={(e) => {
          if (e.key === "Escape" || (e.key === "Enter" && !menu)) {
            e.preventDefault();
            onClose();
          }
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

const TRI: Record<string, [string, string]> = {
  echo: ["보임", "숨김"],
  eval: ["실행", "건너뜀"],
  include: ["넣음", "뺌"],
  warning: ["보임", "숨김"],
  message: ["보임", "숨김"],
};

/** The chunk's common `#|` options, written back as you change them. */
function CellOptionsForm({ header, code, update }: { header: string; code: string; update: (attrs: { header?: string; code?: string }) => void }) {
  const opts = readCellOptions(code);
  const headerLabel = /^\{r[ ,]+([^,}=\s]+)\s*(?:[,}])/.exec(header)?.[1];
  const label = opts.label ?? headerLabel ?? "";
  const set = (key: string, v: string) => update({ code: setCellOptions(code, { [key]: v.trim() || undefined }) });
  const setLabel = (v: string) => {
    v = v.trim().replace(/\s+/g, "-");
    // A label written in the header stays there.
    if (opts.label === undefined && headerLabel) update({ header: v ? header.replace(/^(\{r[ ,]+)[^,}=\s]+/, `$1${v}`) : header.replace(/^\{r[ ,]+[^,}=\s]+/, "{r") });
    else set("label", v);
  };
  const headerOpts = /=/.test(header);
  const tri = (key: string) => (
    <label className="qv-opt" key={key}>
      <span>{key}</span>
      <select value={/^(true|false)$/i.test(opts[key] ?? "") ? opts[key]!.toLowerCase() : opts[key] ? "other" : ""} onChange={(e) => set(key, e.target.value)}>
        <option value="">기본</option>
        <option value="true">{TRI[key]![0]}</option>
        <option value="false">{TRI[key]![1]}</option>
        {opts[key] && !/^(true|false)$/i.test(opts[key]!) && <option value="other" disabled>{opts[key]}</option>}
      </select>
    </label>
  );
  const text = (key: string, value: string, onChange: (v: string) => void, placeholder?: string, title?: string) => (
    <label className="qv-opt" key={key} title={title}>
      <span>{key}</span>
      <input className="text-input" defaultValue={value} placeholder={placeholder} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
  return (
    <div className="qv-opts">
      {text("label", label, setLabel, "예: fig-scatter", "그림은 fig-, 표는 tbl-로 시작하면 상호 참조할 수 있습니다")}
      {(["echo", "eval", "include", "warning", "message"] as const).map(tri)}
      {text("fig-width", opts["fig-width"] ?? "", (v) => set("fig-width", v), "인치, 예: 6")}
      {text("fig-height", opts["fig-height"] ?? "", (v) => set("fig-height", v), "인치, 예: 4")}
      {text("fig-cap", opts["fig-cap"] ?? "", (v) => set("fig-cap", v), "그림 설명")}
      {headerOpts && <div className="qv-opt-note">머리글 {header}에 적힌 옵션도 함께 적용됩니다.</div>}
    </div>
  );
}

/** Opens the assistant with this chunk in the input box, for the user to say what they want. */
function askAboutCell(path: string, label: string | undefined, code: string) {
  allCommands().find((x) => x.id === "view.assistant")?.run();
  const where = `${path.split("/").pop()}의 ${label ? `"${label}" 청크` : "청크"}`;
  useAssistant.setState({ draft: `${where}:\n\`\`\`r\n${code.replace(/\n+$/, "")}\n\`\`\`\n` });
}

function ToolIcon({ kind }: { kind: "options" | "copy" | "trash" | "more" }) {
  return (
    <svg viewBox="0 0 16 16" className="qv-run-icon">
      {kind === "options" && <path d="M3 5h5M11 5h2M3 11h2M8 11h5M9.5 3.5v3M6.5 9.5v3" />}
      {kind === "copy" && <path d="M5.5 5.5h7v7h-7zM3.5 10.5v-7h7" />}
      {kind === "trash" && <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4" />}
      {kind === "more" && (
        <>
          <circle cx="4" cy="8" r=".6" />
          <circle cx="8" cy="8" r=".6" />
          <circle cx="12" cy="8" r=".6" />
        </>
      )}
    </svg>
  );
}

export const RCell = Node.create({
  name: "rCell",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      header: { default: "{r}", rendered: false },
      code: { default: "", rendered: false },
      fence: { default: "```", rendered: false },
      cid: { default: null, rendered: false, keepOnSplit: false },
    };
  },
  parseHTML: () => [{ tag: "div[data-rcell]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-rcell": "" })],
  addNodeView() {
    return ReactNodeViewRenderer(RCellView, { stopEvent: ({ event }) => !!(event.target as HTMLElement)?.closest?.(".qv-cell-code, .qv-cell-head, .qv-cell-handle, .qv-cell-fold") });
  },
  addKeyboardShortcuts() {
    return { "Mod-Alt-i": () => insertRCell(this.editor) };
  },
});

// ---------------------------------------------------------------- source-like blocks

function SourceBlockView({ node, updateAttributes, kind }: NodeViewProps & { kind: "frontMatter" | "rawBlock" }) {
  const attr = kind === "frontMatter" ? "yaml" : "text";
  const value = String(node.attrs[attr] ?? "");
  const [open, setOpen] = useState(kind === "rawBlock");
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = ta.current;
    if (t) {
      t.style.height = "auto";
      t.style.height = `${t.scrollHeight}px`;
    }
  }, [value, open]);
  const title = kind === "frontMatter" ? (/^title:\s*["']?(.*?)["']?\s*$/m.exec(value)?.[1] ?? "") : "";
  return (
    <NodeViewWrapper className={`qv-source qv-${kind}`}>
      <div className="qv-source-head" contentEditable={false} onClick={() => kind === "frontMatter" && setOpen(!open)}>
        {kind === "frontMatter" ? (
          <>
            <span>{open ? "▾" : "▸"} 문서 설정 (YAML)</span>
            {!open && title && <span className="muted"> · {title}</span>}
          </>
        ) : (
          <span title="비주얼 편집기가 아직 다루지 않는 Quarto 문법입니다. 원문 그대로 저장됩니다.">원문 블록</span>
        )}
      </div>
      {open && (
        <textarea
          ref={ta}
          className="qv-source-text"
          spellCheck={false}
          value={value}
          onChange={(e) => updateAttributes({ [attr]: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
      )}
    </NodeViewWrapper>
  );
}

const sourceNode = (name: "frontMatter" | "rawBlock", attr: string) =>
  Node.create({
    name,
    group: "block",
    atom: true,
    selectable: true,
    addAttributes: () => ({ [attr]: { default: "", rendered: false } }),
    parseHTML: () => [{ tag: `div[data-${name}]` }],
    renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { [`data-${name}`]: "" })],
    addNodeView() {
      return ReactNodeViewRenderer((p: NodeViewProps) => <SourceBlockView {...p} kind={name} />, {
        stopEvent: ({ event }) => (event.target as HTMLElement)?.tagName === "TEXTAREA",
      });
    },
  });

export const FrontMatter = sourceNode("frontMatter", "yaml");
export const RawBlock = sourceNode("rawBlock", "text");

// ---------------------------------------------------------------- math

function renderTex(tex: string, displayMode: boolean) {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false });
  } catch {
    return tex;
  }
}

function MathBlockView({ node, updateAttributes, selected }: NodeViewProps) {
  const [editing, setEditing] = useState(!node.attrs.tex);
  const tex = String(node.attrs.tex ?? "");
  return (
    <NodeViewWrapper className={`qv-math ${selected ? "selected" : ""}`}>
      {editing || selected ? (
        <textarea
          className="qv-source-text"
          autoFocus={editing}
          spellCheck={false}
          value={tex}
          placeholder="LaTeX 수식"
          onChange={(e) => updateAttributes({ tex: e.target.value })}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      ) : null}
      <div contentEditable={false} onDoubleClick={() => setEditing(true)} dangerouslySetInnerHTML={{ __html: renderTex(tex, true) }} />
    </NodeViewWrapper>
  );
}

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes: () => ({ tex: { default: "", rendered: false } }),
  parseHTML: () => [{ tag: "div[data-math]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-math": "" })],
  addNodeView() {
    return ReactNodeViewRenderer(MathBlockView, { stopEvent: ({ event }) => (event.target as HTMLElement)?.tagName === "TEXTAREA" });
  },
});

export const InlineMath = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ tex: { default: "", rendered: false } }),
  parseHTML: () => [{ tag: "span[data-math]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-math": "" })],
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("span");
      dom.className = "qv-imath";
      dom.innerHTML = renderTex(node.attrs.tex, false);
      dom.title = "더블클릭해서 수식 고치기";
      dom.addEventListener("dblclick", async () => {
        const v = await formDialog({ title: "수식 고치기", fields: [{ key: "tex", label: "LaTeX", value: node.attrs.tex, multiline: true }], confirm: "고치기" });
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (!v || pos === undefined) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, tex: v.tex }));
      });
      return { dom };
    };
  },
});

/** Pandoc inline note, ^[text]: a numbered marker; hover shows the note, double-click edits it. */
export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ text: { default: "", rendered: false } }),
  parseHTML: () => [{ tag: "sup[data-note]" }],
  renderHTML: ({ HTMLAttributes }) => ["sup", mergeAttributes(HTMLAttributes, { "data-note": "" })],
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("sup");
      dom.className = "qv-note";
      dom.title = `각주: ${node.attrs.text}\n(더블클릭해서 고치기)`;
      dom.addEventListener("dblclick", async () => {
        const v = await formDialog({ title: "각주 고치기", fields: [{ key: "text", label: "각주 내용", value: node.attrs.text, multiline: true }], confirm: "고치기" });
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (!v || pos === undefined) return;
        const text = v.text!.replace(/\s*\n\s*/g, " ").trim();
        if (text) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { text }));
        else editor.view.dispatch(editor.state.tr.delete(pos, pos + 1));
      });
      return { dom };
    };
  },
});

/** A reference to a footnote defined elsewhere in the file ([^label]). */
export const FootnoteRef = Node.create({
  name: "footnoteRef",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ label: { default: "", rendered: false } }),
  parseHTML: () => [{ tag: "sup[data-noteref]" }],
  renderHTML: ({ HTMLAttributes }) => ["sup", mergeAttributes(HTMLAttributes, { "data-noteref": "" })],
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("sup");
      dom.className = "qv-noteref";
      dom.textContent = `[^${node.attrs.label}]`;
      dom.title = "각주 참조 (내용은 문서의 각주 정의 블록에 있습니다)";
      return { dom };
    };
  },
});

/** Inserts an inline note at the cursor, asking for its text. */
export async function insertFootnote(editor: Editor) {
  const v = await formDialog({ title: "각주 넣기", fields: [{ key: "text", label: "각주 내용", multiline: true, required: true }], confirm: "넣기" });
  if (!v) return editor.commands.focus();
  const text = v.text!.replace(/\s*\n\s*/g, " ").replace(/[[\]]/g, (c) => (c === "[" ? "(" : ")")).trim();
  editor.chain().focus().insertContent({ type: "footnote", attrs: { text } }).run();
}

// ---------------------------------------------------------------- images

/** Inline images; relative paths are shown from the document's folder. */
export const QImage = Image.extend({
  addNodeView() {
    return ({ node, editor }) => {
      const img = document.createElement("img");
      const src = String(node.attrs.src ?? "");
      const base = docContext(editor)?.base;
      img.src = /^(https?:|data:)/.test(src) || !base ? src : base + src.replace(/^\.\//, "");
      img.alt = node.attrs.alt ?? "";
      if (node.attrs.title) img.title = node.attrs.title;
      img.className = "qv-img";
      return { dom: img };
    };
  },
}).configure({ inline: true });

export const notifyError = (e: unknown) => useStore.getState().notify(String((e as any)?.message ?? e), "error");

let overflowEl: HTMLElement | undefined;
/** One layer on <body> for chunk editors' popups: inside the dock, fixed positions come out shifted. */
function overflowHost() {
  if (!overflowEl) {
    overflowEl = document.createElement("div");
    overflowEl.className = "monaco-editor qv-overflow";
    document.body.appendChild(overflowEl);
  }
  return overflowEl;
}

/** Positron-style run glyphs: a play triangle, with a small arrow for "above" or "below". */
function RunIcon({ arrow }: { arrow?: "up" | "down" }) {
  return (
    <svg viewBox="0 0 16 16" className="qv-run-icon">
      <path d={arrow ? "M2.5 3v10l7-5z" : "M4.5 2.5v11l8.5-5.5z"} />
      {arrow === "up" && <path d="M13 13V6.5M10.8 8.7 13 6.5l2.2 2.2" />}
      {arrow === "down" && <path d="M13 6.5V13M10.8 10.8 13 13l2.2-2.2" />}
    </svg>
  );
}
