import { useState } from "react";
import type { SearchMatch } from "@rsage/shared";
import { host } from "../host/client";
import { useStore } from "../store";
import { openFile, reloadFromDisk } from "../editor/files";
import { confirmDialog } from "./Dialogs";

export function SearchPanel() {
  const root = useStore((s) => s.project?.path ?? "");
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCase] = useState(false);
  const [glob, setGlob] = useState("");
  const [result, setResult] = useState<{ matches: SearchMatch[]; truncated: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!query) return setResult(null);
    setBusy(true);
    try {
      setResult(await host.call("search.text", { query, regex, caseSensitive, glob: glob || undefined }));
    } catch (e) {
      useStore.getState().notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const byFile = new Map<string, SearchMatch[]>();
  for (const m of result?.matches ?? []) byFile.set(m.path, [...(byFile.get(m.path) ?? []), m]);

  const replaceAll = async () => {
    const paths = [...byFile.keys()];
    const dirty = paths.filter((p) => useStore.getState().openFiles[p]?.dirty);
    if (dirty.length) {
      useStore.getState().notify("저장하지 않은 파일이 있습니다. 먼저 저장하세요.", "error");
      return;
    }
    const ok = await confirmDialog({
      title: "모두 바꾸기",
      message: `${paths.length}개 파일에서 "${query}"을(를) "${replacement}"(으)로 바꿉니다.`,
      confirm: "바꾸기",
      danger: true,
    });
    if (!ok) return;
    const r = await host.call("search.replace", { query, replacement, regex, caseSensitive, paths });
    for (const p of paths) if (useStore.getState().openFiles[p]) await reloadFromDisk(p);
    useStore.getState().notify(`${r.files}개 파일에서 ${r.replacements}곳을 바꿨습니다.`);
    await run();
  };

  return (
    <div className="search">
      <div className="search-form">
        <input
          className="text-input"
          placeholder="프로젝트에서 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && run()}
          autoFocus
        />
        <div className="row">
          <label title="대소문자 구분">
            <input type="checkbox" checked={caseSensitive} onChange={(e) => setCase(e.target.checked)} /> Aa
          </label>
          <label title="정규식">
            <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> .*
          </label>
          <input className="text-input small" placeholder="파일 패턴 (예: *.R)" value={glob} onChange={(e) => setGlob(e.target.value)} />
        </div>
        <div className="row">
          <input className="text-input" placeholder="바꿀 내용" value={replacement} onChange={(e) => setReplacement(e.target.value)} />
          <button className="btn btn-small" disabled={!result?.matches.length} onClick={replaceAll}>
            모두 바꾸기
          </button>
        </div>
      </div>
      <div className="search-results">
        {busy && <div className="muted">검색 중…</div>}
        {result && (
          <div className="muted small">
            {result.matches.length}건 · {byFile.size}개 파일{result.truncated ? " (일부만 표시)" : ""}
          </div>
        )}
        {[...byFile.entries()].map(([path, ms]) => (
          <div key={path} className="search-file">
            <div className="search-file-name">{path.startsWith(root) ? path.slice(root.length + 1) : path}</div>
            {ms.map((m, i) => (
              <div key={i} className="search-hit" onClick={() => openFile(m.path, { line: m.line, column: m.column })}>
                <span className="muted">{m.line}</span> <code>{m.text.trim().slice(0, 200)}</code>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
