// The .qmd visual editor. The file's Monaco model stays the single source
// of truth (saving, dirty state, backups and AI edits all go through it):
// edits here are written back into the model as text, and changes to the
// model from elsewhere are parsed back into this view.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { XREF_KINDS, xrefTargets, type XrefTarget } from "./xref";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { getModel, visualFlushers } from "../editor/files";
import { host } from "../host/client";
import { Footnote, FootnoteRef, FrontMatter, InlineMath, MathBlock, QImage, RawBlock, RCell, RoundTrip, insertFootnote, insertRCell, insertTopLevel, newCellId, runCellRange, setDocContext } from "./extensions";
import { parseQmd, toQmd, withBaselines, type PMNode } from "./qmd";
import { FindBar, FindInDoc } from "./find";
import { visualEditors } from "../editor/views";
import { formDialog } from "../components/Dialogs";
import { pickFile } from "../components/FolderPicker";
import { useStore } from "../store";

const EXTENSIONS = [
  StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: false } }),
  TableKit.configure({ table: { resizable: false } }),
  QImage,
  RCell,
  FrontMatter,
  RawBlock,
  MathBlock,
  InlineMath,
  Footnote,
  FootnoteRef,
  RoundTrip,
  FindInDoc,
  Placeholder.configure({ placeholder: "여기에 보고서를 쓰세요. ⌘⌥I로 R 청크를 넣을 수 있습니다." }),
];

function withCellIds(doc: PMNode): PMNode {
  return { ...doc, content: doc.content?.map((n) => (n.type === "rCell" ? { ...n, attrs: { ...n.attrs, cid: n.attrs?.cid ?? newCellId() } } : n)) };
}

/** Keeps the cell ids (and so the shown results) of chunks whose code did not change. */
function carryCellIds(next: PMNode, prev: PMNode | undefined): PMNode {
  const byCode = new Map<string, string[]>();
  for (const n of prev?.content ?? []) if (n.type === "rCell" && n.attrs?.cid) byCode.set(n.attrs.code, [...(byCode.get(n.attrs.code) ?? []), n.attrs.cid]);
  return {
    ...next,
    content: next.content?.map((n) => (n.type === "rCell" ? { ...n, attrs: { ...n.attrs, cid: byCode.get(n.attrs?.code)?.shift() ?? n.attrs?.cid } } : n)),
  };
}

/** The last document per file, so chunk results survive switching to source and back. */
const lastDocs = new Map<string, PMNode>();

/** Replaces the whole document without an undo step, so ⌘Z never undoes loading the file. */
function replaceDoc(editor: Editor, content: any) {
  editor.chain().setMeta("addToHistory", false).setContent(content, { emitUpdate: false }).run();
}

function load(editor: Editor, text: string, prev?: PMNode) {
  const parsed = parseQmd(text);
  replaceDoc(editor, carryCellIds(withCellIds(parsed.doc), prev));
  // Baselines from the editor's own (normalized) document.
  replaceDoc(editor, withBaselines(editor.getJSON() as PMNode));
  return parsed.trailing;
}

export function VisualEditor({ path, active }: { path: string; active: boolean }) {
  const trailing = useRef("\n");
  const applying = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const editor = useEditor({
    extensions: EXTENSIONS,
    editorProps: { attributes: { class: "qv-doc", spellcheck: "false" } },
    onUpdate: () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(writeBack, 250);
    },
  });

  function writeBack() {
    timer.current = undefined;
    const model = getModel(path);
    if (!editor || !model) return;
    const next = toQmd(editor.getJSON() as PMNode, trailing.current);
    const cur = model.getValue();
    if (next === cur) return;
    // Replace only the part that changed, so undo and the language server see a small edit.
    let a = 0;
    while (a < cur.length && a < next.length && cur[a] === next[a]) a++;
    let b = 0;
    while (b < cur.length - a && b < next.length - a && cur[cur.length - 1 - b] === next[next.length - 1 - b]) b++;
    const start = model.getPositionAt(a);
    const end = model.getPositionAt(cur.length - b);
    applying.current = true;
    try {
      model.pushEditOperations(
        [],
        [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: next.slice(a, next.length - b) }],
        () => null,
      );
    } finally {
      applying.current = false;
    }
  }

  // Load the document and follow changes made in the source view or by the assistant.
  useEffect(() => {
    const model = getModel(path);
    if (!editor || !model) return;
    trailing.current = load(editor, model.getValue(), lastDocs.get(path));
    const flush = () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      writeBack();
    };
    visualFlushers.set(path, flush);
    let reload: ReturnType<typeof setTimeout> | undefined;
    const sub = model.onDidChangeContent(() => {
      if (applying.current) return;
      clearTimeout(reload);
      reload = setTimeout(() => {
        clearTimeout(timer.current);
        trailing.current = load(editor, model.getValue(), editor.getJSON() as PMNode);
      }, 150);
    });
    return () => {
      if (visualFlushers.get(path) === flush) visualFlushers.delete(path);
      sub.dispose();
      clearTimeout(reload);
      // Don't lose the last keystrokes when switching back to source.
      if (timer.current) {
        clearTimeout(timer.current);
        writeBack();
      }
      if (!editor.isDestroyed) lastDocs.set(path, editor.getJSON() as PMNode);
    };
  }, [editor, path]);

  // Relative images are shown from the document's folder.
  useEffect(() => {
    if (!editor) return;
    setDocContext(editor, { path });
    const dir = path.slice(0, path.lastIndexOf("/") + 1);
    host
      .call("preview.url", { path: dir || "." })
      .then((url) => {
        if (editor.isDestroyed) return;
        setDocContext(editor, { path, base: url.endsWith("/") ? url : url + "/" });
        // Redraw images with the folder now known.
        replaceDoc(editor, editor.getJSON());
      })
      .catch(() => {});
  }, [editor, path]);

  useEffect(() => {
    if (!editor) return;
    visualEditors.set(path, editor);
    return () => {
      if (visualEditors.get(path) === editor) visualEditors.delete(path);
    };
  }, [editor, path]);

  useEffect(() => {
    if (active) setTimeout(() => editor?.commands.focus(null, { scrollIntoView: false }), 0);
  }, [active, editor]);

  // Insert shortcuts, as in Positron: ⇧⌘F7 footnote, ⇧⌘F10 cross reference.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !editor) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key === "F7") {
        e.preventDefault();
        void insertFootnote(editor);
      } else if (e.key === "F10") {
        e.preventDefault();
        xrefOpeners.get(editor)?.();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [editor]);

  if (!editor) return null;
  return (
    <div className="qv" ref={rootRef}>
      <Toolbar editor={editor} path={path} />
      <FindBar editor={editor} />
      <div className="qv-scroll">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

const xrefOpeners = new Map<Editor, () => void>();

/** Picks a labelled figure, table, section or equation and inserts @id at the cursor. */
function XrefButton({ editor, path }: { editor: Editor; path: string }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [targets, setTargets] = useState<XrefTarget[]>([]);
  const [sel, setSel] = useState(0);
  const [at, setAt] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const show = () => {
    // Fixed position in a portal on <body>: the dock's panels would otherwise offset it, and it never widens the editor.
    const r = ref.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 400)) });
    setTargets(xrefTargets(getModel(path)?.getValue() ?? ""));
    setFilter("");
    setSel(0);
    setOpen(true);
  };
  useEffect(() => {
    xrefOpeners.set(editor, show);
    return () => void xrefOpeners.delete(editor);
  }, [editor, path]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as globalThis.Node;
      if (!ref.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const f = filter.toLowerCase();
  const list = targets.filter((t) => !f || t.id.toLowerCase().includes(f) || t.context.toLowerCase().includes(f));
  const insert = (t: XrefTarget) => {
    setOpen(false);
    editor.chain().focus().insertContent(`@${t.id}`).run();
  };
  return (
    <div className="qv-xref" ref={ref}>
      <button className={`btn btn-small qv-tb ${open ? "active" : ""}`} title="상호 참조 넣기 (⇧⌘F10)" onMouseDown={(e) => e.preventDefault()} onClick={() => (open ? setOpen(false) : show())}>
        @참조
      </button>
      {open &&
        createPortal(
        <div className="qv-xref-pop" style={at} ref={pop}>
          <input
            className="text-input"
            autoFocus
            placeholder="그림, 표, 절, 수식 찾기"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "ArrowDown") setSel((i) => Math.min(i + 1, list.length - 1));
              else if (e.key === "ArrowUp") setSel((i) => Math.max(i - 1, 0));
              else if (e.key === "Enter" && list[sel]) insert(list[sel]!);
              else if (e.key === "Escape") {
                setOpen(false);
                editor.commands.focus();
              }
            }}
          />
          <div className="qv-xref-list">
            {list.map((t, i) => (
              <div key={t.id} className={`qv-xref-item ${i === sel ? "active" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => insert(t)}>
                <span className="qv-xref-kind">{XREF_KINDS[t.kind] ?? t.kind}</span>
                <code>@{t.id}</code>
                <span className="muted small ellipsis">{t.context}</span>
              </div>
            ))}
            {!list.length && (
              <div className="muted small qv-xref-empty">
                {targets.length
                  ? "일치하는 대상이 없습니다."
                  : "참조할 대상이 없습니다. 청크에 #| label: fig-이름 을 달거나, 제목 뒤에 {#sec-이름} 을 붙이면 여기에 나옵니다."}
              </div>
            )}
          </div>
        </div>,
          document.body,
        )}
    </div>
  );
}

async function editLink(editor: Editor) {
  const { from, to, empty } = editor.state.selection;
  const prev = editor.getAttributes("link").href as string | undefined;
  if (prev) editor.chain().extendMarkRange("link").run();
  const sel = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ");
  const v = await formDialog({
    title: prev ? "링크 고치기" : "링크 넣기",
    message: prev ? "주소를 비우면 링크가 지워집니다." : undefined,
    fields: [
      { key: "href", label: "주소", value: prev ?? "https://", placeholder: "https://… 또는 #sec-id" },
      { key: "text", label: "표시할 글자", value: sel || (empty ? "" : editor.state.doc.textBetween(from, to, " ")), placeholder: "비우면 주소를 그대로 씁니다" },
    ],
    confirm: prev ? "고치기" : "넣기",
  });
  if (!v) return editor.commands.focus();
  const href = v.href!.trim();
  const chain = editor.chain().focus();
  if (!href || href === "https://") return chain.extendMarkRange("link").unsetLink().run();
  const text = v.text!.trim() || href;
  const { from: a, to: b } = editor.state.selection;
  // Replace the selected text with the given text, linked.
  chain
    .insertContentAt({ from: a, to: b }, { type: "text", text, marks: [{ type: "link", attrs: { href } }] })
    .run();
}

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "svg", "webp", "pdf"];

/** A path from the document's folder to a file, with forward slashes. */
function relativeTo(dir: string, file: string): string {
  const a = dir.split("/").filter(Boolean);
  const b = file.split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}

async function insertImage(editor: Editor, docPath: string) {
  const dir = docPath.slice(0, docPath.lastIndexOf("/"));
  const root = useStore.getState().project?.path ?? dir;
  const v = await formDialog({
    title: "그림 넣기",
    message: "프로젝트 밖의 그림은 문서 옆 figures 폴더로 복사합니다.",
    fields: [
      {
        key: "src",
        label: "그림 파일 (이 문서 기준 경로)",
        placeholder: "figures/plot.png",
        required: true,
        browse: async () => {
          const f = await pickFile("그림 고르기", IMAGE_EXT, dir);
          if (!f) return null;
          if (f.startsWith(root + "/")) return relativeTo(dir, f);
          const name = f.split("/").pop()!;
          try {
            await host.call("fs.copyIn", { from: f, to: `${dir}/figures/${name}` });
          } catch (e) {
            useStore.getState().notify(`그림을 복사하지 못했습니다: ${(e as Error).message}`, "error");
            return null;
          }
          return `figures/${name}`;
        },
      },
      { key: "alt", label: "캡션 (선택, 그림 아래에 표시됩니다)", placeholder: "연비 분포" },
    ],
    confirm: "넣기",
  });
  if (!v) return editor.commands.focus();
  const image = { type: "image", attrs: { src: v.src!.trim(), alt: v.alt!.trim() } };
  // A figure is an image in its own paragraph; an empty paragraph can take it in place.
  const { $from } = editor.state.selection;
  if ($from.parent.type.name === "paragraph" && $from.parent.content.size === 0 && $from.depth === 1)
    editor.chain().focus().insertContent(image).run();
  else insertTopLevel(editor, { type: "paragraph", content: [image] });
}

function Toolbar({ editor, path }: { editor: Editor; path: string }) {
  const chain = () => editor.chain().focus();
  const level = [1, 2, 3, 4].find((l) => editor.isActive("heading", { level: l }));
  const btn = (label: string, title: string, on: () => void, active = false) => (
    <button className={`btn btn-small qv-tb ${active ? "active" : ""}`} title={title} onMouseDown={(e) => e.preventDefault()} onClick={on}>
      {label}
    </button>
  );
  return (
    <div className="qv-toolbar">
      <select
        className="qv-block-select"
        value={level ? String(level) : "p"}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "p") chain().setParagraph().run();
          else chain().setHeading({ level: Number(v) as 1 | 2 | 3 | 4 }).run();
        }}
      >
        <option value="p">본문</option>
        <option value="1">제목 1</option>
        <option value="2">제목 2</option>
        <option value="3">제목 3</option>
        <option value="4">제목 4</option>
      </select>
      {btn("B", "굵게 (⌘B)", () => chain().toggleBold().run(), editor.isActive("bold"))}
      {btn("I", "기울임 (⌘I)", () => chain().toggleItalic().run(), editor.isActive("italic"))}
      {btn("S", "취소선", () => chain().toggleStrike().run(), editor.isActive("strike"))}
      {btn("</>", "코드", () => chain().toggleCode().run(), editor.isActive("code"))}
      {btn("링크", "링크 넣기/고치기", () => void editLink(editor), editor.isActive("link"))}
      <span className="qv-sep" />
      {btn("•", "글머리 목록", () => chain().toggleBulletList().run(), editor.isActive("bulletList"))}
      {btn("1.", "번호 목록", () => chain().toggleOrderedList().run(), editor.isActive("orderedList"))}
      {btn("❝", "인용", () => chain().toggleBlockquote().run(), editor.isActive("blockquote"))}
      {btn("표", "표 넣기", () => {
        if (!editor.isActive("table")) chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      })}
      {btn("∑", "수식 블록", () => insertTopLevel(editor, { type: "mathBlock", attrs: { tex: "" } }))}
      {btn("그림", "그림 넣기", () => void insertImage(editor, path))}
      {btn("각주", "각주 넣기 (⇧⌘F7)", () => void insertFootnote(editor))}
      <XrefButton editor={editor} path={path} />
      <span className="qv-sep" />
      {btn("+ R 청크", "R 청크 넣기 (⌘⌥I)", () => insertRCell(editor))}
      {btn("▶ 모든 청크", "모든 R 청크를 위에서부터 실행", () => void runCellRange(editor, path, "all"))}
    </div>
  );
}
