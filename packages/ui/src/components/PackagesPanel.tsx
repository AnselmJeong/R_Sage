// The Packages view: installed packages (version, library, attached or not),
// update checks, CRAN search and install from CRAN, Bioconductor, GitHub or a
// local file.

import { useEffect, useMemo, useState } from "react";
import type { CranPackage } from "@rsage/shared";
import { host } from "../host/client";
import { useStore } from "../store";
import {
  checkUpdates,
  installPackages,
  packageHelp,
  refreshPackages,
  removePackages,
  setAttached,
  updatePackages,
  usePackages,
  type InstallSource,
} from "../packages";
import { confirmDialog } from "./Dialogs";
import { pickFile } from "./FolderPicker";

export function PackagesPanel() {
  const { list, loading, error, outdated, checking, busy, needsRestart } = usePackages();
  const sessionGen = useStore((s) => s.session.generation);
  const sessionState = useStore((s) => s.session.state);
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<"installed" | "updates">("installed");
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!list && !loading) void refreshPackages();
  }, []);
  // A new session has a different set of attached packages.
  useEffect(() => {
    if (sessionState === "idle") {
      void refreshPackages();
      usePackages.setState({ needsRestart: [] });
    }
  }, [sessionGen]);

  const attached = useMemo(() => new Set(list?.attached ?? []), [list]);
  const loaded = useMemo(() => new Set(list?.loaded ?? []), [list]);
  const latest = useMemo(() => new Map((outdated ?? []).map((o) => [o.name, o.latest])), [outdated]);
  const f = filter.trim().toLowerCase();
  const rows = (list?.packages ?? []).filter(
    (p) => (tab === "installed" || latest.has(p.name)) && (!f || p.name.toLowerCase().includes(f) || p.title?.toLowerCase().includes(f)),
  );

  return (
    <div className="packages">
      <div className="side-header">
        <span>패키지</span>
        <span className="spacer" />
        <button className="btn btn-icon" title="설치" onClick={() => setInstalling(!installing)}>
          ＋
        </button>
        <button className="btn btn-icon" title="새로 고침" disabled={loading} onClick={() => void refreshPackages()}>
          ↻
        </button>
      </div>
      {installing && <InstallForm libPaths={list?.libPaths ?? []} onDone={() => setInstalling(false)} />}
      <div className="pkg-tools">
        <div className="seg">
          <button className={tab === "installed" ? "active" : ""} onClick={() => setTab("installed")}>
            설치됨 {list ? list.packages.length : ""}
          </button>
          <button
            className={tab === "updates" ? "active" : ""}
            onClick={() => {
              setTab("updates");
              if (!outdated && !checking) void checkUpdates();
            }}
          >
            업데이트 {outdated ? outdated.length : ""}
          </button>
        </div>
        <span className="spacer" />
        {tab === "updates" && (
          <>
            <button className="btn btn-small" disabled={checking} onClick={() => void checkUpdates()}>
              {checking ? "확인 중…" : "다시 확인"}
            </button>
            <button className="btn btn-small btn-primary" disabled={!outdated?.length || !!busy} onClick={() => void updatePackages(outdated!.map((o) => o.name))}>
              모두 업데이트
            </button>
          </>
        )}
      </div>
      <div className="pkg-filter">
        <input className="text-input" placeholder="설치된 패키지 찾기" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {busy && <div className="pkg-note">{busy}… (콘솔에서 진행 상황을 볼 수 있습니다)</div>}
      {needsRestart.length > 0 && (
        <div className="pkg-note warn">
          {needsRestart.join(", ")}: 이미 불러온 패키지라 R 세션을 다시 시작해야 바뀐 버전이 적용됩니다.
          <button className="btn btn-small" onClick={() => void host.call("session.restart", {})}>
            세션 재시작
          </button>
        </div>
      )}
      {error && <div className="pkg-note err">{error}</div>}
      {tab === "updates" && outdated && !outdated.length && <div className="empty muted">모든 패키지가 최신입니다.</div>}
      <div className="pkg-list">
        {loading && !list && <div className="empty muted">패키지 목록을 읽는 중…</div>}
        {rows.map((p) => (
          <div key={p.name} className="pkg-row" title={`${p.title ?? ""}\n${p.libPath}`}>
            <input
              type="checkbox"
              title={attached.has(p.name) ? "해제 (detach)" : "불러오기 (library)"}
              checked={attached.has(p.name)}
              disabled={!!busy || p.name === "base"}
              onChange={(e) => void setAttached(p.name, e.target.checked)}
            />
            <div className="pkg-main">
              <div className="pkg-line">
                <span className="pkg-name" onClick={() => packageHelp(p.name)}>
                  {p.name}
                </span>
                <span className="muted small">{p.version}</span>
                {latest.has(p.name) && <span className="pkg-new">→ {latest.get(p.name)}</span>}
                {!attached.has(p.name) && loaded.has(p.name) && <span className="muted small" title="네임스페이스만 불러온 상태">로드됨</span>}
              </div>
              {p.title && <div className="muted small ellipsis">{p.title}</div>}
            </div>
            <div className="pkg-actions">
              {latest.has(p.name) && (
                <button className="btn btn-icon" title="업데이트" disabled={!!busy} onClick={() => void updatePackages([p.name])}>
                  ↑
                </button>
              )}
              <button
                className="btn btn-icon"
                title="삭제"
                disabled={!!busy}
                onClick={async () => {
                  if (await confirmDialog({ title: "패키지 삭제", message: `${p.name} 패키지를 ${p.libPath}에서 삭제합니다.`, confirm: "삭제", danger: true }))
                    void removePackages([p.name]);
                }}
              >
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>
      {list && (
        <div className="pkg-libs muted small">
          {list.libPaths.map((l, i) => (
            <div key={l} className="ellipsis" title={l}>
              {i === 0 ? "설치 위치: " : "　　　　 "}
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InstallForm({ libPaths, onDone }: { libPaths: string[]; onDone: () => void }) {
  const [source, setSource] = useState<InstallSource>("cran");
  const [text, setText] = useState("");
  const [lib, setLib] = useState("");
  const [deps, setDeps] = useState(true);
  const [hits, setHits] = useState<CranPackage[] | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const pkgs = usePackages((s) => s.list?.packages);
  const installed = useMemo(() => new Set(pkgs?.map((p) => p.name)), [pkgs]);

  // CRAN search as you type (the index is downloaded once a day).
  useEffect(() => {
    const term = text.split(/[,\s]+/).pop() ?? "";
    if (source !== "cran" || term.length < 2) return setHits(null);
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        setHits(await host.call("packages.searchCran", { query: term, limit: 30 }));
        setSearchErr(null);
      } catch (e) {
        setSearchErr((e as Error).message);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [text, source]);

  const names = text.split(/[,\s]+/).filter(Boolean);
  const pick = (name: string) => {
    const parts = text.split(/[,\s]+/).filter(Boolean);
    parts[parts.length ? parts.length - 1 : 0] = name;
    setText(parts.join(", ") + ", ");
  };
  const placeholder = { cran: "패키지 이름 (쉼표로 여러 개)", bioc: "Bioconductor 패키지 이름", github: "사용자/저장소 (예: tidyverse/ggplot2)", file: "패키지 파일 경로 (.tar.gz, .tgz)" }[source];

  return (
    <div className="pkg-install">
      <div className="row">
        <select className="text-input" value={source} onChange={(e) => setSource(e.target.value as InstallSource)}>
          <option value="cran">CRAN</option>
          <option value="bioc">Bioconductor</option>
          <option value="github">GitHub</option>
          <option value="file">로컬 파일</option>
        </select>
        {source === "file" && (
          <button
            className="btn btn-small"
            onClick={async () => {
              const p = await pickFile("패키지 파일", ["gz", "tgz", "zip"]);
              if (p) setText(p);
            }}
          >
            찾아보기
          </button>
        )}
      </div>
      <input className="text-input" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      {source === "cran" && (searching || hits || searchErr) && (
        <div className="pkg-hits">
          {searchErr && <div className="err small">CRAN 검색 실패: {searchErr}</div>}
          {hits?.map((h) => (
            <div key={h.name} className="pkg-hit" onClick={() => pick(h.name)} title={h.title}>
              <strong>{h.name}</strong> <span className="muted small">{h.version}</span>
              {installed.has(h.name) && <span className="muted small"> · 설치됨</span>}
              {h.title && <div className="muted small ellipsis">{h.title}</div>}
            </div>
          ))}
          {hits && !hits.length && <div className="muted small">일치하는 패키지가 없습니다.</div>}
        </div>
      )}
      <div className="row">
        <select className="text-input" value={lib} onChange={(e) => setLib(e.target.value)} title="설치할 라이브러리">
          <option value="">기본 라이브러리{libPaths[0] ? ` (${libPaths[0]})` : ""}</option>
          {libPaths.slice(1).map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {source === "cran" && (
        <label className="small">
          <input type="checkbox" checked={deps} onChange={(e) => setDeps(e.target.checked)} /> 필요한 패키지(의존성)도 함께 설치
        </label>
      )}
      <div className="dialog-actions">
        <button className="btn btn-small" onClick={onDone}>
          닫기
        </button>
        <button
          className="btn btn-small btn-primary"
          disabled={!names.length}
          onClick={() => {
            void installPackages(names, { source, lib: lib || undefined, dependencies: deps });
            setText("");
            setHits(null);
          }}
        >
          설치
        </button>
      </div>
    </div>
  );
}
