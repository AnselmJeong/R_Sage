import { useEffect, useRef, useState } from "react";
import type { IDockviewPanelProps } from "dockview";
import { useStore } from "../store";
import { monaco } from "../editor/monaco";
import {
  discardBackup,
  editorsByPath,
  getModel,
  persistWorkspaceSoon,
  reloadFromDisk,
  restoreBackup,
  runCode,
  runCurrentStatement,
  runEnclosingFunction,
  saveFile,
  setActiveEditor,
  sourceFile,
} from "../editor/files";
import { runCommand } from "../commands";
import { VisualEditor } from "../quarto/VisualEditor";
import { FORMATS, renderDocument, useRender, type RenderFormat } from "../quarto/render";
import { useEditorModes } from "../editor/views";

const MODE_KEY = (path: string) => `rsage.qmdMode:${path}`;
const FORMAT_KEY = "rsage.renderFormat";

function storedMode(path: string): "source" | "visual" {
  try {
    const m = localStorage.getItem(MODE_KEY(path));
    if (m === "source" || m === "visual") return m;
  } catch {}
  return "visual";
}

export function EditorPanel(props: IDockviewPanelProps<{ path: string; line?: number }>) {
  const { path } = props.params;
  const hostRef = useRef<HTMLDivElement>(null);
  const file = useStore((s) => s.openFiles[path]);
  const isQmd = /\.qmd$/i.test(path);
  const [mode, setMode] = useState<"source" | "visual">(() => (isQmd ? storedMode(path) : "source"));
  const [active, setActive] = useState(props.api.isActive);
  useEffect(() => {
    useEditorModes.setState({ [path]: mode });
  }, [path, mode]);
  useEffect(
    () => () =>
      useEditorModes.setState((s) => {
        const n = { ...s };
        delete n[path];
        return n;
      }, true),
    [path],
  );
  const switchMode = (m: "source" | "visual") => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY(path), m);
    } catch {}
    if (m === "source") setTimeout(() => editorsByPath.get(path)?.focus(), 0);
  };

  useEffect(() => {
    const model = getModel(path);
    if (!hostRef.current || !model) return;
    const ed = monaco.editor.create(hostRef.current, {
      model,
      theme: "rsage-dark",
      automaticLayout: true,
      fontSize: 13,
      fontFamily: "var(--mono)",
      minimap: { enabled: false },
      tabSize: 2,
      insertSpaces: true,
      renderWhitespace: "selection",
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: "active", indentation: true },
      scrollBeyondLastLine: false,
      "semanticHighlighting.enabled": false,
      suggest: { showSnippets: true },
      quickSuggestionsDelay: 150,
      wordBasedSuggestions: "currentDocument",
      unicodeHighlight: { ambiguousCharacters: false },
    });
    editorsByPath.set(path, ed);
    setActiveEditor(path);

    // Running code
    ed.addAction({
      id: "rsage.run",
      label: "선택 영역/현재 문장 실행",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      contextMenuGroupId: "1_rsage",
      run: () => runCurrentStatement(ed, path),
    });
    ed.addAction({
      id: "rsage.runFunction",
      label: "함수 전체 실행",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
      contextMenuGroupId: "1_rsage",
      run: () => runEnclosingFunction(ed, path),
    });
    ed.addAction({
      id: "rsage.runAll",
      label: "파일 전체 실행",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      contextMenuGroupId: "1_rsage",
      run: () => runCode(ed.getModel()!.getValue(), { file: path, line: 1 }),
    });
    ed.addAction({
      id: "rsage.source",
      label: "source()로 실행",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS],
      contextMenuGroupId: "1_rsage",
      run: () => sourceFile(path),
    });
    ed.addAction({
      id: "rsage.help",
      label: "도움말 보기",
      keybindings: [monaco.KeyCode.F1],
      run: () => {
        const word = ed.getModel()?.getWordAtPosition(ed.getPosition()!);
        if (word) void runCode(`help(${JSON.stringify(word.word)})`);
      },
    });
    // App-level shortcuts must still work while the editor has focus.
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveFile(path));
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP, () => void runCommand("palette.open"));
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => void runCommand("file.quickOpen"));

    ed.onDidFocusEditorText(() => setActiveEditor(path));
    ed.onDidChangeCursorPosition(() => persistWorkspaceSoon());
    if (props.params.line) {
      ed.revealLineInCenter(props.params.line);
      ed.setPosition({ lineNumber: props.params.line, column: 1 });
    }
    const off = props.api.onDidActiveChange((e) => {
      setActive(e.isActive);
      if (e.isActive) {
        setActiveEditor(path);
        setTimeout(() => ed.focus(), 0);
      }
    });
    setTimeout(() => ed.focus(), 0);
    return () => {
      off.dispose();
      if (editorsByPath.get(path) === ed) editorsByPath.delete(path);
      ed.dispose();
    };
  }, [path]);

  return (
    <div className="editor-panel">
      {file?.externalChange && (
        <div className="banner banner-warn">
          이 파일이 앱 밖에서 바뀌었습니다. 저장하지 않은 내 변경이 있습니다.
          <button className="btn btn-small" onClick={() => reloadFromDisk(path)}>
            디스크 버전 불러오기
          </button>
          <button className="btn btn-small" onClick={() => useStore.getState().setFile(path, { externalChange: false })}>
            내 버전 유지
          </button>
        </div>
      )}
      {file?.hasBackup && (
        <div className="banner banner-info">
          저장하지 않은 내용이 남아 있습니다 (비정상 종료 후 복구).
          <button className="btn btn-small" onClick={() => restoreBackup(path)}>
            복구
          </button>
          <button className="btn btn-small" onClick={() => discardBackup(path)}>
            버리기
          </button>
        </div>
      )}
      {isQmd && <QmdBar path={path} mode={mode} setMode={switchMode} />}
      <div className="editor-host" ref={hostRef} style={isQmd && mode === "visual" ? { display: "none" } : undefined} />
      {isQmd && mode === "visual" && <VisualEditor path={path} active={active} />}
    </div>
  );
}

function QmdBar({ path, mode, setMode }: { path: string; mode: "source" | "visual"; setMode: (m: "source" | "visual") => void }) {
  const running = useRender((s) => s.running && s.file === path);
  const [format, setFormat] = useState<RenderFormat | "">(() => {
    try {
      return (localStorage.getItem(FORMAT_KEY) as RenderFormat | "") ?? "";
    } catch {
      return "";
    }
  });
  return (
    <div className="qmd-bar">
      <div className="seg">
        <button className={mode === "source" ? "active" : ""} onClick={() => setMode("source")}>
          소스
        </button>
        <button className={mode === "visual" ? "active" : ""} onClick={() => setMode("visual")}>
          비주얼
        </button>
      </div>
      <span className="qv-spacer" />
      <select
        className="qv-block-select"
        value={format}
        title="출력 형식"
        onChange={(e) => {
          const v = e.target.value as RenderFormat | "";
          setFormat(v);
          try {
            localStorage.setItem(FORMAT_KEY, v);
          } catch {}
        }}
      >
        {FORMATS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      <button className="btn btn-small btn-primary" disabled={running} onClick={() => void renderDocument(path, format)} title="Quarto로 렌더링 (⌘⇧K)">
        {running ? "렌더링 중…" : "렌더"}
      </button>
    </div>
  );
}
