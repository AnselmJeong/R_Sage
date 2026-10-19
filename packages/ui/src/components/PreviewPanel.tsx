import { useEffect, useRef, useState } from "react";
import { host } from "../host/client";
import { openInEditor } from "../editor/files";
import { loadQuartoInfo, renderDocument, stopRender, useRender } from "../quarto/render";

/** The rendered document, with the render log below it. */
export function PreviewPanel() {
  const r = useRender();
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!r.quarto) void loadQuartoInfo();
  }, []);
  useEffect(() => {
    if (r.running || r.error) setShowLog(true);
    else if (r.url) setShowLog(false);
  }, [r.running, r.error, r.url]);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [r.log, showLog]);

  const name = r.output?.split("/").pop();
  return (
    <div className="preview-panel">
      <div className="preview-bar">
        <span className="muted small">
          {r.running ? "렌더링 중…" : r.error ? "렌더링 실패" : name ? name : "아직 렌더링한 문서가 없습니다"}
        </span>
        <span className="qv-spacer" />
        {r.running ? (
          <button className="btn btn-small" onClick={() => void stopRender()}>
            중단
          </button>
        ) : (
          r.file && (
            <button className="btn btn-small" onClick={() => void renderDocument(r.file!)} title="다시 렌더링">
              다시 렌더링
            </button>
          )
        )}
        {r.output && !r.running && !r.file && /\.html?$/i.test(r.output) && (
          <button className="btn btn-small" onClick={() => void openInEditor(r.output!)} title="HTML 소스를 편집기에서 엽니다">
            소스 보기
          </button>
        )}
        {r.output && !r.running && (
          <button className="btn btn-small" onClick={() => host.call("shell.openExternal", { path: r.output! })}>
            외부 앱으로 열기
          </button>
        )}
        <button className={`btn btn-small ${showLog ? "active" : ""}`} onClick={() => setShowLog(!showLog)}>
          로그
        </button>
      </div>
      {r.url && !r.running ? (
        <iframe className="preview-frame" key={`${r.url}#${r.stamp}`} src={r.url} title="미리보기" />
      ) : (
        !showLog && (
          <div className="preview-empty muted">
            {r.output && !r.url ? "이 형식은 앱 안에서 미리 볼 수 없습니다. 외부 앱으로 여세요." : ".qmd 파일에서 ‘렌더’를 누르면 결과가 여기에 나옵니다."}
            {r.quarto && !r.quarto.path && <p>Quarto가 설치되어 있지 않습니다. quarto.org에서 설치하세요.</p>}
            {r.quarto?.version && <p className="small">Quarto {r.quarto.version}</p>}
          </div>
        )
      )}
      {showLog && (
        <pre ref={logRef} className={`preview-log ${r.url && !r.running ? "split" : ""}`}>
          {r.log}
          {r.error && <span className="error">{"\n" + r.error}</span>}
        </pre>
      )}
    </div>
  );
}
