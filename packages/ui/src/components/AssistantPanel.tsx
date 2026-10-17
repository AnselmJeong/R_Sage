import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { diffLines } from "diff";
import type { AssistantItem } from "@rsage/shared";
import { host } from "../host/client";
import { activeEditor, openFile } from "../editor/files";
import { useStore } from "../store";
import {
  deleteConversation,
  newConversation,
  openConversation,
  send,
  setModel,
  useAssistant,
} from "../assistant";
import { useAiSettings } from "./AiSettingsDialog";
import { confirmDialog } from "./Dialogs";

type ToolItem = Extract<AssistantItem, { kind: "tool" }>;

/** The AI assistant: conversation, tool activity with approvals, and the input box with a model picker. */
export function AssistantPanel() {
  const status = useAssistant((s) => s.status);
  const current = useAssistant((s) => s.current);
  const conversations = useAssistant((s) => s.conversations);
  const running = useAssistant((s) => (current ? !!s.running[current.id] : false));
  const project = useStore((s) => s.project);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Follow the conversation while it grows (streamed text, opened tool cards,
  // loaded plots), unless the user scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const follow = () => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    };
    const mo = new MutationObserver(follow);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener("load", follow, true);
    follow();
    return () => {
      mo.disconnect();
      el.removeEventListener("load", follow, true);
    };
  }, []);
  useEffect(() => {
    stick.current = true;
  }, [current?.id]);

  const configured = status?.providers.some((p) => p.configured && p.id !== "fake");
  const hasModels = (status?.models.length ?? 0) > 0;

  return (
    <div className="assistant">
      <div className="panel-toolbar">
        <select
          className="select-small conv-select"
          value={current?.id ?? ""}
          onChange={(e) => e.target.value && openConversation(e.target.value)}
          title="대화 목록"
        >
          {!current && <option value="">새 대화</option>}
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <button className="btn btn-small" onClick={() => newConversation()} disabled={!project} title="새 대화">
          ＋
        </button>
        <button
          className="btn btn-small"
          disabled={!current}
          title="이 대화 삭제"
          onClick={async () => {
            if (current && (await confirmDialog({ title: "대화 삭제", message: `"${current.title}" 대화를 삭제할까요?`, confirm: "삭제", danger: true })))
              await deleteConversation(current.id);
          }}
        >
          삭제
        </button>
        <button className="btn btn-small" onClick={() => useAiSettings.setState({ open: true })} title="AI 연결 설정">
          ⚙
        </button>
      </div>

      <div
        className="assistant-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {!hasModels ? (
          <div className="assistant-empty">
            <h4>AI 조수 연결하기</h4>
            <p>Claude나 ChatGPT 구독(또는 API 키)을 연결하면 조수가 프로젝트의 데이터와 파일을 보고 R 분석을 실행하고, 보고서(.qmd)를 고쳐 줍니다.</p>
            <button className="btn btn-primary" onClick={() => useAiSettings.setState({ open: true })}>
              AI 연결 설정
            </button>
            {status && !configured && <p className="muted small">AI 연결 설정에서 로그인 버튼을 누르면 브라우저에서 구독 계정으로 로그인합니다.</p>}
          </div>
        ) : !current || current.items.length === 0 ? (
          <div className="assistant-empty">
            <h4>무엇을 도와드릴까요?</h4>
            <ul className="muted">
              <li>data 폴더의 csv를 읽고 변수들을 요약해 줘</li>
              <li>집단별 평균을 비교하는 t-검정을 하고 그래프를 그려 줘</li>
              <li>지금까지 분석을 report.qmd 보고서로 정리해 줘</li>
            </ul>
          </div>
        ) : (
          current.items.map((item) => <ItemView key={item.id} item={item} conversationId={current.id} running={running} />)
        )}
        {running && <div className="assistant-working">답하는 중…</div>}
      </div>

      <Composer disabled={!hasModels || !project} running={running} />
    </div>
  );
}

function Composer({ disabled, running }: { disabled: boolean; running: boolean }) {
  const status = useAssistant((s) => s.status);
  const model = useAssistant((s) => s.model);
  const includeContext = useAssistant((s) => s.includeContext);
  const current = useAssistant((s) => s.current);
  const activeFile = useStore((s) => s.activeFile);
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    (window as any).__rsageAssistantFocus = () => taRef.current?.focus();
  }, []);

  const submit = async () => {
    const t = text.trim();
    if (!t || running || disabled) return;
    const a = activeEditor();
    let context: Parameters<typeof send>[1];
    if (a) {
      const sel = a.editor.getSelection();
      const model = a.editor.getModel();
      const selText = sel && model && !sel.isEmpty() ? model.getValueInRange(sel) : "";
      context = { file: a.path, selection: selText ? { text: selText, startLine: sel!.startLineNumber, endLine: sel!.endLineNumber } : undefined };
    }
    setText("");
    try {
      await send(t, context);
    } catch (e: any) {
      useStore.getState().notify(e.message, "error");
      setText(t);
    }
  };

  const groups = useMemo(() => {
    const g = new Map<string, { id: string; label: string }[]>();
    for (const m of status?.models ?? []) {
      const label = status?.providers.find((p) => p.id === m.provider)?.label ?? m.provider;
      g.set(label, [...(g.get(label) ?? []), m]);
    }
    return [...g.entries()];
  }, [status]);

  return (
    <div className="composer">
      <textarea
        ref={taRef}
        className="composer-input"
        placeholder={disabled ? "AI 연결 후 사용할 수 있습니다" : "무엇을 분석할까요? (Enter 보내기, Shift+Enter 줄바꿈)"}
        value={text}
        disabled={disabled}
        rows={3}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="composer-bar">
        <select className="select-small" value={model ?? ""} onChange={(e) => setModel(e.target.value)} disabled={disabled} title="모델">
          {groups.map(([label, ms]) => (
            <optgroup key={label} label={label}>
              {ms.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {activeFile && (
          <button
            className={`chip ${includeContext ? "on" : ""}`}
            title="열린 파일과 선택한 부분을 함께 보냅니다"
            onClick={() => useAssistant.setState({ includeContext: !includeContext })}
          >
            {includeContext ? "✓ " : ""}
            {activeFile.split("/").pop()}
          </button>
        )}
        <span className="spacer" />
        {running ? (
          <button className="btn btn-small" onClick={() => current && host.call("assistant.stop", { conversationId: current.id })}>
            ■ 중단
          </button>
        ) : (
          <button className="btn btn-small btn-primary" disabled={disabled || !text.trim()} onClick={submit}>
            보내기
          </button>
        )}
      </div>
    </div>
  );
}

function ItemView({ item, conversationId, running }: { item: AssistantItem; conversationId: string; running: boolean }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="msg msg-user">
          <div className="msg-body">{item.text}</div>
          {item.context?.file && (
            <div className="msg-context muted small">
              {item.context.file.split("/").pop()}
              {item.context.selection ? ` · ${item.context.selection.startLine}–${item.context.selection.endLine}행` : ""}
            </div>
          )}
        </div>
      );
    case "assistant":
      if (!item.text && !item.thinking) return null;
      return (
        <div className="msg msg-assistant">
          {item.thinking && (
            <details className="msg-thinking">
              <summary className="muted small">생각 과정</summary>
              <div className="small">{item.thinking}</div>
            </details>
          )}
          {item.text && <Markdown text={item.text} />}
        </div>
      );
    case "tool":
      return <ToolView item={item} conversationId={conversationId} running={running} />;
    case "error":
      return <div className="msg msg-error">{item.text}</div>;
  }
}

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true, breaks: true }) as string), [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

const TOOL_LABEL: Record<string, string> = {
  list_files: "파일 목록 보기",
  read_file: "파일 읽기",
  search: "프로젝트 검색",
  run_r: "R 코드 실행",
  get_variables: "변수 보기",
  get_plot: "플롯 보기",
  write_file: "파일 쓰기",
  edit_file: "파일 수정",
};

const STATUS_LABEL: Record<ToolItem["status"], string> = {
  "awaiting-approval": "승인 대기",
  running: "진행 중",
  done: "완료",
  error: "오류",
  denied: "거절함",
};

function ToolView({ item, conversationId }: { item: ToolItem; conversationId: string; running: boolean }) {
  const [open, setOpen] = useState(item.status === "awaiting-approval");
  useEffect(() => {
    if (item.status === "awaiting-approval") setOpen(true);
  }, [item.status]);
  const approve = (ok: boolean, always?: boolean) => host.call("assistant.approve", { conversationId, itemId: item.id, approve: ok, always });
  const target = item.input?.path ?? item.input?.dir ?? item.input?.query ?? item.input?.purpose ?? "";
  const isFile = item.name === "write_file" || item.name === "edit_file";

  return (
    <div className={`tool tool-${item.status}`}>
      <button className="tool-head" onClick={() => setOpen(!open)}>
        <span className="tool-twisty">{open ? "▾" : "▸"}</span>
        <span className="tool-name">{TOOL_LABEL[item.name] ?? item.name}</span>
        <span className="tool-target ellipsis">{target}</span>
        <span className={`badge badge-${item.status}`}>{STATUS_LABEL[item.status]}</span>
      </button>
      {open && (
        <div className="tool-body">
          {item.name === "run_r" && <pre className="tool-code">{item.input?.code}</pre>}
          {isFile && item.diff && <DiffView before={item.diff.before} after={item.diff.after} />}
          {item.status === "awaiting-approval" && (
            <div className="tool-actions">
              {item.name === "run_r" ? (
                <>
                  <button className="btn btn-small btn-primary" onClick={() => approve(true)}>
                    실행
                  </button>
                  <button className="btn btn-small" onClick={() => approve(true, true)} title="앞으로 R 코드는 묻지 않고 실행합니다 (설정에서 끌 수 있음)">
                    항상 허용
                  </button>
                </>
              ) : (
                <button className="btn btn-small btn-primary" onClick={() => approve(true)}>
                  {item.diff?.isNew ? "파일 만들기" : "변경 적용"}
                </button>
              )}
              <button className="btn btn-small" onClick={() => approve(false)}>
                거절
              </button>
            </div>
          )}
          {item.output && item.status !== "awaiting-approval" && <pre className="tool-output">{item.output}</pre>}
          {item.images?.map((src, i) => (
            <img key={i} className="tool-image" src={src} alt="plot" />
          ))}
          {isFile && item.status === "done" && item.diff && (
            <button className="c-srclink" onClick={() => openFile(item.diff!.path)}>
              파일 열기
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DiffView({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => {
    const out: { kind: "add" | "del" | "ctx" | "gap"; text: string }[] = [];
    const parts = diffLines(before, after);
    parts.forEach((p, i) => {
      const lines = p.value.replace(/\n$/, "").split("\n");
      if (p.added || p.removed) {
        for (const l of lines) out.push({ kind: p.added ? "add" : "del", text: l });
        return;
      }
      // Unchanged runs: keep 3 lines of context around changes.
      const head = i > 0 ? lines.slice(0, 3) : [];
      const tail = i < parts.length - 1 ? lines.slice(-3) : [];
      if (lines.length <= head.length + tail.length + 1) for (const l of lines) out.push({ kind: "ctx", text: l });
      else {
        for (const l of head) out.push({ kind: "ctx", text: l });
        out.push({ kind: "gap", text: `… ${lines.length - head.length - tail.length}줄 같음` });
        for (const l of tail) out.push({ kind: "ctx", text: l });
      }
    });
    return out;
  }, [before, after]);
  return (
    <div className="diff">
      {rows.map((r, i) => (
        <div key={i} className={`diff-line diff-${r.kind}`}>
          <span className="diff-sign">{r.kind === "add" ? "+" : r.kind === "del" ? "−" : " "}</span>
          {r.text}
        </div>
      ))}
    </div>
  );
}
