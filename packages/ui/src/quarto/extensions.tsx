// Tiptap nodes for the .qmd visual editor: R chunks (with their own code
// editor, run button and results), YAML front matter, display math, inline
// math, raw blocks that keep unsupported Quarto syntax as source, and the
// round-trip attributes every top-level block carries (see qmd.ts).

import { useEffect, useRef, useState } from "react";
import { Extension, Node, NodeViewWrapper, ReactNodeViewRenderer, mergeAttributes, type NodeViewProps } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import katex from "katex";
import { create } from "zustand";
import { host } from "../host/client";
import { useStore } from "../store";
import { monaco } from "../editor/monaco";

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
  useCellResults.setState({ [key]: { ...useCellResults.getState()[key], running: true } });
  try {
    const r = await host.call("console.runCell", { code, source: { file: path, line: 1 } });
    useCellResults.setState({ [key]: { text: r.text, isError: r.isError, images: r.images } });
    return !r.isError;
  } catch (e: any) {
    useCellResults.setState({ [key]: { text: String(e?.message ?? e), isError: true } });
    return false;
  }
}

function RCellView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const hostEl = useRef<HTMLDivElement>(null);
  const ed = useRef<monaco.editor.IStandaloneCodeEditor>();
  const cid = node.attrs.cid as string;
  const path = docContext(editor)?.path ?? "";
  const result = useCellResults((s) => s[`${path}#${cid}`]);
  const latest = useRef(node.attrs.code as string);
  latest.current = node.attrs.code;
  const header = String(node.attrs.header ?? "{r}");
  const label = /#\|\s*label:\s*(\S+)/.exec(node.attrs.code ?? "")?.[1] ?? /^\{r[ ,]+([^,}=\s]+)/.exec(header)?.[1];

  const run = () => void runCell(path, cid, ed.current?.getValue() ?? latest.current);

  // Chunks pasted or dragged in may arrive without an id.
  useEffect(() => {
    if (!cid) updateAttributes({ cid: newCellId() });
  }, [cid]);

  useEffect(() => {
    if (!hostEl.current) return;
    const model = monaco.editor.createModel(node.attrs.code ?? "", "r");
    const e = monaco.editor.create(hostEl.current, {
      model,
      theme: "rsage-dark",
      fontSize: 13,
      fontFamily: "var(--mono)",
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
      unicodeHighlight: { ambiguousCharacters: false },
    });
    ed.current = e;
    const fit = () => {
      if (hostEl.current) hostEl.current.style.height = `${Math.max(22, e.getContentHeight())}px`;
      e.layout();
    };
    e.onDidContentSizeChange(fit);
    fit();
    e.onDidChangeModelContent(() => {
      const v = e.getValue();
      if (v !== latest.current) updateAttributes({ code: v });
    });
    if (focusCell && focusCell === node.attrs.cid) {
      focusCell = undefined;
      setTimeout(() => e.focus(), 0);
    }
    e.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, run);
    e.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, run);
    return () => {
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
    <NodeViewWrapper className={`qv-cell ${selected ? "selected" : ""}`} data-cell={cid}>
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
        <button className="btn btn-small" onClick={run} disabled={result?.running} title="청크 실행 (⌘↩)">
          {result?.running ? "실행 중…" : "▶ 실행"}
        </button>
        {result && !result.running && (
          <button className="btn btn-small" title="결과 지우기" onClick={() => useCellResults.setState({ [`${path}#${cid}`]: undefined as any })}>
            ✕
          </button>
        )}
      </div>
      <div className="qv-cell-code" ref={hostEl} contentEditable={false} />
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
    return ReactNodeViewRenderer(RCellView, { stopEvent: ({ event }) => !!(event.target as HTMLElement)?.closest?.(".qv-cell-code, .qv-cell-head") });
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
      dom.addEventListener("dblclick", () => {
        const tex = window.prompt("수식 (LaTeX)", node.attrs.tex);
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (tex === null || pos === undefined) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, tex }));
      });
      return { dom };
    };
  },
});

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
