// The Outline view: headings and code cells of the current document (or the
// sections and functions of an R script). Click to jump; follows the cursor.

import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { editorsByPath, getModel } from "../editor/files";
import { reveal, useEditorModes } from "../editor/views";
import { outlineFor, type OutlineItem } from "../outline";

const flatten = (items: OutlineItem[]): OutlineItem[] => items.flatMap((i) => [i, ...flatten(i.children)]);

export function OutlinePanel() {
  const path = useStore((s) => s.activeFile);
  const mode = useEditorModes((s) => (path ? s[path] : undefined));
  const [text, setText] = useState<string | null>(null);
  const [cursorLine, setCursorLine] = useState(0);
  const [closed, setClosed] = useState<Set<string>>(new Set());

  // Follow the document as it changes (the visual editor writes into the same model).
  useEffect(() => {
    if (!path) return setText(null);
    let model = getModel(path);
    let sub: { dispose(): void } | undefined;
    let t: ReturnType<typeof setTimeout> | undefined;
    const attach = () => {
      model = getModel(path);
      if (!model) return false;
      setText(model.getValue());
      sub = model.onDidChangeContent(() => {
        clearTimeout(t);
        t = setTimeout(() => setText(model!.getValue()), 300);
      });
      return true;
    };
    // The model may still be loading when the tab becomes active.
    const retry = attach() ? undefined : setInterval(() => attach() && clearInterval(retry), 200);
    return () => {
      clearInterval(retry);
      clearTimeout(t);
      sub?.dispose();
    };
  }, [path]);

  useEffect(() => {
    if (!path) return;
    const ed = editorsByPath.get(path);
    if (!ed) return;
    setCursorLine(ed.getPosition()?.lineNumber ?? 0);
    const d = ed.onDidChangeCursorPosition((e) => setCursorLine(e.position.lineNumber));
    return () => d.dispose();
  }, [path, mode, text === null]);

  const items = useMemo(() => (path && text !== null ? outlineFor(path, text) : null), [path, text]);
  // The item whose range holds the cursor (source view only).
  const current = useMemo(() => {
    if (!items || mode === "visual") return undefined;
    let best: OutlineItem | undefined;
    for (const it of flatten(items)) if (it.line <= cursorLine && (!best || it.line >= best.line)) best = it;
    return best;
  }, [items, cursorLine, mode]);

  if (!path) return <Shell>열린 문서가 없습니다.</Shell>;
  if (!items) return <Shell>이 파일 형식은 개요를 보여 주지 않습니다.</Shell>;
  if (!items.length) return <Shell>제목이나 코드 셀이 아직 없습니다.</Shell>;

  const key = (it: OutlineItem) => `${it.kind}:${it.line}:${it.label}`;
  const render = (list: OutlineItem[], depth: number): React.ReactNode =>
    list.map((it) => {
      const k = key(it);
      const hasKids = it.children.length > 0;
      const isClosed = closed.has(k);
      return (
        <div key={k}>
          <div
            className={`outline-row outline-${it.kind} ${current === it ? "current" : ""}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            title={`${it.line}행`}
            onClick={() => void reveal(path, { line: it.line, block: it.block })}
          >
            <span
              className="chev"
              onClick={(e) => {
                if (!hasKids) return;
                e.stopPropagation();
                const c = new Set(closed);
                if (isClosed) c.delete(k);
                else c.add(k);
                setClosed(c);
              }}
            >
              {hasKids ? (isClosed ? "▸" : "▾") : ""}
            </span>
            <span className="outline-glyph">{it.kind === "cell" ? "{}" : it.kind === "function" ? "ƒ" : it.kind === "meta" ? "≡" : ""}</span>
            <span className="ellipsis outline-label">{it.label}</span>
            {it.detail && <span className="muted small ellipsis outline-detail">{it.detail}</span>}
          </div>
          {hasKids && !isClosed && render(it.children, depth + 1)}
        </div>
      );
    });

  return (
    <div className="outline">
      <div className="side-header">
        <span>개요</span>
        <span className="spacer" />
        <button
          className="btn btn-icon"
          title={closed.size ? "모두 펼치기" : "모두 접기"}
          onClick={() => setClosed(closed.size ? new Set() : new Set(flatten(items).filter((i) => i.children.length).map(key)))}
        >
          {closed.size ? "⊞" : "⊟"}
        </button>
      </div>
      <div className="outline-file muted small ellipsis">{path.split("/").pop()}</div>
      <div className="outline-scroll">{render(items, 0)}</div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="outline">
      <div className="side-header">
        <span>개요</span>
      </div>
      <div className="empty muted">{children}</div>
    </div>
  );
}
