// The bar across the top of the window: the project chooser, New, 분석 and
// 분석 기록 menus, Save, the command field and the app-wide buttons. It doubles as the
// macOS title bar (draggable).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { runCommand } from "../commands";
import { activeEditor, saveFile } from "../editor/files";
import { newDocument, newProjectDialog, openFileDialog, openFolderDialog, openProject } from "../project";
import type { AnalysisInstance, AnalysisModuleInfo } from "@rsage/shared";
import { newAnalysis, openAnalysisTab, useAnalyses } from "../analysis";

type Item = { label: string; hint?: string; indent?: boolean; run: () => void } | "-" | { heading: string };

/** Category order in the 분석 menu, as in JASP's toolbar; other categories follow in module order. */
const CATEGORIES = ["데이터 준비", "기술통계", "T 검정", "분산분석", "회귀", "빈도", "요인분석", "구조방정식"];

type Cmd = { label: string; run: () => void };

/** Commands grouped under their category (the first element of each menu path), in JASP's order. */
function analysisGroups(modules: AnalysisModuleInfo[]): [string, Cmd[]][] {
  const groups = new Map<string, Cmd[]>();
  for (const m of modules)
    for (const a of m.analyses)
      for (const e of a.entries) {
        const [cat, ...rest] = e.menu.length > 1 ? e.menu : ["기타", ...e.menu];
        if (!groups.has(cat!)) groups.set(cat!, []);
        groups.get(cat!)!.push({ label: rest.join(" › "), run: () => void newAnalysis(a.key, e) });
      }
  const rank = (c: string) => (CATEGORIES.includes(c) ? CATEGORIES.indexOf(c) : CATEGORIES.length);
  return [...groups.entries()].sort(([x], [y]) => rank(x) - rank(y));
}

/** Most categories side by side before the panel wraps to a new row. */
const MAX_COLUMNS = 4;

/** The 분석 panel: one column per category, wrapping into rows as modules add categories. */
function AnalysisPanel({ groups, close }: { groups: [string, Cmd[]][]; close: () => void }) {
  if (!groups.length) return <div className="tb-heading">설치된 분석 모듈이 없습니다</div>;
  return (
    <div className="tb-mega" style={{ gridTemplateColumns: `repeat(${Math.min(groups.length, MAX_COLUMNS)}, minmax(140px, auto))` }}>
      {groups.map(([cat, cmds]) => (
        <div key={cat} className="tb-mega-col">
          <div className="tb-heading">{cat}</div>
          {cmds.map((c, i) => (
            <div
              key={i}
              className="menu-item"
              onClick={() => {
                close();
                c.run();
              }}
            >
              <span className="ellipsis">{c.label}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

type MenuProps = { label: string; icon: JSX.Element; className?: string; title?: string; iconOnly?: boolean } & (
  | { items: () => Item[]; panel?: never }
  | { panel: (close: () => void) => JSX.Element; items?: never }
);

function Menu({ label, icon, items, panel, className = "", title, iconOnly }: MenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const drop = useRef<HTMLDivElement>(null);
  // Keep the dropdown inside the window: shift it left when it would run past the right edge.
  useLayoutEffect(() => {
    const el = drop.current;
    if (!open || !el) return;
    el.style.left = "0px";
    const over = el.getBoundingClientRect().right - (window.innerWidth - 8);
    if (over > 0) el.style.left = `${-over}px`;
  }, [open]);
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
      <button className={`tb-btn ${className} ${open ? "active" : ""}`} title={title} onClick={() => setOpen(!open)}>
        {icon}
        {!iconOnly && <span className="tb-label">{label}</span>}
        <svg viewBox="0 0 24 24" className="tb-icon tb-caret">
          <path d="M7 10l5 5 5-5" />
        </svg>
      </button>
      {open && panel && <div className="tb-dropdown tb-dropdown-wide" ref={drop}>{panel(() => setOpen(false))}</div>}
      {open && items && (
        <div className="tb-dropdown" ref={drop}>
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
  history: (
    <svg viewBox="0 0 24 24" className="tb-icon">
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3 4v4h4M12 7.5V12l3 2" />
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
      <Menu label="분석" icon={Icon.chart} panel={(close) => <AnalysisPanel groups={analysisGroups(modules)} close={close} />} />
      <Menu
        label="분석 기록"
        title="이 프로젝트의 분석"
        icon={Icon.history}
        items={() => {
          const saved = Object.values(instances).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          if (!saved.length) return [{ heading: "아직 이 프로젝트에서 만든 분석이 없습니다" }];
          return [{ heading: "이 프로젝트의 분석" }, ...saved.slice(0, 20).map((i) => ({ label: i.title, hint: analysisHint(i), run: () => openAnalysisTab(i.id) }))];
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
