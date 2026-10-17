// Find in the visual editor (⌘F): highlights matches in the text, and marks
// code cells, raw blocks and front matter that contain the term.

import { useEffect, useRef, useState } from "react";
import { Extension, type Editor } from "@tiptap/react";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

export interface FindQuery {
  text: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}

export interface FindMatch {
  from: number;
  to: number;
  /** Set when the match is inside an atom block (code cell, raw block); from..to is the block. */
  inNode?: boolean;
}

interface FindState {
  query: FindQuery | null;
  current: number;
  matches: FindMatch[];
  decorations: DecorationSet;
}

export const findKey = new PluginKey<FindState>("qvFind");

export function findRegex(q: FindQuery): RegExp | null {
  if (!q.text) return null;
  try {
    const src = q.regex ? q.text : q.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const body = q.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])` : src;
    return new RegExp(body, q.caseSensitive ? "gu" : "giu");
  } catch {
    return null;
  }
}

/** Text of atom blocks that the editor shows in its own widgets. */
function atomText(n: PMNode): string | null {
  switch (n.type.name) {
    case "rCell":
      return `${n.attrs.header ?? ""}\n${n.attrs.code ?? ""}`;
    case "rawBlock":
      return n.attrs.text ?? "";
    case "frontMatter":
      return n.attrs.yaml ?? "";
    case "mathBlock":
      return n.attrs.tex ?? "";
    default:
      return null;
  }
}

export function findMatches(doc: PMNode, q: FindQuery | null): FindMatch[] {
  const re = q && findRegex(q);
  if (!re) return [];
  const out: FindMatch[] = [];
  doc.descendants((node, pos) => {
    const atom = atomText(node);
    if (atom !== null) {
      re.lastIndex = 0;
      if (re.test(atom)) out.push({ from: pos, to: pos + node.nodeSize, inNode: true });
      return false;
    }
    if (!node.isTextblock) return true;
    // One string per paragraph so a match can span differently formatted runs.
    // Inline atoms (math, images, breaks) take one position each, like a character.
    let text = "";
    node.forEach((child) => {
      text += child.isText ? child.text! : "￼";
    });
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (!m[0]) {
        re.lastIndex++;
        continue;
      }
      out.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + m[0].length });
    }
    return false;
  });
  return out;
}

function decorate(state: EditorState, matches: FindMatch[], current: number) {
  return DecorationSet.create(
    state.doc,
    matches.map((m, i) =>
      m.inNode
        ? Decoration.node(m.from, m.to, { class: `qv-find-node${i === current ? " current" : ""}` })
        : Decoration.inline(m.from, m.to, { class: `qv-find${i === current ? " current" : ""}` }),
    ),
  );
}

export const FindInDoc = Extension.create({
  name: "findInDoc",
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => ({ query: null, current: 0, matches: [], decorations: DecorationSet.empty }),
          apply(tr, prev, _old, state) {
            const meta = tr.getMeta(findKey) as { query?: FindQuery | null; current?: number } | undefined;
            if (!meta && !tr.docChanged) return prev;
            const query = meta && "query" in meta ? meta.query! : prev.query;
            const matches = findMatches(state.doc, query);
            let current = meta?.current ?? prev.current;
            if (current >= matches.length) current = matches.length ? matches.length - 1 : 0;
            return { query, current, matches, decorations: decorate(state, matches, current) };
          },
        },
        props: {
          decorations: (state) => findKey.getState(state)?.decorations,
        },
      }),
    ];
  },
});

function setFind(editor: Editor, meta: { query?: FindQuery | null; current?: number }) {
  editor.view.dispatch(editor.state.tr.setMeta(findKey, meta));
}

function goTo(editor: Editor, index: number) {
  const st = findKey.getState(editor.state);
  if (!st?.matches.length) return;
  const i = ((index % st.matches.length) + st.matches.length) % st.matches.length;
  setFind(editor, { current: i });
  const m = st.matches[i]!;
  const dom = m.inNode ? (editor.view.nodeDOM(m.from) as HTMLElement | null) : null;
  if (dom) dom.scrollIntoView({ block: "center", behavior: "smooth" });
  else {
    const at = editor.view.domAtPos(m.from);
    const el = (at.node.nodeType === 1 ? at.node : at.node.parentElement) as HTMLElement | null;
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

/** Opens the find bar of a visual editor with an optional starting term. */
export const findBarOpeners = new Map<Editor, (text?: string) => void>();

export function FindBar({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState<FindQuery>({ text: "" });
  const [, tick] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const opener = (text?: string) => {
      setOpen(true);
      if (text !== undefined) setQ((p) => ({ ...p, text }));
      setTimeout(() => input.current?.select(), 0);
    };
    findBarOpeners.set(editor, opener);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        const sel = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ");
        opener(sel && !sel.includes("\n") ? sel : undefined);
      }
    };
    const dom = editor.view.dom.closest(".qv") as HTMLElement | null;
    dom?.addEventListener("keydown", onKey);
    const onTr = () => tick((n) => n + 1);
    editor.on("transaction", onTr);
    return () => {
      findBarOpeners.delete(editor);
      dom?.removeEventListener("keydown", onKey);
      editor.off("transaction", onTr);
    };
  }, [editor]);

  useEffect(() => {
    if (editor.isDestroyed) return;
    setFind(editor, { query: open ? q : null, current: 0 });
    if (open && q.text) setTimeout(() => goTo(editor, 0), 0);
  }, [open, q.text, q.caseSensitive, q.wholeWord, q.regex]);

  if (!open) return null;
  const st = findKey.getState(editor.state);
  const n = st?.matches.length ?? 0;
  const close = () => {
    setOpen(false);
    editor.commands.focus(null, { scrollIntoView: false });
  };
  const toggle = (k: "caseSensitive" | "wholeWord" | "regex", label: string, title: string) => (
    <button className={`find-toggle ${q[k] ? "on" : ""}`} title={title} onClick={() => setQ((p) => ({ ...p, [k]: !p[k] }))}>
      {label}
    </button>
  );
  return (
    <div className="qv-findbar">
      <div className="find-input">
        <input
          ref={input}
          autoFocus
          value={q.text}
          placeholder="찾기"
          onChange={(e) => setQ((p) => ({ ...p, text: e.target.value }))}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") goTo(editor, (st?.current ?? 0) + (e.shiftKey ? -1 : 1));
            if (e.key === "Escape") close();
          }}
        />
        {toggle("caseSensitive", "Aa", "대소문자 구분")}
        {toggle("wholeWord", "ab", "단어 단위로")}
        {toggle("regex", ".*", "정규식")}
      </div>
      <span className="find-count">{q.text ? (n ? `${(st?.current ?? 0) + 1}/${n}` : "결과 없음") : ""}</span>
      <button className="btn btn-icon" title="이전 (⇧↩)" disabled={!n} onClick={() => goTo(editor, (st?.current ?? 0) - 1)}>
        ↑
      </button>
      <button className="btn btn-icon" title="다음 (↩)" disabled={!n} onClick={() => goTo(editor, (st?.current ?? 0) + 1)}>
        ↓
      </button>
      <button className="btn btn-icon" title="닫기 (Esc)" onClick={close}>
        ×
      </button>
    </div>
  );
}
