// The .qmd visual editor. The file's Monaco model stays the single source
// of truth (saving, dirty state, backups and AI edits all go through it):
// edits here are written back into the model as text, and changes to the
// model from elsewhere are parsed back into this view.

import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { getModel } from "../editor/files";
import { host } from "../host/client";
import { FrontMatter, InlineMath, MathBlock, QImage, RawBlock, RCell, RoundTrip, insertRCell, insertTopLevel, newCellId, runCell, setDocContext } from "./extensions";
import { parseQmd, toQmd, withBaselines, type PMNode } from "./qmd";

const EXTENSIONS = [
  StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: false } }),
  TableKit.configure({ table: { resizable: false } }),
  QImage,
  RCell,
  FrontMatter,
  RawBlock,
  MathBlock,
  InlineMath,
  RoundTrip,
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

function load(editor: Editor, text: string, prev?: PMNode) {
  const parsed = parseQmd(text);
  editor.commands.setContent(carryCellIds(withCellIds(parsed.doc), prev) as any, { emitUpdate: false });
  // Baselines from the editor's own (normalized) document.
  editor.commands.setContent(withBaselines(editor.getJSON() as PMNode) as any, { emitUpdate: false });
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
        editor.commands.setContent(editor.getJSON(), { emitUpdate: false });
      })
      .catch(() => {});
  }, [editor, path]);

  useEffect(() => {
    if (active) setTimeout(() => editor?.commands.focus(null, { scrollIntoView: false }), 0);
  }, [active, editor]);

  if (!editor) return null;
  return (
    <div className="qv">
      <Toolbar editor={editor} path={path} />
      <div className="qv-scroll">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export async function runAllCells(editor: Editor, path: string, upTo?: number) {
  const cells: { cid: string; code: string }[] = [];
  editor.state.doc.forEach((n, offset) => {
    if (n.type.name === "rCell" && (upTo === undefined || offset < upTo)) cells.push({ cid: n.attrs.cid, code: n.attrs.code });
  });
  for (const c of cells) if (!(await runCell(path, c.cid, c.code))) break;
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
      {btn("링크", "링크", () => {
        const prev = editor.getAttributes("link").href as string | undefined;
        const href = window.prompt("링크 주소", prev ?? "https://");
        if (href === null) return;
        if (!href) chain().unsetLink().run();
        else chain().extendMarkRange("link").setLink({ href }).run();
      }, editor.isActive("link"))}
      <span className="qv-sep" />
      {btn("•", "글머리 목록", () => chain().toggleBulletList().run(), editor.isActive("bulletList"))}
      {btn("1.", "번호 목록", () => chain().toggleOrderedList().run(), editor.isActive("orderedList"))}
      {btn("❝", "인용", () => chain().toggleBlockquote().run(), editor.isActive("blockquote"))}
      {btn("표", "표 넣기", () => {
        if (!editor.isActive("table")) chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      })}
      {btn("∑", "수식 블록", () => insertTopLevel(editor, { type: "mathBlock", attrs: { tex: "" } }))}
      {btn("그림", "그림 넣기 (프로젝트 안의 경로)", () => {
        const src = window.prompt("그림 파일 경로 (이 문서 기준)", "figures/");
        if (src) chain().insertContent({ type: "image", attrs: { src, alt: "" } }).run();
      })}
      <span className="qv-sep" />
      {btn("+ R 청크", "R 청크 넣기 (⌘⌥I)", () => insertRCell(editor))}
      {btn("▶ 모든 청크", "모든 R 청크를 위에서부터 실행", () => void runAllCells(editor, path))}
    </div>
  );
}
