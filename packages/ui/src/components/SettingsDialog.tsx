import { useEffect, useState } from "react";
import { create } from "zustand";
import type { ProjectSettings } from "@rsage/shared";
import { host } from "../host/client";
import { useStore } from "../store";

export const useSettings = create<{ open: boolean }>(() => ({ open: false }));

export function SettingsDialog() {
  const open = useSettings((s) => s.open);
  const project = useStore((s) => s.project);
  const rList = useStore((s) => s.rList);
  const [draft, setDraft] = useState<ProjectSettings>({});
  const [libPaths, setLibPaths] = useState<string[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(project?.settings ?? {});
    host.call("session.libPaths").then(setLibPaths).catch(() => setLibPaths(null));
  }, [open, project]);
  if (!open || !project) return null;
  const close = () => useSettings.setState({ open: false });

  const save = async () => {
    const before = project.settings.rHome;
    const info = await host.call("project.updateSettings", { settings: draft });
    useStore.setState({ project: info });
    close();
    if (draft.rHome !== before && useStore.getState().session.state !== "stopped") {
      await host.call("session.restart", { rHome: draft.rHome });
    }
  };

  return (
    <div className="dialog-backdrop">
      <div className="dialog settings">
        <h3>프로젝트 설정</h3>
        <p className="muted small">{project.path}/.rsage/settings.json 에 저장됩니다.</p>
        <label>
          R 버전
          <select value={draft.rHome ?? ""} onChange={(e) => setDraft({ ...draft, rHome: e.target.value || undefined })}>
            <option value="">앱 기본값</option>
            {rList.map((r) => (
              <option key={r.home} value={r.home}>
                R {r.version} ({r.source}) {r.home}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quarto 경로
          <input className="text-input" placeholder="자동 탐색" value={draft.quartoPath ?? ""} onChange={(e) => setDraft({ ...draft, quartoPath: e.target.value || undefined })} />
        </label>
        <label>
          출력 폴더
          <input className="text-input" placeholder="_output" value={draft.outputDir ?? ""} onChange={(e) => setDraft({ ...draft, outputDir: e.target.value || undefined })} />
        </label>
        <label>
          AI 모델
          <input
            className="text-input"
            placeholder="claude-sonnet-5-5 (6단계에서 사용)"
            value={draft.ai?.model ?? ""}
            onChange={(e) => setDraft({ ...draft, ai: { ...draft.ai, model: e.target.value || undefined } })}
          />
        </label>
        <div>
          <div className="label">패키지 라이브러리 경로 (.libPaths())</div>
          {libPaths ? (
            <pre className="small">{libPaths.join("\n")}</pre>
          ) : (
            <div className="muted small">R 세션이 실행 중일 때 표시됩니다.</div>
          )}
        </div>
        <div className="dialog-actions">
          <button className="btn" onClick={close}>
            취소
          </button>
          <button className="btn btn-primary" onClick={save}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
