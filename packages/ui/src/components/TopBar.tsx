// The bar across the top of the window: New and Open menus, Save, and the
// app-wide buttons. It doubles as the macOS title bar (draggable).

import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { runCommand } from "../commands";
import { activeEditor, saveFile } from "../editor/files";
import { newDocument, newProjectDialog, openFileDialog, openFolderDialog, openProject } from "../project";
import type { AnalysisInstance } from "@rsage/shared";
import { newAnalysis, openAnalysisTab, useAnalyses } from "../analysis";

type Item = { label: string; hint?: string; run: () => void } | "-" | { heading: string };

function Menu({ label, icon, items }: { label: string; icon: JSX.Element; items: () => Item[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="tb-menu" ref={ref}>
      <button className={`tb-btn ${open ? "active" : ""}`} onClick={() => setOpen(!open)}>
        {icon}
        <span>{label}</span>
        <span className="tb-caret">▾</span>
      </button>
      {open && (
        <div className="tb-dropdown">
          {items().map((it, i) =>
            it === "-" ? (
              <div key={i} className="tb-sep" />
            ) : "heading" in it ? (
              <div key={i} className="tb-heading">
                {it.heading}
              </div>
            ) : (
              <div
                key={i}
                className="menu-item"
                onClick={() => {
                  setOpen(false);
                  it.run();
                }}
              >
                <span className="ellipsis">{it.label}</span>
                {it.hint && <span className="muted small tb-hint">{it.hint}</span>}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

const Icon = {
  plus: (
    <svg viewBox="0 0 24 24" className="tb-icon">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  ),
  folder: (
    <svg viewBox="0 0 24 24" className="tb-icon">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" className="tb-icon">
      <path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3" />
    </svg>
  ),
  save: (
    <svg viewBox="0 0 24 24" className="tb-icon">
      <path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
      <path d="M8 4v5h7V4M8 20v-6h8v6" />
    </svg>
  ),
};

export function TopBar() {
  const project = useStore((s) => s.project);
  const recent = useStore((s) => s.recent);
  const dirty = useStore((s) => (s.activeFile ? !!s.openFiles[s.activeFile]?.dirty : false));
  const modules = useAnalyses((s) => s.modules);
  const instances = useAnalyses((s) => s.instances);

  return (
    <div className="titlebar">
      <Menu
        label="New"
        icon={Icon.plus}
        items={() => [
          { label: "Quarto 문서", hint: "⌘N", run: () => void newDocument("qmd") },
          { label: "R 스크립트", hint: "⌥⌘N", run: () => void newDocument("R") },
          "-",
          { label: "새 프로젝트…", run: () => void newProjectDialog() },
        ]}
      />
      <Menu
        label="Open"
        icon={Icon.folder}
        items={() => [
          { label: "파일 열기…", hint: "⌘O", run: () => void openFileDialog() },
          { label: "폴더 열기…", run: () => void openFolderDialog() },
          ...(recent.length ? (["-", { heading: "최근 프로젝트" }] as Item[]) : []),
          ...recent
            .filter((r) => r.path !== project?.path)
            .slice(0, 8)
            .map((r) => ({ label: r.name, hint: r.path.replace(/^\/Users\/[^/]+/, "~"), run: () => void openProject(r.path) })),
        ]}
      />
      <Menu
        label="분석"
        icon={Icon.chart}
        items={() => {
          const saved = Object.values(instances).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          const items: Item[] = modules.flatMap((m) => m.analyses.map((a) => ({ label: a.menu.join(" › "), run: () => void newAnalysis(a.key) })));
          if (!items.length) items.push({ heading: "설치된 분석 모듈이 없습니다" });
          if (saved.length) items.push("-", { heading: "이 프로젝트의 분석" }, ...saved.slice(0, 10).map((i) => ({ label: i.title, hint: analysisHint(i), run: () => openAnalysisTab(i.id) })));
          return items;
        }}
      />
      <button
        className="tb-btn tb-icon-only"
        title="저장 (⌘S)"
        disabled={!dirty}
        onClick={() => {
          const a = activeEditor();
          if (a) void saveFile(a.path);
        }}
      >
        {Icon.save}
      </button>
      <span className="spacer" />
      <span className="tb-project ellipsis" title={project?.path}>
        {project ? project.name : "R Sage"}
      </span>
      <span className="spacer" />
      <button className="btn btn-small" onClick={() => runCommand("palette.open")}>
        명령 ⌘⇧P
      </button>
      <button className="btn btn-small" onClick={() => runCommand("view.assistant")}>
        AI 조수
      </button>
      <button className="btn btn-small" onClick={() => runCommand("ai.settings")}>
        AI 연결
      </button>
      <button className="btn btn-small" disabled={!project} onClick={() => runCommand("project.settings")}>
        설정
      </button>
    </div>
  );
}

/** Data set and when the analysis last ran, so saved analyses of the same kind can be told apart. */
function analysisHint(i: AnalysisInstance): string {
  const at = i.lastRun?.finishedAt ?? i.lastRun?.startedAt;
  if (!at) return [i.dataset, "실행 전"].filter(Boolean).join(" · ");
  const d = new Date(at);
  const today = d.toDateString() === new Date().toDateString();
  const pad = (n: number) => String(n).padStart(2, "0");
  const when = today ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return [i.dataset, when].filter(Boolean).join(" · ");
}
