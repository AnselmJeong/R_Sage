import { useEffect, useState } from "react";
import { host } from "../host/client";
import { useStore } from "../store";
import { pickFolder } from "./FolderPicker";

export async function openProject(path: string) {
  try {
    const project = await host.call("project.open", { path });
    useStore.setState({ project });
  } catch (e) {
    useStore.getState().notify((e as Error).message, "error");
  }
}

// The workbench registers "project.new" only once a project is open, so the
// welcome screen creates the project itself.
async function newProject() {
  const p = await pickFolder("새 프로젝트를 만들 위치", true);
  if (!p) return;
  try {
    const project = await host.call("project.create", { path: p });
    useStore.setState({ project });
  } catch (e) {
    useStore.getState().notify((e as Error).message, "error");
  }
}

export function Welcome() {
  const recent = useStore((s) => s.recent);
  const rList = useStore((s) => s.rList);
  const app = useStore((s) => s.app);
  const [checks, setChecks] = useState<{ name: string; ok: boolean; detail: string }[]>([]);

  useEffect(() => {
    void host.call("app.diagnostics").then((d) => setChecks(d.checks));
  }, [rList.length]);

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <h1>R Sage</h1>
        <p className="muted">R 분석과 Quarto 보고서를 한 프로젝트에서.</p>
        <div className="welcome-actions">
          <button
            className="btn btn-primary"
            onClick={async () => {
              const p = await pickFolder("프로젝트 폴더 열기");
              if (p) await openProject(p);
            }}
          >
            폴더 열기
          </button>
          <button className="btn" onClick={newProject}>
            새 프로젝트
          </button>
        </div>
        {recent.length > 0 && (
          <section>
            <h2>최근 프로젝트</h2>
            {recent.map((r) => (
              <div key={r.path} className="recent-item" onClick={() => openProject(r.path)}>
                <strong>{r.name}</strong>
                <span className="muted small">{r.path}</span>
              </div>
            ))}
          </section>
        )}
        <section>
          <h2>환경</h2>
          {checks.map((c) => (
            <div key={c.name} className="check">
              <span className={c.ok ? "ok" : "warn"}>{c.ok ? "✓" : "!"}</span> <strong>{c.name}</strong>
              <pre className="muted small">{c.detail}</pre>
            </div>
          ))}
          {app && <div className="muted small">R Sage {app.version} · {app.platform} · {app.shell}</div>}
        </section>
      </div>
    </div>
  );
}
