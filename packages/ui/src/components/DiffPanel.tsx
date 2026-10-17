// A read-only side-by-side diff of one file: index vs. working tree, HEAD vs.
// index, or a commit vs. its parent.

import { useEffect, useRef, useState } from "react";
import type { IDockviewPanelProps } from "dockview";
import { host } from "../host/client";
import { languageFor, monaco } from "../editor/monaco";
import { openFile } from "../editor/files";
import type { DiffParams } from "../git";

export function DiffPanel(props: IDockviewPanelProps<DiffParams>) {
  const { path, origPath, mode, hash } = props.params;
  const el = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const [same, setSame] = useState(false);

  useEffect(() => {
    const editor = monaco.editor.createDiffEditor(el.current!, {
      theme: "rsage-dark",
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: true,
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
    });
    const lang = languageFor(path);
    const original = monaco.editor.createModel("", lang);
    const modified = monaco.editor.createModel("", lang);
    editor.setModel({ original, modified });
    let alive = true;
    const load = async () => {
      try {
        const d = await host.call("git.diff", { path, origPath, mode, hash });
        if (!alive) return;
        original.setValue(d.original);
        modified.setValue(d.modified);
        setSame(d.original === d.modified);
        setError(undefined);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    // A working-tree diff follows the file as it is saved.
    const off = mode === "working" ? host.on("fs.changed", ({ paths }) => paths.includes(path) && void load()) : () => {};
    return () => {
      alive = false;
      off();
      editor.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [path, origPath, mode, hash]);

  return (
    <div className="diff-panel">
      <div className="diff-bar">
        <span className="muted small ellipsis" title={path}>
          {mode === "working" ? "스테이징된 내용 ↔ 작업 파일" : mode === "staged" ? "마지막 커밋 ↔ 스테이징된 내용" : "이전 커밋 ↔ 이 커밋"}
        </span>
        {same && !error && <span className="muted small">차이 없음</span>}
        <span className="spacer" />
        <button className="btn btn-small" onClick={() => void openFile(path)}>
          파일 열기
        </button>
      </div>
      {error && <div className="diff-error">{error}</div>}
      <div className="diff-host" ref={el} />
    </div>
  );
}
