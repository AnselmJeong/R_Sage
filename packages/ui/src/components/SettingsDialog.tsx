import { useEffect, useState } from "react";
import { create } from "zustand";
import type { ProjectSettings } from "@rsage/shared";
import { host } from "../host/client";
import { useStore } from "../store";
import { EDITOR_FONTS, useEditorPrefs } from "../editor/prefs";

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
  if (!open) return null;
  const close = () => useSettings.setState({ open: false });

  const save = async () => {
    if (!project) return close();
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
        <h3>설정</h3>
        <EditorSettings />
        {project && (
          <>
            <h4>프로젝트</h4>
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
            <div>
              <div className="label">패키지 라이브러리 경로 (.libPaths())</div>
              {libPaths ? (
                <pre className="small">{libPaths.join("\n")}</pre>
              ) : (
                <div className="muted small">R 세션이 실행 중일 때 표시됩니다.</div>
              )}
            </div>
          </>
        )}
        <div className="dialog-actions">
          {project ? (
            <>
              <button className="btn" onClick={close}>
                취소
              </button>
              <button className="btn btn-primary" onClick={save}>
                저장
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={close}>
              닫기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The editor's few app-wide options. They apply as soon as they change. */
function EditorSettings() {
  const p = useEditorPrefs();
  const [air, setAir] = useState<string | null | undefined>();
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    host.call("format.status", {}).then((r) => setAir(r.air)).catch(() => setAir(null));
  }, []);
  const set = (patch: Partial<typeof p>) => useEditorPrefs.setState(patch);
  return (
    <div className="settings-editor">
      <h4>편집기</h4>
      <div className="settings-row">
        <label>
          글꼴
          <select value={p.font} onChange={(e) => set({ font: e.target.value })}>
            {EDITOR_FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
                {f === "Fira Code" ? " (기본)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-size">
          크기
          <input
            className="text-input"
            type="number"
            min={10}
            max={24}
            value={p.fontSize}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n >= 10 && n <= 24) set({ fontSize: n });
            }}
          />
        </label>
      </div>
      <div className="settings-sample" style={{ fontFamily: "var(--mono)", fontSize: p.fontSize, fontVariantLigatures: p.ligatures ? "normal" : "none" }}>
        {"df |> filter(x >= 1, y != 0) -> out  # 한글"}
      </div>
      <label className="check-row">
        <input type="checkbox" checked={p.ligatures} onChange={(e) => set({ ligatures: e.target.checked })} />
        합자 쓰기 (-&gt;, |&gt;, &gt;= 같은 기호를 한 글자처럼)
      </label>
      <label className="check-row">
        <input type="checkbox" checked={p.formatOnSave} onChange={(e) => set({ formatOnSave: e.target.checked })} />
        저장할 때 R 코드 정리 (.R 파일, .qmd의 R 청크)
      </label>
      <div className="muted small settings-air">
        {air === undefined
          ? "Air 확인 중…"
          : air
            ? `Air ${air}로 정리합니다.`
            : "정리에는 Posit의 Air를 씁니다. 처음 저장할 때 자동으로 내려받습니다."}
        {air === null && (
          <button
            className="btn btn-small"
            disabled={installing}
            onClick={async () => {
              setInstalling(true);
              try {
                setAir((await host.call("format.installAir", {})).air);
              } catch (e) {
                useStore.getState().notify((e as Error).message, "error");
              } finally {
                setInstalling(false);
              }
            }}
          >
            {installing ? "내려받는 중…" : "지금 내려받기"}
          </button>
        )}
      </div>
    </div>
  );
}
