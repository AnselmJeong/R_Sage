import { useEffect, useMemo, useState } from "react";
import type { ExecutionRecord } from "@rsage/shared";
import { host } from "../host/client";
import { useStore } from "../store";
import { openFile, runCode } from "../editor/files";

/** Run history: every execution with its id, origin, status and source. */
export function HistoryPanel() {
  const live = useStore((s) => s.executions);
  const project = useStore((s) => s.project?.path);
  const generation = useStore((s) => s.session.generation);
  const [persisted, setPersisted] = useState<ExecutionRecord[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    void host.call("history.list", { limit: 500 }).then(setPersisted);
  }, [project]);

  const records = useMemo(() => {
    const byId = new Map(persisted.map((r) => [r.id, r]));
    for (const r of Object.values(live)) byId.set(r.id, r);
    const q = filter.toLowerCase();
    return [...byId.values()]
      .filter((r) => r.origin !== "app" && (!q || r.code.toLowerCase().includes(q)))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 300);
  }, [persisted, live, filter]);

  return (
    <div className="history">
      <div className="panel-toolbar">
        <input className="text-input" placeholder="실행 이력 검색" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="history-list">
        {records.map((r) => (
          <div key={r.id} className={`history-item st-${r.status} ${r.generation < generation ? "stale" : ""}`}>
            <div className="history-meta">
              <span className={`badge badge-${r.status}`}>{statusLabel(r.status)}</span>
              <span className="muted">{new Date(r.startedAt).toLocaleTimeString()}</span>
              <span className="muted">{originLabel(r.origin)}</span>
              {r.generation < generation && <span className="muted">이전 세션</span>}
              {r.source && (
                <button className="c-srclink" onClick={() => openFile(r.source!.file, { line: r.source!.line })}>
                  {r.source.file.split("/").pop()}:{r.source.line}
                </button>
              )}
              <span className="spacer" />
              <button className="btn btn-small" title="다시 실행" onClick={() => runCode(r.code, r.source)}>
                ↻
              </button>
            </div>
            <pre className="history-code">{r.code.length > 600 ? r.code.slice(0, 600) + "…" : r.code}</pre>
          </div>
        ))}
        {records.length === 0 && <div className="empty">아직 실행한 코드가 없습니다.</div>}
      </div>
    </div>
  );
}

const statusLabel = (s: ExecutionRecord["status"]) =>
  ({ queued: "대기", running: "실행 중", ok: "완료", error: "오류", aborted: "중단" })[s];
const originLabel = (o: ExecutionRecord["origin"]) => ({ console: "콘솔", editor: "에디터", app: "앱", ai: "AI" })[o];
