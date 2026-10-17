import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { diffLines } from "diff";
import type { AssistantContext, AssistantImage, AssistantItem, AssistantRef, EditApprovalScope } from "@rsage/shared";
import { host } from "../host/client";
import { activeEditor, openFile } from "../editor/files";
import { useStore } from "../store";
import { newConversation, send, setModel, useAssistant } from "../assistant";
import { HistoryMenu } from "./AssistantHistory";
import "./assistant.css";
import { useAiSettings } from "./AiSettingsDialog";

type ToolItem = Extract<AssistantItem, { kind: "tool" }>;

/** The AI assistant: conversation, tool activity with approvals, and the input box with a model picker. */
export function AssistantPanel() {
  const status = useAssistant((s) => s.status);
  const current = useAssistant((s) => s.current);
  const [history, setHistory] = useState(false);
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
      <div className="panel-toolbar conv-toolbar">
        <button className="btn btn-small" onClick={() => setHistory((h) => !h)} disabled={!project} title="대화 기록">
          기록
        </button>
        <span className="conv-title ellipsis" title={current?.title}>
          {current?.title ?? "새 대화"}
        </span>
        <button className="btn btn-small" onClick={() => newConversation()} disabled={!project} title="새 대화">
          ＋
        </button>
        <button className="btn btn-small" onClick={() => useAiSettings.setState({ open: true })} title="AI 연결 설정">
          ⚙
        </button>
        {history && <HistoryMenu onClose={() => setHistory(false)} />}
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

type Candidate = { key: string; label: string; hint: string; ref: AssistantRef };

const MAX_SIDE = 2000;

/** Reads an image file as base64, scaling it down when it is very large. */
async function readImage(file: File): Promise<AssistantImage> {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const keep = scale === 1 && /^image\/(png|jpeg|gif|webp)$/.test(file.type) && file.size < 4_000_000;
  let dataUrl = url;
  if (!keep) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    dataUrl = file.type === "image/png" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.9);
  }
  const [head, data] = dataUrl.split(",");
  return { mime: head!.slice(5, head!.indexOf(";")), data: data!, name: file.name || undefined };
}

/** The "@query" being typed just before the caret, if any. */
function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  return m ? { start: caret - m[2]!.length - 1, query: m[2]! } : null;
}

function refLabel(r: AssistantRef) {
  return r.kind === "conversation" ? r.title : r.path.split("/").pop() || r.path;
}

const REF_ICON: Record<AssistantRef["kind"], string> = { file: "📄", folder: "📁", conversation: "💬" };

function Composer({ disabled, running }: { disabled: boolean; running: boolean }) {
  const status = useAssistant((s) => s.status);
  const model = useAssistant((s) => s.model);
  const includeContext = useAssistant((s) => s.includeContext);
  const current = useAssistant((s) => s.current);
  const conversations = useAssistant((s) => s.conversations);
  const project = useStore((s) => s.project);
  const activeFile = useStore((s) => s.activeFile);
  const [text, setText] = useState("");
  const [refs, setRefs] = useState<AssistantRef[]>([]);
  const [images, setImages] = useState<AssistantImage[]>([]);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [sel, setSel] = useState(0);
  const [files, setFiles] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (window as any).__rsageAssistantFocus = () => taRef.current?.focus();
  }, []);
  // The project's files are listed when the user first types @, and again after a project change.
  useEffect(() => setFiles(null), [project?.path]);
  useEffect(() => {
    if (mention && files === null && project)
      void host.call("fs.walk").then((r) => setFiles(r.files)).catch(() => setFiles([]));
  }, [mention, files, project]);

  const candidates = useMemo((): Candidate[] => {
    if (!mention || !project) return [];
    const q = mention.query.toLowerCase();
    const hit = (s: string) => !q || s.toLowerCase().includes(q);
    const out: Candidate[] = [];
    for (const c of conversations)
      if (c.id !== current?.id && hit(c.title)) out.push({ key: `c:${c.id}`, label: c.title, hint: "지난 대화", ref: { kind: "conversation", id: c.id, title: c.title } });
    const folders = new Set<string>();
    for (const f of files ?? []) {
      const parts = f.split("/");
      for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"));
    }
    const abs = (rel: string) => `${project.path}/${rel}`;
    for (const d of [...folders].sort()) if (hit(d)) out.push({ key: `d:${d}`, label: `${d.split("/").pop()}/`, hint: d, ref: { kind: "folder", path: abs(d) } });
    for (const f of files ?? []) if (hit(f)) out.push({ key: `f:${f}`, label: f.split("/").pop()!, hint: f, ref: { kind: "file", path: abs(f) } });
    // Exact name matches first, then conversations, folders, files in that order.
    const exact = (c: Candidate) => (q && c.label.toLowerCase().startsWith(q) ? 0 : 1);
    return out.map((c, i) => ({ c, i })).sort((a, b) => exact(a.c) - exact(b.c) || a.i - b.i).map((x) => x.c).slice(0, 30);
  }, [mention, files, conversations, current?.id, project]);

  const pick = (c: Candidate) => {
    if (!mention) return;
    const caret = mention.start + 1 + mention.query.length;
    const name = c.ref.kind === "conversation" ? `대화:${refLabel(c.ref).slice(0, 16).trim()}` : refLabel(c.ref);
    const token = `@${name.replace(/\s+/g, "_")} `;
    const next = text.slice(0, mention.start) + token + text.slice(caret);
    setText(next);
    setRefs((rs) => (rs.some((r) => JSON.stringify(r) === JSON.stringify(c.ref)) ? rs : [...rs, c.ref]));
    setMention(null);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = mention.start + token.length;
    });
  };

  const addImages = async (list: File[]) => {
    const imgs = list.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return false;
    try {
      const read = await Promise.all(imgs.map(readImage));
      setImages((cur) => [...cur, ...read].slice(0, 8));
    } catch {
      useStore.getState().notify("그림을 읽지 못했습니다.", "error");
    }
    return true;
  };

  const submit = async () => {
    const t = text.trim();
    if ((!t && !images.length) || running || disabled) return;
    const a = activeEditor();
    const context: AssistantContext = { refs: refs.length ? refs : undefined, images: images.length ? images : undefined };
    if (a) {
      const sel = a.editor.getSelection();
      const m = a.editor.getModel();
      const selText = sel && m && !sel.isEmpty() ? m.getValueInRange(sel) : "";
      context.file = a.path;
      context.selection = selText ? { text: selText, startLine: sel!.startLineNumber, endLine: sel!.endLineNumber } : undefined;
    }
    const saved = { text, refs, images };
    setText("");
    setRefs([]);
    setImages([]);
    try {
      await send(t || "첨부한 그림을 봐 줘.", context);
    } catch (e: any) {
      useStore.getState().notify(e.message, "error");
      setText(saved.text);
      setRefs(saved.refs);
      setImages(saved.images);
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

  const updateMention = (value: string, caret: number) => {
    const m = mentionAt(value, caret);
    setMention(m);
    setSel(0);
  };

  return (
    <div
      className={`composer ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        if (disabled || ![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        setDragging(false);
        if (disabled || !e.dataTransfer.files.length) return;
        e.preventDefault();
        void addImages([...e.dataTransfer.files]);
      }}
    >
      {(refs.length > 0 || images.length > 0) && (
        <div className="composer-attachments">
          {refs.map((r, i) => (
            <span key={i} className="chip on attach-chip" title={r.kind === "conversation" ? "지난 대화" : r.path}>
              {REF_ICON[r.kind]} {refLabel(r)}
              <button onClick={() => setRefs((rs) => rs.filter((_, j) => j !== i))} title="빼기">
                ×
              </button>
            </span>
          ))}
          {images.map((img, i) => (
            <span key={`img${i}`} className="attach-image" title={img.name ?? "그림"}>
              <img src={`data:${img.mime};base64,${img.data}`} alt={img.name ?? "그림"} />
              <button onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))} title="빼기">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {mention && candidates.length > 0 && (
        <div className="mention-menu">
          {candidates.map((c, i) => (
            <div
              key={c.key}
              className={`mention-item ${i === sel ? "sel" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              onMouseEnter={() => setSel(i)}
            >
              <span>{REF_ICON[c.ref.kind]}</span>
              <span className="ellipsis">{c.label}</span>
              <span className="muted small ellipsis mention-hint">{c.hint}</span>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={taRef}
        className="composer-input"
        placeholder={disabled ? "AI 연결 후 사용할 수 있습니다" : "무엇을 분석할까요? @로 파일·폴더·지난 대화 참조, 그림은 붙여넣기·끌어놓기 (Enter 보내기)"}
        value={text}
        disabled={disabled}
        rows={3}
        onChange={(e) => {
          setText(e.target.value);
          updateMention(e.target.value, e.target.selectionStart);
        }}
        onSelect={(e) => mention && updateMention(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={() => setMention(null)}
        onPaste={(e) => {
          const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
          if (!imgs.length) return;
          e.preventDefault();
          void addImages(imgs);
        }}
        onKeyDown={(e) => {
          if (mention && candidates.length) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => (s + 1) % candidates.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => (s - 1 + candidates.length) % candidates.length);
              return;
            }
            if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) {
              e.preventDefault();
              pick(candidates[Math.min(sel, candidates.length - 1)]!);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setMention(null);
              return;
            }
          }
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
        <button className="btn btn-small" disabled={disabled} title="그림 첨부" onClick={() => fileInput.current?.click()}>
          그림
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void addImages([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
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
          <button className="btn btn-small btn-primary" disabled={disabled || (!text.trim() && !images.length)} onClick={submit}>
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
          {item.context?.images?.length ? (
            <div className="msg-images">
              {item.context.images.map((img, i) => (
                <img key={i} src={`data:${img.mime};base64,${img.data}`} alt={img.name ?? "그림"} />
              ))}
            </div>
          ) : null}
          {item.context?.refs?.length ? (
            <div className="msg-context muted small">{item.context.refs.map((r) => `${REF_ICON[r.kind]} ${refLabel(r)}`).join("  ")}</div>
          ) : null}
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
  read_conversation: "지난 대화 읽기",
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
  const approve = (ok: boolean, always?: boolean, scope?: EditApprovalScope) =>
    host.call("assistant.approve", { conversationId, itemId: item.id, approve: ok, always, scope });
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
                <>
                  <button className="btn btn-small btn-primary" onClick={() => approve(true, false, "once")} title="이번 변경만 적용합니다. 다음 변경은 다시 묻습니다.">
                    {item.diff?.isNew ? "이번만 만들기" : "이번만 적용"}
                  </button>
                  <button className="btn btn-small" onClick={() => approve(true, false, "file")} title="R Sage를 끌 때까지 이 파일의 변경은 묻지 않고 적용합니다. 다른 파일은 다시 묻습니다.">
                    이 파일은 모두 허용
                  </button>
                  <button className="btn btn-small" onClick={() => approve(true, false, "project")} title="이 프로젝트 폴더 안의 파일 변경은 앞으로 묻지 않고 적용합니다 (AI 연결 설정에서 끌 수 있음).">
                    이 프로젝트는 모두 허용
                  </button>
                </>
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
