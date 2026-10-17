import { useState } from "react";
import { host } from "../host/client";
import { useStore } from "../store";
import { runCommand } from "../commands";

function fmtBytes(b?: number) {
  if (!b) return "";
  if (b > 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  return `${Math.round(b / 1e6)} MB`;
}

const STATE_LABEL: Record<string, string> = {
  stopped: "R 꺼짐",
  starting: "R 시작 중",
  idle: "대기",
  busy: "실행 중",
  interrupting: "중단 중",
  restarting: "재시작 중",
  exited: "R 종료됨",
};

export function StatusBar() {
  const session = useStore((s) => s.session);
  const rList = useStore((s) => s.rList);
  const lsp = useStore((s) => s.lspRunning);
  const project = useStore((s) => s.project);
  const [menu, setMenu] = useState(false);

  const switchR = async (home: string) => {
    setMenu(false);
    try {
      if (project) await host.call("project.updateSettings", { settings: { rHome: home } });
      else await host.call("r.setDefault", { home });
      if (session.state !== "stopped") await host.call("session.restart", { rHome: home });
    } catch (e) {
      useStore.getState().notify((e as Error).message, "error");
    }
  };

  const current = rList.find((r) => r.home === session.rHome);

  return (
    <div className="statusbar">
      <div className="sb-item sb-clickable" onClick={() => setMenu((m) => !m)} title="R 버전 전환">
        <span className={`dot dot-${session.state}`} />
        {session.rVersion ? `R ${session.rVersion}` : current ? `R ${current.version}` : "R"}
        {current ? <span className="muted"> · {current.source}</span> : null}
      </div>
      <div className="sb-item">{STATE_LABEL[session.state]}</div>
      {session.cwd && (
        <div className="sb-item muted ellipsis" title="작업 폴더">
          {session.cwd}
        </div>
      )}
      <span className="spacer" />
      {session.memoryBytes ? <div className="sb-item muted" title="R 프로세스 메모리">{fmtBytes(session.memoryBytes)}</div> : null}
      <div className={`sb-item ${lsp ? "" : "muted"}`} title="Ark 언어 서버 (자동완성·진단)">
        LSP {lsp ? "●" : "○"}
      </div>
      {session.state === "busy" && (
        <div className="sb-item sb-clickable" onClick={() => host.call("session.interrupt")}>
          ■ 중단
        </div>
      )}
      <div className="sb-item sb-clickable" onClick={() => runCommand("session.restart")} title="R 재시작">
        ↻
      </div>
      {menu && (
        <div className="sb-menu" onMouseLeave={() => setMenu(false)}>
          <div className="menu-title">사용할 R 선택</div>
          {rList.map((r) => (
            <div key={r.home} className={`menu-item ${r.home === session.rHome ? "checked" : ""}`} onClick={() => switchR(r.home)}>
              R {r.version} <span className="muted">{r.source}</span>
              {r.tooOld && <span className="warn"> (4.2 미만)</span>}
              <div className="muted small">{r.home}</div>
            </div>
          ))}
          <div className="menu-item" onClick={() => { setMenu(false); void runCommand("r.addManual"); }}>
            경로 직접 지정…
          </div>
          <div className="menu-item" onClick={async () => { useStore.setState({ rList: await host.call("r.list", { refresh: true }) }); }}>
            다시 찾기
          </div>
        </div>
      )}
    </div>
  );
}
