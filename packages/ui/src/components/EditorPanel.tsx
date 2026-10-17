import { useEffect, useRef } from "react";
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

export function EditorPanel(props: IDockviewPanelProps<{ path: string; line?: number }>) {
  const { path } = props.params;
  const hostRef = useRef<HTMLDivElement>(null);
  const file = useStore((s) => s.openFiles[path]);

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
      <div className="editor-host" ref={hostRef} />
    </div>
  );
}
