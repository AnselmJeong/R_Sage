// The Search view, modelled on Positron's: search the project (or only the
// current file) as you type, with match case / whole word / regex toggles,
// replace-all, and results grouped by file.

import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchMatch } from "@rsage/shared";
import { host } from "../host/client";
import { useStore } from "../store";
import { getModel, reloadFromDisk } from "../editor/files";
import { isVisual, reveal, visualEditors } from "../editor/views";
import { findBarOpeners, findRegex } from "../quarto/find";
import { blockAtLine } from "../outline";
import { confirmDialog } from "./Dialogs";
import { iconFor } from "./FileTree";

type Scope = "project" | "file";

/** Asks the Search view to focus its box (and optionally fill it). */
export const searchHooks: { focus?: (text?: string) => void } = {};

function searchModel(path: string, query: string, o: { caseSensitive: boolean; wholeWord: boolean; regex: boolean }): SearchMatch[] {
  const model = getModel(path);
  const re = findRegex({ text: query, ...o });
  if (!model || !re) return [];
  const out: SearchMatch[] = [];
  model
    .getValue()
    .split("\n")
    .forEach((text, i) => {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) && out.length < 2000) {
        if (!m[0]) {
          re.lastIndex++;
          continue;
        }
        out.push({ path, line: i + 1, column: m.index + 1, length: m[0].length, text: text.replace(/\r$/, "") });
      }
    });
  return out;
}

/** The line around a match, cut so the match stays visible in a narrow sidebar. */
function Snippet({ m }: { m: SearchMatch }) {
  const start = m.column - 1;
  const len = m.length ?? 0;
  const lead = m.text.slice(0, start).replace(/^\s+/, "");
  const cut = lead.length > 24;
  return (
    <>
      {cut ? "…" + lead.slice(-24) : lead}
      <mark>{m.text.slice(start, start + len)}</mark>
      {m.text.slice(start + len, start + len + 160)}
    </>
  );
}

export function SearchPanel() {
  const root = useStore((s) => s.project?.path ?? "");
  const activeFile = useStore((s) => s.activeFile);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [scope, setScope] = useState<Scope>("project");
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [result, setResult] = useState<{ matches: SearchMatch[]; truncated: boolean } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    searchHooks.focus = (text) => {
      if (text !== undefined) setQuery(text);
      setTimeout(() => input.current?.select(), 0);
    };
    return () => {
      searchHooks.focus = undefined;
    };
  }, []);

  const target = scope === "file" ? activeFile : undefined;
  const run = async () => {
    const id = ++seq.current;
    setError(null);
    if (!query || !root) return setResult(null);
    if (regex) {
      try {
        new RegExp(query);
      } catch {
        return setError("정규식이 올바르지 않습니다.");
      }
    }
    if (scope === "file") {
      setResult(target ? { matches: searchModel(target, query, { caseSensitive, wholeWord, regex }), truncated: false } : null);
      return;
    }
    setBusy(true);
    try {
      const r = await host.call("search.text", { query, regex, caseSensitive, wholeWord, glob: include || undefined, exclude: exclude || undefined });
      if (id === seq.current) setResult(r);
    } catch (e) {
      if (id === seq.current) setError((e as Error).message);
    } finally {
      if (id === seq.current) setBusy(false);
    }
  };

  // Search as you type.
  useEffect(() => {
    const t = setTimeout(run, query.length > 2 ? 200 : 400);
    return () => clearTimeout(t);
  }, [query, regex, caseSensitive, wholeWord, scope, include, exclude, target, root]);

  const byFile = useMemo(() => {
    const m = new Map<string, SearchMatch[]>();
    for (const x of result?.matches ?? []) m.set(x.path, [...(m.get(x.path) ?? []), x]);
    return m;
  }, [result]);

  const open = async (m: SearchMatch) => {
    if (/\.qmd$/i.test(m.path) && isVisual(m.path)) {
      const text = getModel(m.path)?.getValue() ?? "";
      await reveal(m.path, { line: m.line, block: blockAtLine(text, m.line) });
      const ve = visualEditors.get(m.path);
      if (ve) findBarOpeners.get(ve)?.(query);
      return;
    }
    await reveal(m.path, { line: m.line, column: m.column, length: m.length });
  };

  const replaceAll = async () => {
    const paths = [...byFile.keys()];
    if (!paths.length) return;
    const total = result?.matches.length ?? 0;
    if (scope === "file" && target) {
      // In the editor's model, so it can be undone with ⌘Z.
      const model = getModel(target);
      const re = findRegex({ text: query, caseSensitive, wholeWord, regex });
      if (!model || !re) return;
      const text = model.getValue();
      const next = regex ? text.replace(re, replacement) : text.replace(re, () => replacement);
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: next }], () => null);
      useStore.getState().notify(`${total}곳을 바꿨습니다. ⌘Z로 되돌릴 수 있습니다.`);
      return run();
    }
    const dirty = paths.filter((p) => useStore.getState().openFiles[p]?.dirty);
    if (dirty.length) {
      useStore.getState().notify("저장하지 않은 파일이 있습니다. 먼저 저장하세요.", "error");
      return;
    }
    const ok = await confirmDialog({
      title: "모두 바꾸기",
      message: `${paths.length}개 파일의 ${total}곳에서 "${query}"을(를) "${replacement}"(으)로 바꿉니다. 파일에 바로 저장되며 되돌릴 수 없습니다.`,
      confirm: "바꾸기",
      danger: true,
    });
    if (!ok) return;
    const r = await host.call("search.replace", { query, replacement, regex, caseSensitive, wholeWord, paths });
    for (const p of paths) if (useStore.getState().openFiles[p]) await reloadFromDisk(p);
    useStore.getState().notify(`${r.files}개 파일에서 ${r.replacements}곳을 바꿨습니다.`);
    await run();
  };

  const toggle = (on: boolean, set: (v: boolean) => void, label: string, title: string) => (
    <button className={`find-toggle ${on ? "on" : ""}`} title={title} onClick={() => set(!on)}>
      {label}
    </button>
  );
  const rel = (p: string) => (root && p.startsWith(root + "/") ? p.slice(root.length + 1) : p);
  const n = result?.matches.length ?? 0;

  return (
    <div className="search">
      <div className="side-header">
        <span>검색</span>
        <span className="spacer" />
        <button className="btn btn-icon" title="다시 검색" onClick={run}>
          ↻
        </button>
        <button
          className="btn btn-icon"
          title="결과 지우기"
          onClick={() => {
            setQuery("");
            setResult(null);
          }}
        >
          ⌫
        </button>
        <button
          className="btn btn-icon"
          title={collapsed.size ? "모두 펼치기" : "모두 접기"}
          onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(byFile.keys()))}
        >
          {collapsed.size ? "⊞" : "⊟"}
        </button>
      </div>
      <div className="search-form">
        <div className="search-row">
          <button className="btn btn-icon search-chevron" title="바꾸기 열기/닫기" onClick={() => setShowReplace(!showReplace)}>
            {showReplace ? "▾" : "▸"}
          </button>
          <div className="search-fields">
            <div className="find-input">
              <input
                ref={input}
                placeholder="검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && run()}
                autoFocus
              />
              {toggle(caseSensitive, setCase, "Aa", "대소문자 구분")}
              {toggle(wholeWord, setWholeWord, "ab", "단어 단위로")}
              {toggle(regex, setRegex, ".*", "정규식")}
            </div>
            {showReplace && (
              <div className="replace-row">
                <div className="find-input">
                  <input placeholder="바꾸기" value={replacement} onChange={(e) => setReplacement(e.target.value)} />
                </div>
                <button className="btn btn-icon" title="모두 바꾸기" disabled={!n} onClick={replaceAll}>
                  ⇄
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="search-scope">
          <div className="seg">
            <button className={scope === "project" ? "active" : ""} onClick={() => setScope("project")}>
              프로젝트 전체
            </button>
            <button className={scope === "file" ? "active" : ""} onClick={() => setScope("file")} title={activeFile}>
              현재 파일
            </button>
          </div>
          <span className="spacer" />
          {scope === "project" && (
            <button className={`btn btn-icon ${showDetails ? "active" : ""}`} title="포함/제외할 파일" onClick={() => setShowDetails(!showDetails)}>
              …
            </button>
          )}
        </div>
        {scope === "project" && showDetails && (
          <div className="search-details">
            <label className="muted small">포함할 파일</label>
            <input className="text-input" placeholder="예: *.qmd, R/**" value={include} onChange={(e) => setInclude(e.target.value)} />
            <label className="muted small">제외할 파일</label>
            <input className="text-input" placeholder="예: *.html, output/**" value={exclude} onChange={(e) => setExclude(e.target.value)} />
          </div>
        )}
      </div>
      <div className="search-results">
        {error && <div className="search-summary err">{error}</div>}
        {scope === "file" && !activeFile && <div className="search-summary muted">열린 파일이 없습니다.</div>}
        {busy && !result && <div className="search-summary muted">검색 중…</div>}
        {result && query && (
          <div className="search-summary muted">
            {n ? `${n}개 결과 · ${byFile.size}개 파일` : "결과 없음"}
            {result.truncated ? " (일부만 표시)" : ""}
          </div>
        )}
        {[...byFile.entries()].map(([path, ms]) => {
          const name = path.split("/").pop()!;
          const dir = rel(path).slice(0, -name.length - 1);
          const ic = iconFor({ name, path, kind: "file" }, false);
          const isClosed = collapsed.has(path);
          const dirty = useStore.getState().openFiles[path]?.dirty;
          return (
            <div key={path} className="search-file">
              <div
                className="search-file-row"
                title={rel(path)}
                onClick={() => {
                  const c = new Set(collapsed);
                  if (isClosed) c.delete(path);
                  else c.add(path);
                  setCollapsed(c);
                }}
              >
                <span className="chev">{isClosed ? "▸" : "▾"}</span>
                <span className={`tree-icon ${ic.cls}`}>{ic.glyph}</span>
                <span className={`ellipsis ${dirty ? "dirty-name" : ""}`}>{name}</span>
                {dir && <span className="muted small ellipsis search-dir">{dir}</span>}
                <span className="spacer" />
                <span className="count-badge">{ms.length}</span>
              </div>
              {!isClosed &&
                ms.map((m, i) => (
                  <div key={i} className="search-hit" title={`${m.line}행`} onClick={() => void open(m)}>
                    <Snippet m={m} />
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
