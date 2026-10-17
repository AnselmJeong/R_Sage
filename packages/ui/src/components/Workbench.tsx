import { useEffect, useRef, useState } from "react";
import {
  DockviewReact,
  themeDark,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview";
import { host } from "../host/client";
import { useStore } from "../store";
import { registerCommand, runCommand } from "../commands";
import {
  activeEditor,
  basename,
  closeFile,
  getDockApi,
  onExternalChange,
  openFile,
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
import { FileTree } from "./FileTree";
import { HistoryPanel } from "./HistoryPanel";
import { SearchPanel } from "./SearchPanel";
import { TerminalPanel } from "./TerminalPanel";
import { StatusBar } from "./StatusBar";
import { usePalette } from "./Palette";
import { useSettings } from "./SettingsDialog";
import { promptDialog } from "./Dialogs";
import { pickFolder } from "./FolderPicker";
import { openProject } from "./Welcome";

function EditorWelcome() {
  return (
    <div className="editor-welcome">
      <p>파일 트리에서 파일을 열거나 새 R 스크립트를 만드세요.</p>
      <ul className="muted">
        <li>⌘P 파일 빠르게 열기 · ⌘⇧P 명령 팔레트</li>
        <li>⌘↵ 현재 문장/선택 실행 · ⌘⇧S source() · ⌘⌥F 함수 전체 실행</li>
        <li>Esc 콘솔에서 실행 중단 · Ctrl+L 콘솔 지우기 · Ctrl+R 명령 이력 검색</li>
      </ul>
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
  files: () => <FileTree />,
  search: () => <SearchPanel />,
  editor: EditorPanel,
  editorWelcome: EditorWelcome,
  console: () => <ConsolePanel />,
  terminal: (props) => <TerminalPanelHost {...props} />,
  history: () => <HistoryPanel />,
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
  api.addPanel({ id: "files", component: "files", title: "파일" });
  api.addPanel({ id: "search", component: "search", title: "검색", position: { referencePanel: "files", direction: "within" }, inactive: true });
  api.addPanel({ id: "welcome-editor", component: "editorWelcome", title: "시작", position: { referencePanel: "files", direction: "right" } });
  api.addPanel({ id: "console", component: "console", title: "Console", position: { referencePanel: "welcome-editor", direction: "below" } });
  api.addPanel({ id: "terminal", component: "terminal", title: "Terminal", position: { referencePanel: "console", direction: "within" }, inactive: true });
  api.addPanel({ id: "history", component: "history", title: "실행 이력", position: { referencePanel: "welcome-editor", direction: "right" } });
  try {
    api.getPanel("files")?.group.api.setSize({ width: 240 });
    api.getPanel("history")?.group.api.setSize({ width: 320 });
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
    registerCommand({
      id: "file.new",
      title: "새 R 스크립트",
      category: "파일",
      key: "Mod+N",
      run: async () => {
        const root = useStore.getState().project?.path;
        if (!root) return;
        const name = await promptDialog({ title: "새 파일", value: "untitled.R", selectBaseName: true, confirm: "만들기" });
        if (!name) return;
        const path = `${root}/${name}`;
        await host.call("fs.create", { path, kind: "file" });
        await openFile(path);
      },
    }),
    registerCommand({
      id: "project.open",
      title: "폴더 열기",
      category: "프로젝트",
      key: "Mod+O",
      run: async () => {
        const p = await pickFolder("프로젝트 폴더 열기");
        if (p) await openProject(p);
      },
    }),
    registerCommand({
      id: "project.new",
      title: "새 프로젝트",
      category: "프로젝트",
      run: async () => {
        const p = await pickFolder("새 프로젝트를 만들 위치", true);
        if (!p) return;
        const project = await host.call("project.create", { path: p });
        useStore.setState({ project });
      },
    }),
    registerCommand({ id: "project.settings", title: "프로젝트 설정", category: "프로젝트", key: "Mod+,", run: () => useSettings.setState({ open: true }) }),
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
    registerCommand({ id: "view.files", title: "파일", category: "보기", key: "Mod+Shift+E", run: () => showPanel("files", "files", "파일", { id: "search", dir: "within" }) }),
    registerCommand({ id: "view.search", title: "프로젝트 검색", category: "보기", key: "Mod+Shift+F", run: () => showPanel("search", "search", "검색", { id: "files", dir: "within" }) }),
    registerCommand({ id: "view.terminal", title: "터미널", category: "보기", key: "Ctrl+`", run: () => showPanel("terminal", "terminal", "Terminal", { id: "console", dir: "within" }) }),
    registerCommand({ id: "view.history", title: "실행 이력", category: "보기", run: () => showPanel("history", "history", "실행 이력", { id: "console", dir: "right" }) }),
    registerCommand({
      id: "view.resetLayout",
      title: "패널 배치 초기화",
      category: "보기",
      run: () => {
        const api = getDockApi();
        if (!api) return;
        const open = Object.keys(useStore.getState().openFiles);
        buildDefaultLayout(api);
        for (const p of open) void openFile(p);
      },
    }),
  ];
  return () => offs.forEach((o) => o());
}

export function Workbench() {
  const project = useStore((s) => s.project);
  const toast = useStore((s) => s.toast);
  const apiRef = useRef<DockviewApi>();

  useEffect(() => registerAppCommands(), []);
  useEffect(() => host.on("fs.changed", ({ paths }) => void onExternalChange(paths)), []);

  // Reopen the files that were open last time.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !project) return;
    void (async () => {
      const state = await host.call("project.loadState");
      for (const f of state?.openFiles ?? []) {
        await openFile(f.path, f.cursor ? { line: f.cursor.line, column: f.cursor.column } : undefined).catch(() => {});
      }
      if (state?.activeFile && useStore.getState().openFiles[state.activeFile]) await openFile(state.activeFile);
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
      <div className="titlebar">
        <span className="title">{project?.name ?? "R Sage"}</span>
        <span className="muted small ellipsis">{project?.path}</span>
        <span className="spacer" />
        <button className="btn btn-small" onClick={() => runCommand("palette.open")}>
          명령 ⌘⇧P
        </button>
        <button className="btn btn-small" onClick={() => runCommand("project.settings")}>
          설정
        </button>
      </div>
      <div className="dock">
        <DockviewReact
          components={components}
          tabComponents={{ editorTab: EditorTab }}
          defaultTabComponent={undefined}
          onReady={onReady}
          theme={themeDark}
        />
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
