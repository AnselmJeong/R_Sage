import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { host } from "../host/client";
import { installPackages } from "../packages";
import { useStore, type ConsoleItem } from "../store";
import { addLocalCommand, monaco } from "../editor/monaco";
import { openFile } from "../editor/files";
import { parseAnsi, stripAnsi } from "../util/ansi";
import { isMac } from "../commands";

/** Fallback when the kernel can't answer is_complete (busy or not started). */
export function looksIncomplete(code: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]!;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "#") {
      while (i < code.length && code[i] !== "\n") i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
  }
  if (quote || depth > 0) return true;
  const trimmed = code.replace(/#.*$/gm, "").trimEnd();
  return /(\|>|%[^%\s]*%|[-+*/^,~&|=<>!])$/.test(trimmed);
}

function Ansi({ text }: { text: string }) {
  const segs = useMemo(() => parseAnsi(text), [text]);
  if (segs.length === 1 && !segs[0]!.fg && !segs[0]!.bold) return <>{segs[0]!.text}</>;
  return (
    <>
      {segs.map((s, i) => (
        <span
          key={i}
          style={{
            color: s.fg,
            background: s.bg,
            fontWeight: s.bold ? 600 : undefined,
            fontStyle: s.italic ? "italic" : undefined,
            textDecoration: s.underline ? "underline" : undefined,
          }}
        >
          {s.text}
        </span>
      ))}
    </>
  );
}

/** "file.R#12" or "file.R:12" references in error text. */
const FILE_REF = /([\w./~-]+\.[Rr](?:md)?)[#:](\d+)/g;

const Item = memo(function Item({ item }: { item: ConsoleItem }) {
  const exec = useStore((s) => ("executionId" in item && item.executionId ? s.executions[item.executionId] : undefined));
  const generation = useStore((s) => s.session.generation);
  switch (item.type) {
    case "input": {
      const stale = item.generation < generation;
      return (
        <div className={`c-input ${stale ? "stale" : ""}`} title={stale ? "이전 세션에서 실행됨" : undefined}>
          {item.code.split("\n").map((l, i) => (
            <div key={i}>
              <span className="c-prompt">{i === 0 ? ">" : "+"}</span> {l}
            </div>
          ))}
          {exec?.source && (
            <button className="c-srclink" onClick={() => openFile(exec.source!.file, { line: exec.source!.line })}>
              {exec.source.file.split("/").pop()}:{exec.source.line}
            </button>
          )}
        </div>
      );
    }
    case "stream":
      return (
        <pre className={`c-stream ${item.name === "stderr" ? "c-stderr" : ""}`}>
          <Ansi text={item.text} />
        </pre>
      );
    case "result":
      return (
        <pre className="c-result">
          <Ansi text={item.text} />
        </pre>
      );
    case "display": {
      const png = item.data["image/png"] as string | undefined;
      const svg = item.data["image/svg+xml"] as string | undefined;
      const text = item.data["text/plain"] as string | undefined;
      if (png) return <img className="c-image" src={`data:image/png;base64,${png}`} />;
      if (svg) return <img className="c-image" src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} />;
      return <pre className="c-result">{text ?? "[출력]"}</pre>;
    }
    case "error": {
      const text = stripAnsi(item.evalue || item.ename);
      const refs = [...text.matchAll(FILE_REF), ...item.traceback.join("\n").matchAll(FILE_REF)];
      // "there is no package called 'x'" (R prints curly quotes in UTF-8 locales)
      const missing = /no package called [‘'"]([A-Za-z][\w.]*)[’'"]/.exec(text)?.[1];
      return (
        <div className="c-error">
          <pre>
            <Ansi text={item.evalue || item.ename} />
          </pre>
          {item.traceback.length > 0 && (
            <details>
              <summary>호출 스택 ({item.traceback.length})</summary>
              <pre className="c-traceback">
                <Ansi text={item.traceback.join("\n")} />
              </pre>
            </details>
          )}
          <div className="c-error-links">
            {missing && (
              <button className="c-srclink" onClick={() => void installPackages([missing])}>
                {missing} 패키지 설치
              </button>
            )}
            {exec?.source && (
              <button className="c-srclink" onClick={() => openFile(exec.source!.file, { line: exec.source!.line })}>
                오류가 난 코드로 이동 ({exec.source.file.split("/").pop()}:{exec.source.line})
              </button>
            )}
            {refs.slice(0, 3).map((m, i) => (
              <button key={i} className="c-srclink" onClick={() => openFileRef(m[1]!, Number(m[2]))}>
                {m[1]}:{m[2]}
              </button>
            ))}
          </div>
        </div>
      );
    }
    case "system":
      return <div className={`c-system c-${item.level}`}>{item.text}</div>;
  }
});

function openFileRef(file: string, line: number) {
  const root = useStore.getState().project?.path ?? "";
  const abs = file.startsWith("/") ? file : `${root}/${file}`;
  void openFile(abs, { line });
}

export function ConsolePanel() {
  const items = useStore((s) => s.console);
  const session = useStore((s) => s.session);
  const inputRequest = useStore((s) => s.inputRequest);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputHost = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>();
  const stick = useRef(true);
  const history = useRef<string[]>([]);
  const histIdx = useRef(-1);
  const draft = useRef("");
  const [search, setSearch] = useState<string | null>(null);
 const projectPath = useStore((s) => s.project?.path);
  const busy = session.state === "busy" || session.state === "starting" || session.state === "restarting";

  useEffect(() => {
    void host.call("console.history").then((h) => (history.current = h));
  }, [projectPath]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items, inputRequest]);

  useEffect(() => {
    if (!inputHost.current) return;
    const model = monaco.editor.createModel("", "r", monaco.Uri.parse("inmemory://console/input.R"));
    const ed = monaco.editor.create(inputHost.current, {
      model,
      theme: "rsage-dark",
      minimap: { enabled: false },
      lineNumbers: "off",
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 0,
      scrollBeyondLastLine: false,
      overviewRulerLanes: 0,
      renderLineHighlight: "none",
      scrollbar: { vertical: "hidden", horizontal: "auto", alwaysConsumeMouseWheel: false },
      wordWrap: "on",
      fontSize: 13,
      fontFamily: "var(--mono)",
      automaticLayout: true,
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      wordBasedSuggestions: "off",
      // Like a terminal: what you type is what is sent.
      autoClosingBrackets: "never",
      autoClosingQuotes: "never",
      padding: { top: 2, bottom: 2 },
      ariaLabel: "R 콘솔 입력",
    });
    editorRef.current = ed;
    const fit = () => {
      const h = Math.min(Math.max(ed.getContentHeight(), 20), 240);
      inputHost.current!.style.height = `${h}px`;
      ed.layout();
    };
    ed.onDidContentSizeChange(fit);
    fit();

    const submit = async () => {
      const code = model.getValue();
      if (!code.trim()) {
        useStore.getState().pushConsole({ type: "input", executionId: "", code: "", generation: useStore.getState().session.generation });
        return;
      }
      let status = await host.call("console.isComplete", { code });
      if (status === "unknown") status = looksIncomplete(code) ? "incomplete" : "complete";
      if (status === "incomplete") {
        ed.trigger("keyboard", "type", { text: "\n" });
        return;
      }
      history.current = [...history.current.filter((h) => h !== code), code];
      histIdx.current = -1;
      model.setValue("");
      const s = useStore.getState().session;
      if (s.state === "stopped" || s.state === "exited") await host.call("session.start", {});
      await host.call("console.execute", { code, origin: "console" });
    };

    addLocalCommand(ed, monaco.KeyCode.Enter, () => void submit(), "!suggestWidgetVisible");
    addLocalCommand(ed, monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => ed.trigger("keyboard", "type", { text: "\n" }));
    addLocalCommand(ed, 
      monaco.KeyCode.UpArrow,
      () => {
        const pos = ed.getPosition()!;
        if (pos.lineNumber > 1 || !history.current.length) return ed.trigger("keyboard", "cursorUp", null);
        if (histIdx.current === -1) {
          draft.current = model.getValue();
          histIdx.current = history.current.length;
        }
        histIdx.current = Math.max(0, histIdx.current - 1);
        model.setValue(history.current[histIdx.current] ?? "");
        ed.setPosition({ lineNumber: 1, column: model.getLineMaxColumn(1) });
      },
      "!suggestWidgetVisible",
    );
    addLocalCommand(ed, 
      monaco.KeyCode.DownArrow,
      () => {
        const pos = ed.getPosition()!;
        if (pos.lineNumber < model.getLineCount() || histIdx.current === -1) return ed.trigger("keyboard", "cursorDown", null);
        histIdx.current++;
        if (histIdx.current >= history.current.length) {
          histIdx.current = -1;
          model.setValue(draft.current);
        } else {
          model.setValue(history.current[histIdx.current] ?? "");
        }
        const last = model.getLineCount();
        ed.setPosition({ lineNumber: last, column: model.getLineMaxColumn(last) });
      },
      "!suggestWidgetVisible",
    );
    // Ctrl+C with nothing selected interrupts, as in a terminal. Escape too.
    addLocalCommand(ed, monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyC, () => {
      const sel = ed.getSelection();
      if (sel && !sel.isEmpty() && !isMac) {
        void navigator.clipboard.writeText(model.getValueInRange(sel));
        return;
      }
      void host.call("session.interrupt");
    });
    addLocalCommand(ed, monaco.KeyCode.Escape, () => {
      if (useStore.getState().session.state === "busy") void host.call("session.interrupt");
      else model.setValue("");
    }, "!suggestWidgetVisible && !findWidgetVisible");
    addLocalCommand(ed, monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyL, () => useStore.getState().clearConsole());
    addLocalCommand(ed, monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyR, () => setSearch(""));

    (window as any).__rsageConsoleFocus = () => ed.focus();
    return () => {
      ed.dispose();
      model.dispose();
    };
  }, []);

  const matches = useMemo(() => {
    if (search === null) return [];
    const q = search.toLowerCase();
    return [...history.current].reverse().filter((h) => h.toLowerCase().includes(q)).slice(0, 30);
  }, [search]);

  return (
    <div className="console">
      <div className="panel-toolbar">
        <span className={`dot dot-${session.state}`} />
        <span className="muted">{session.rVersion ? `R ${session.rVersion}` : "R"}</span>
        <span className="muted ellipsis">{session.cwd}</span>
        <span className="spacer" />
        {busy && (
          <button className="btn btn-small" onClick={() => host.call("session.interrupt")} title="실행 중단 (Esc)">
            ■ 중단
          </button>
        )}
        <button className="btn btn-small" onClick={() => setSearch("")} title="명령 이력 검색 (Ctrl+R)">
          이력
        </button>
        <button className="btn btn-small" onClick={() => useStore.getState().clearConsole()} title="콘솔 지우기 (Ctrl+L)">
          지우기
        </button>
      </div>
      <div
        className="console-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
        }}
        onMouseUp={() => {
          if (!window.getSelection()?.toString()) editorRef.current?.focus();
        }}
      >
        {session.state === "stopped" && items.length === 0 && (
          <div className="c-system c-info">
            R 세션이 아직 시작되지 않았습니다. 코드를 입력하면 자동으로 시작합니다.{" "}
            <button className="btn btn-small" onClick={() => host.call("session.start", {}).catch((e) => useStore.getState().notify(e.message, "error"))}>
              지금 시작
            </button>
          </div>
        )}
        {items.map((it) => (
          <Item key={it.key} item={it} />
        ))}
        {inputRequest && <InputRequest prompt={inputRequest.prompt} password={inputRequest.password} />}
        <div className={`console-input-row ${inputRequest ? "hidden" : ""}`}>
          <span className={`c-prompt ${busy ? "busy" : ""}`}>{busy ? "…" : ">"}</span>
          <div className="console-input" ref={inputHost} />
        </div>
      </div>
      {search !== null && (
        <div className="history-search" onKeyDown={(e) => e.key === "Escape" && setSearch(null)}>
          <input
            autoFocus
            className="text-input"
            placeholder="명령 이력 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0] && !e.nativeEvent.isComposing) {
                editorRef.current?.setValue(matches[0]);
                setSearch(null);
                editorRef.current?.focus();
              }
            }}
          />
          <ul>
            {matches.map((m, i) => (
              <li
                key={i}
                onClick={() => {
                  editorRef.current?.setValue(m);
                  setSearch(null);
                  editorRef.current?.focus();
                }}
              >
                <code>{m}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function InputRequest({ prompt, password }: { prompt: string; password: boolean }) {
  const [v, setV] = useState("");
  return (
    <div className="c-input-request">
      <span>{prompt}</span>
      <input
        autoFocus
        className="text-input"
        type={password ? "password" : "text"}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            useStore.getState().pushConsole({ type: "stream", name: "stdout", text: `${prompt}${password ? "••••" : v}\n` });
            useStore.setState({ inputRequest: undefined });
            void host.call("console.input", { value: v });
          }
        }}
      />
    </div>
  );
}
