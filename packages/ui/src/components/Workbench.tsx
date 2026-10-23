import { useEffect, useRef, useState } from "react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview";
import { host } from "../host/client";
import { useStore } from "../store";
import { registerCommand, runCommand } from "../commands";
import { monaco } from "../editor/monaco";
import {
  activeEditor,
  basename,
  closeFile,
  getDockApi,
  onExternalChange,
  openFile,
  openInEditor,
  persistWorkspaceSoon,
  runCurrentStatement,
  runEnclosingFunction,
  saveAll,
  saveFile,
  setDockApi,
  sourceFile,
} from "../editor/files";
import { ConsolePanel } from "./ConsolePanel";
import { EditorPanel } from "./EditorPanel";
import { PreviewPanel } from "./PreviewPanel";
import { renderDocument, showPreview } from "../quarto/render";
import { HistoryPanel } from "./HistoryPanel";
import { EnvironmentPanel } from "./EnvironmentPanel";
import { PlotsPanel } from "./PlotsPanel";
import { HelpPanel } from "./HelpPanel";
import { DataViewerPanel } from "./DataViewerPanel";
import { AnalysisPanel } from "./AnalysisPanel";
import { analysisDefs, newAnalysis, startAnalysisSync, useAnalyses } from "../analysis";
import { AssistantPanel } from "./AssistantPanel";
import { useAiSettings } from "./AiSettingsDialog";
import { commHooks } from "../comms";
import { searchHooks } from "./SearchPanel";
import { ActivityBar, SidePanel, showSideView } from "./Sidebar";
import { TopBar } from "./TopBar";
import { TerminalPanel } from "./TerminalPanel";
import { StatusBar } from "./StatusBar";
import { DiffPanel } from "./DiffPanel";
import { refreshGitSoon } from "../git";
import { usePalette } from "./Palette";
import { useSettings } from "./SettingsDialog";
import { promptDialog } from "./Dialogs";
import { newDocument, newProjectDialog, openFileDialog, openFolderDialog, openProject } from "../project";

function EditorWelcome() {
  const recent = useStore((s) => s.recent);
  const project = useStore((s) => s.project);
  const rList = useStore((s) => s.rList);
  const app = useStore((s) => s.app);
  const [checks, setChecks] = useState<{ name: string; ok: boolean; detail: string }[]>([]);
  useEffect(() => {
    void host.call("app.diagnostics").then((d) => setChecks(d.checks)).catch(() => {});
  }, [rList.length]);
  const others = recent.filter((r) => r.path !== project?.path).slice(0, 6);
  return (
    <div className="editor-welcome">
      <h1>R Sage</h1>
      <p className="muted">R 분석과 Quarto 보고서를 한 곳에서.</p>
      <div className="start-grid">
        <section>
          <h2>시작</h2>
          <button className="start-link" onClick={() => void newDocument("qmd")}>
            새 Quarto 문서 <span className="muted">⌘N</span>
          </button>
          <button className="start-link" onClick={() => void newDocument("R")}>
            새 R 스크립트 <span className="muted">⌥⌘N</span>
          </button>
          <button className="start-link" onClick={() => void openFileDialog()}>
            파일 열기… <span className="muted">⌘O</span>
          </button>
          <button className="start-link" onClick={() => void openFolderDialog()}>
            폴더 열기…
          </button>
          <button className="start-link" onClick={() => void newProjectDialog()}>
            새 프로젝트…
          </button>
        </section>
        {others.length > 0 && (
          <section>
            <h2>최근 프로젝트</h2>
            {others.map((r) => (
              <button key={r.path} className="start-link" title={r.path} onClick={() => void openProject(r.path)}>
                {r.name} <span className="muted small ellipsis">{r.path.replace(/^\/Users\/[^/]+/, "~")}</span>
              </button>
            ))}
          </section>
        )}
      </div>
      <h2>단축키</h2>
      <ul className="muted">
        <li>⌘P 파일 빠르게 열기 · ⌘⇧P 명령 팔레트</li>
        <li>⌘↵ 현재 문장/선택 실행 · ⌘⇧S source() · ⌘⌥F 함수 전체 실행</li>
        <li>Esc 콘솔에서 실행 중단 · Ctrl+L 콘솔 지우기 · Ctrl+R 명령 이력 검색</li>
        <li>⌘F 현재 파일에서 찾기 · ⌘⇧F 프로젝트 검색 · ⌘⇧O 개요</li>
      </ul>
      {checks.some((c) => !c.ok) && (
        <>
          <h2>환경 점검</h2>
          {checks.map((c) => (
            <div key={c.name} className="check">
              <span className={c.ok ? "ok" : "warn"}>{c.ok ? "✓" : "!"}</span> <strong>{c.name}</strong>
              {!c.ok && <pre className="muted small">{c.detail}</pre>}
            </div>
          ))}
        </>
      )}
      {app && <div className="muted small">R Sage {app.version}</div>}
    </div>
  );
}

function EditorTab(props: IDockviewPanelHeaderProps<{ path: string }>) {
  const path = props.params.path;
  const file = useStore((s) => s.openFiles[path]);
  return (
    <div
      className="editor-tab"
      title={path}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          void closeFile(path);
        }
      }}
    >
      <span>{basename(path)}</span>
      <button
        className={`tab-close ${file?.dirty ? "dirty" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          void closeFile(path);
        }}
        title={file?.dirty ? "저장하지 않은 변경" : "닫기"}
      >
        {file?.dirty ? "●" : "×"}
      </button>
    </div>
  );
}

const components: Record<string, React.FunctionComponent<IDockviewPanelProps<any>>> = {
  editor: EditorPanel,
  editorWelcome: EditorWelcome,
  console: () => <ConsolePanel />,
  terminal: (props) => <TerminalPanelHost {...props} />,
  history: () => <HistoryPanel />,
  assistant: () => <AssistantPanel />,
  environment: () => <EnvironmentPanel />,
  plots: () => <PlotsPanel />,
  help: () => <HelpPanel />,
  dataViewer: DataViewerPanel,
  analysis: AnalysisPanel,
  preview: (props) => <PreviewPanel api={props.api} />,
  diff: DiffPanel,
};

function TerminalPanelHost(props: IDockviewPanelProps) {
  const [active, setActive] = useState(props.api.isActive);
  useEffect(() => {
    const d = props.api.onDidActiveChange((e) => setActive(e.isActive));
    return () => d.dispose();
  }, [props.api]);
  return <TerminalPanel active={active} />;
}

function buildDefaultLayout(api: DockviewApi) {
  api.clear();
  api.addPanel({ id: "welcome-editor", component: "editorWelcome", title: "시작" });
  api.addPanel({ id: "console", component: "console", title: "Console", position: { referencePanel: "welcome-editor", direction: "below" } });
  api.addPanel({ id: "terminal", component: "terminal", title: "Terminal", position: { referencePanel: "console", direction: "within" }, inactive: true });
  // Right column spans the full height (root-level split), like Positron.
  api.addPanel({ id: "assistant", component: "assistant", title: "AI 조수", position: { direction: "right" } });
  api.addPanel({ id: "environment", component: "environment", title: "환경", position: { referencePanel: "assistant", direction: "within" }, inactive: true });
  api.addPanel({ id: "history", component: "history", title: "실행 이력", position: { referencePanel: "assistant", direction: "within" }, inactive: true });
  api.addPanel({ id: "plots", component: "plots", title: "플롯", position: { referencePanel: "environment", direction: "below" } });
  api.addPanel({ id: "help", component: "help", title: "도움말", position: { referencePanel: "plots", direction: "within" }, inactive: true });
  try {
    api.getPanel("assistant")?.group.api.setSize({ width: 440 });
    api.getPanel("assistant")?.group.api.setSize({ height: Math.round(window.innerHeight * 0.7) });
    api.getPanel("console")?.group.api.setSize({ height: Math.round(window.innerHeight * 0.38) });
  } catch {}
}

/** Show (or re-create) a tool panel and focus it. */
function showPanel(id: string, component: string, title: string, near: { id: string; dir: "within" | "below" | "right" | "left" }) {
  const api = getDockApi();
  if (!api) return;
  let p = api.getPanel(id);
  if (!p) {
    const ref = api.getPanel(near.id);
    p = api.addPanel({ id, component, title, position: ref ? { referencePanel: ref.id, direction: near.dir } : undefined });
  }
  p.api.setActive();
}

/** Panels sit as rounded surfaces on the window shell with a narrow gutter between them (styles.css). */
const DOCK_THEME = { name: "rsage", className: "dockview-theme-rsage", gap: 6 };

function registerAppCommands() {
  const offs = [
    registerCommand({ id: "palette.open", title: "명령 팔레트", key: "Mod+Shift+P", run: () => usePalette.setState({ mode: "commands" }) }),
    registerCommand({ id: "file.quickOpen", title: "파일 빠르게 열기", category: "파일", key: "Mod+P", run: () => usePalette.setState({ mode: "files" }) }),
    registerCommand({
      id: "file.save",
      title: "저장",
      category: "파일",
      key: "Mod+S",
      run: () => {
        const a = activeEditor();
        if (a) return saveFile(a.path);
      },
    }),
    registerCommand({ id: "file.saveAll", title: "모두 저장", category: "파일", key: "Mod+Alt+S", run: () => saveAll() }),
    registerCommand({
      id: "file.close",
      title: "파일 닫기",
      category: "파일",
      key: "Mod+W",
      when: () => !!activeEditor(),
      run: () => {
        const a = activeEditor();
        if (a) return closeFile(a.path);
      },
    }),
    registerCommand({ id: "file.newQmd", title: "새 Quarto 문서", category: "파일", key: "Mod+N", run: () => newDocument("qmd") }),
    registerCommand({ id: "file.new", title: "새 R 스크립트", category: "파일", key: "Mod+Alt+N", run: () => newDocument("R") }),
    registerCommand({ id: "file.open", title: "파일 열기", category: "파일", key: "Mod+O", run: () => openFileDialog() }),
    registerCommand({ id: "project.open", title: "폴더 열기", category: "프로젝트", run: () => openFolderDialog() }),
    registerCommand({ id: "project.new", title: "새 프로젝트", category: "프로젝트", run: () => newProjectDialog() }),
    registerCommand({ id: "project.settings", title: "설정", category: "R Sage", key: "Mod+,", run: () => useSettings.setState({ open: true }) }),
    registerCommand({
      id: "project.close",
      title: "프로젝트 닫기",
      category: "프로젝트",
      run: async () => {
        for (const f of Object.keys(useStore.getState().openFiles)) if (!(await closeFile(f))) return;
        await host.call("project.close");
        useStore.setState({ project: null, recent: await host.call("project.recent") });
      },
    }),
    registerCommand({
      id: "r.run",
      title: "현재 문장/선택 실행",
      category: "R",
      key: "Mod+Enter",
      when: () => !!activeEditor() && document.activeElement?.closest(".editor-panel") !== null,
      run: () => {
        const a = activeEditor();
        if (a) return runCurrentStatement(a.editor, a.path);
      },
    }),
    registerCommand({
      id: "r.runFunction",
      title: "함수 전체 실행",
      category: "R",
      run: () => {
        const a = activeEditor();
        if (a) return runEnclosingFunction(a.editor, a.path);
      },
    }),
    registerCommand({
      id: "r.source",
      title: "현재 파일 source()",
      category: "R",
      run: () => {
        const a = activeEditor();
        if (a) return sourceFile(a.path);
      },
    }),
    registerCommand({ id: "session.start", title: "R 세션 시작", category: "R", run: () => host.call("session.start", {}) }),
    registerCommand({ id: "session.restart", title: "R 세션 재시작", category: "R", key: "Mod+Shift+0", run: () => host.call("session.restart", {}) }),
    registerCommand({ id: "session.interrupt", title: "실행 중단", category: "R", run: () => host.call("session.interrupt") }),
    registerCommand({ id: "session.stop", title: "R 세션 종료", category: "R", run: () => host.call("session.stop") }),
    registerCommand({
      id: "r.addManual",
      title: "R 경로 직접 지정",
      category: "R",
      run: async () => {
        const p = await promptDialog({ title: "R 경로", message: "R 실행 파일 또는 R_HOME 폴더 경로", placeholder: "/opt/homebrew/bin/R" });
        if (!p) return;
        const r = await host.call("r.addManual", { path: p });
        if (!r) useStore.getState().notify("R을 찾지 못했습니다.", "error");
        else useStore.setState({ rList: await host.call("r.list", {}) });
      },
    }),
    registerCommand({ id: "console.clear", title: "콘솔 지우기", category: "Console", run: () => useStore.getState().clearConsole() }),
    registerCommand({
      id: "console.focus",
      title: "콘솔로 이동",
      category: "보기",
      key: "Ctrl+2",
      run: () => {
        showPanel("console", "console", "Console", { id: "welcome-editor", dir: "below" });
        setTimeout(() => (window as any).__rsageConsoleFocus?.(), 0);
      },
    }),
    registerCommand({
      id: "editor.focus",
      title: "에디터로 이동",
      category: "보기",
      key: "Ctrl+1",
      run: () => activeEditor()?.editor.focus(),
    }),
    registerCommand({
      id: "console.saveHistory",
      title: "명령 이력을 파일로 저장",
      category: "Console",
      run: async () => {
        const root = useStore.getState().project?.path;
        if (!root) return;
        const name = await promptDialog({ title: "명령 이력 저장", value: "history.R" });
        if (name) await host.call("console.saveHistory", { path: `${root}/${name}` });
      },
    }),
    registerCommand({ id: "view.files", title: "탐색기", category: "보기", key: "Mod+Shift+E", run: () => showSideView("files") }),
    registerCommand({
      id: "view.search",
      title: "검색",
      category: "보기",
      key: "Mod+Shift+F",
      run: () => {
        const a = activeEditor();
        const sel = a?.editor.getModel()?.getValueInRange(a.editor.getSelection()!) ?? "";
        showSideView("search");
        setTimeout(() => searchHooks.focus?.(sel && !sel.includes("\n") ? sel : undefined), 0);
      },
    }),
    registerCommand({ id: "view.outline", title: "개요", category: "보기", key: "Mod+Shift+O", run: () => showSideView("outline") }),
    registerCommand({ id: "view.scm", title: "소스 제어", category: "보기", key: "Ctrl+Shift+G", run: () => showSideView("scm") }),
    registerCommand({ id: "view.packages", title: "패키지", category: "보기", run: () => showSideView("packages") }),
    registerCommand({ id: "view.terminal", title: "터미널", category: "보기", key: "Ctrl+`", run: () => showPanel("terminal", "terminal", "Terminal", { id: "console", dir: "within" }) }),
    registerCommand({
      id: "view.assistant",
      title: "AI 조수",
      category: "보기",
      key: "Mod+Shift+I",
      run: () => {
        showPanel("assistant", "assistant", "AI 조수", { id: "environment", dir: "within" });
        setTimeout(() => (window as any).__rsageAssistantFocus?.(), 0);
      },
    }),
    registerCommand({
      id: "quarto.render",
      title: "Quarto 문서 렌더링",
      category: "Quarto",
      key: "Mod+Shift+K",
      run: () => {
        const f = useStore.getState().activeFile;
        if (f && /\.(qmd|md|ipynb)$/i.test(f)) void renderDocument(f);
        else useStore.getState().notify("렌더링할 .qmd 파일을 먼저 여세요.", "error");
      },
    }),
    registerCommand({ id: "quarto.preview", title: "미리보기 보기", category: "Quarto", run: () => showPreview() }),
    registerCommand({ id: "ai.settings", title: "AI 연결 설정", category: "AI", run: () => useAiSettings.setState({ open: true }) }),
    registerCommand({ id: "view.history", title: "실행 이력", category: "보기", run: () => showPanel("history", "history", "실행 이력", { id: "environment", dir: "within" }) }),
    registerCommand({ id: "view.environment", title: "환경", category: "보기", run: () => showPanel("environment", "environment", "환경", { id: "history", dir: "within" }) }),
    registerCommand({ id: "view.plots", title: "플롯", category: "보기", run: () => showPanel("plots", "plots", "플롯", { id: "help", dir: "within" }) }),
    registerCommand({ id: "view.help", title: "도움말", category: "보기", run: () => showPanel("help", "help", "도움말", { id: "plots", dir: "within" }) }),
    registerCommand({
      id: "view.resetLayout",
      title: "패널 배치 초기화",
      category: "보기",
      run: () => {
        const api = getDockApi();
        if (!api) return;
        const open = Object.keys(useStore.getState().openFiles);
        buildDefaultLayout(api);
        for (const p of open) void openInEditor(p);
      },
    }),
  ];
  // Monaco can take ⌘, before the window sees it (inside visual-mode chunks), so
  // every editor also binds it to the settings dialog.
  const settingsKey = [
    monaco.editor.registerCommand("rsage.openSettings", () => void runCommand("project.settings")),
    monaco.editor.addKeybindingRule({ keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.Comma, command: "rsage.openSettings" }),
  ];
  return () => {
    offs.forEach((o) => o());
    settingsKey.forEach((d) => d.dispose());
  };
}

export function Workbench() {
  const project = useStore((s) => s.project);
  const toast = useStore((s) => s.toast);
  const apiRef = useRef<DockviewApi>();

  useEffect(() => registerAppCommands(), []);
  useEffect(() => startAnalysisSync(), []);
  // One palette command per installed analysis.
  const modules = useAnalyses((s) => s.modules);
  useEffect(() => {
    const offs = analysisDefs().flatMap((d) =>
      d.entries.map((e, i) =>
        registerCommand({ id: `analysis.new.${d.key}${i ? `.${i}` : ""}`, title: `새 분석: ${e.menu.join(" › ")}`, category: "분석", run: () => void newAnalysis(d.key, e) }),
      ),
    );
    return () => offs.forEach((o) => o());
  }, [modules]);
  useEffect(() => host.on("fs.changed", ({ paths }) => void onExternalChange(paths)), []);
  // Git status follows file changes, the project, and commits made elsewhere (terminal, other apps).
  useEffect(() => {
    refreshGitSoon(0);
    const off = host.on("fs.changed", () => refreshGitSoon());
    const focus = () => refreshGitSoon(100);
    window.addEventListener("focus", focus);
    return () => {
      off();
      window.removeEventListener("focus", focus);
    };
  }, [project?.path]);
  useEffect(() => {
    commHooks.showPlots = () => showPanel("plots", "plots", "플롯", { id: "help", dir: "within" });
    commHooks.showHelp = () => showPanel("help", "help", "도움말", { id: "plots", dir: "within" });
    commHooks.openDataViewer = (v) => {
      const api = getDockApi();
      if (!api) return;
      const id = `data:${v.commId}`;
      const existing = api.getPanel(id);
      if (existing) return existing.api.setActive();
      // Data viewers open as tabs in the editor area, like Positron.
      const ref = api.panels.find((p) => p.id.startsWith("editor:") || p.id === "welcome-editor");
      api.addPanel({
        id,
        component: "dataViewer",
        title: `표: ${v.title}`,
        params: { commId: v.commId },
        position: ref ? { referencePanel: ref.id, direction: "within" } : undefined,
      });
    };
    commHooks.closeDataViewer = () => {
      // Keep the tab: it still shows the last rows; the panel says it is stale.
    };
  }, []);

  // Reopen the files that were open last time.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !project) return;
    void (async () => {
      const state = await host.call("project.loadState");
      for (const f of state?.openFiles ?? []) {
        await openInEditor(f.path, f.cursor ? { line: f.cursor.line, column: f.cursor.column } : undefined).catch(() => {});
      }
      if (state?.activeFile && useStore.getState().openFiles[state.activeFile]) await openInEditor(state.activeFile);
    })();
  }, [project?.path]);

  const onReady = (e: DockviewReadyEvent) => {
    apiRef.current = e.api;
    setDockApi(e.api);
    buildDefaultLayout(e.api);
    e.api.onDidLayoutChange(() => persistWorkspaceSoon());
    e.api.onDidActivePanelChange((p) => {
      if (p?.id.startsWith("editor:")) useStore.setState({ activeFile: p.id.slice(7) });
    });
  };

  return (
    <div className="workbench">
      <TopBar />
      <div className="main-row">
        <ActivityBar />
        <SidePanel />
        <div className="dock">
        <DockviewReact
          components={components}
          tabComponents={{ editorTab: EditorTab }}
          defaultTabComponent={undefined}
          onReady={onReady}
          theme={DOCK_THEME}
          />
        </div>
      </div>
      <StatusBar />
      {toast && <Toast key={toast.at} text={toast.text} level={toast.level} />}
    </div>
  );
}

function Toast({ text, level }: { text: string; level: "info" | "error" }) {
  useEffect(() => {
    const t = setTimeout(() => useStore.setState({ toast: undefined }), level === "error" ? 6000 : 3000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className={`toast toast-${level}`} onClick={() => useStore.setState({ toast: undefined })}>
      {text}
    </div>
  );
}
