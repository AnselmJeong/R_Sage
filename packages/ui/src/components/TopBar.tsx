// The bar across the top of the window: the project chooser, New and 분석
// menus, Save, the command field and the app-wide buttons. It doubles as the
// macOS title bar (draggable).

import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { runCommand } from "../commands";
import { activeEditor, saveFile } from "../editor/files";
import { newDocument, newProjectDialog, openFileDialog, openFolderDialog, openProject } from "../project";
import type { AnalysisInstance, AnalysisModuleInfo } from "@rsage/shared";
import { newAnalysis, openAnalysisTab, useAnalyses } from "../analysis";

type Item = { label: string; hint?: string; indent?: boolean; run: () => void } | "-" | { heading: string };

/** Category order in the 분석 menu, as in JASP's toolbar; other categories follow in module order. */
const CATEGORIES = ["데이터 준비", "기술통계", "T 검정", "분산분석", "회귀", "빈도", "요인분석"];

/** Commands grouped under their category (the first element of each menu path). */
function analysisMenu(modules: AnalysisModuleInfo[]): Item[] {
  const groups = new Map<string, Item[]>();
  for (const m of modules)
    for (const a of m.analyses)
      for (const e of a.entries) {
        const [cat, ...rest] = e.menu.length > 1 ? e.menu : ["기타", ...e.menu];
        if (!groups.has(cat!)) groups.set(cat!, []);
        groups.get(cat!)!.push({ label: rest.join(" › "), indent: true, run: () => void newAnalysis(a.key, e) });
      }
  const rank = (c: string) => (CATEGORIES.includes(c) ? CATEGORIES.indexOf(c) : CATEGORIES.length);
  const cats = [...groups.keys()].sort((x, y) => rank(x) - rank(y));
  return cats.flatMap((c, i) => [...(i ? (["-"] as Item[]) : []), { heading: c }, ...groups.get(c)!]);
}

function Menu({ label, icon, items, className = "" }: { label: string; icon: JSX.Element; items: () => Item[]; className?: string }) {
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
      <button className={`tb-btn ${className} ${open ? "active" : ""}`} onClick={() => setOpen(!open)}>
        {icon}
        <span className="tb-label">{label}</span>
        <svg viewBox="0 0 24 24" className="tb-icon tb-caret">
          <path d="M7 10l5 5 5-5" />
        </svg>
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
                className={`menu-item ${it.indent ? "tb-indent" : ""}`}
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
  search: (
    <svg viewBox="0 0 24 24" className="tb-icon">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </svg>
  ),
  sparkle: (
    <svg viewBox="0 0 24 24" className="tb-icon">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
    </svg>
  ),
  plug: (
    <svg viewBox="0 0 24 24" className="tb-icon">
      <path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5V21" />
    </svg>
  ),
  gear: (
    <svg viewBox="0 0 24 24" className="tb-icon">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
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
        label={project ? project.name : "프로젝트 열기"}
        icon={Icon.folder}
        className="tb-project-btn"
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
        label="분석"
        icon={Icon.chart}
        items={() => {
          const saved = Object.values(instances).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          const items = analysisMenu(modules);
          if (!items.length) items.push({ heading: "설치된 분석 모듈이 없습니다" });
          if (saved.length) items.push("-", { heading: "이 프로젝트의 분석" }, ...saved.slice(0, 10).map((i) => ({ label: i.title, hint: analysisHint(i), run: () => openAnalysisTab(i.id) })));
          return items;
        }}
      />
      <button
        className="tb-btn tb-icon-btn"
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
      <button className="tb-command" title="명령 팔레트" onClick={() => runCommand("palette.open")}>
        {Icon.search}
        <span>명령 검색</span>
        <span className="spacer" />
        <span className="kbd">⌘⇧P</span>
      </button>
      <span className="spacer" />
      <button className="tb-btn tb-icon-btn" title="AI 조수" onClick={() => runCommand("view.assistant")}>
        {Icon.sparkle}
      </button>
      <button className="tb-btn tb-icon-btn" title="AI 연결 설정" onClick={() => runCommand("ai.settings")}>
        {Icon.plug}
      </button>
      <button className="tb-btn tb-icon-btn" title="설정 (⌘,)" onClick={() => runCommand("project.settings")}>
        {Icon.gear}
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
