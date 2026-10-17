// The Source Control view, like Positron's: branch, commit box, staged and
// unstaged changes with diffs, sync with the remote, and history. Everything
// runs the user's own git, so their credentials and config apply.

import { useEffect, useRef, useState } from "react";
import type { GitChange, GitCommit } from "@rsage/shared";
import { host } from "../host/client";
import { useStore } from "../store";
import { openFile } from "../editor/files";
import { STATUS_LABEL, gitOp, loadBranches, openDiff, refreshGit, relPath, relTime, useGit } from "../git";
import { confirmDialog, formDialog, promptDialog } from "./Dialogs";

export function SourceControlPanel() {
  const project = useStore((s) => s.project);
  const { status, log, busy, loading } = useGit();
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);

  useEffect(() => {
    void refreshGit();
  }, [project?.path]);

  if (!project) return <div className="scm-note muted">폴더를 열면 버전 관리를 쓸 수 있습니다.</div>;

  const header = (
    <div className="side-header">
      <span>소스 제어</span>
      <span className="spacer" />
      {status?.isRepo && (
        <>
          <button className="btn btn-icon" title="Pull (원격 변경 가져오기)" disabled={!!busy || !status.remotes?.length} onClick={() => void pull()}>
            ⇣
          </button>
          <button className="btn btn-icon" title="Push (원격에 올리기)" disabled={!!busy || !status.remotes?.length || !status.hasCommits} onClick={() => void push()}>
            ⇡
          </button>
          <button className="btn btn-icon" title="Fetch (원격 확인만)" disabled={!!busy || !status.remotes?.length} onClick={() => void gitOp("fetch", () => host.call("git.fetch", {}))}>
            ⟳
          </button>
        </>
      )}
      <button className="btn btn-icon" title="새로 고침" disabled={loading} onClick={() => void refreshGit()}>
        ↻
      </button>
    </div>
  );

  if (!status) return <div className="scm">{header}</div>;
  if (status.gitMissing)
    return (
      <div className="scm">
        {header}
        <div className="scm-note">
          git을 찾지 못했습니다. 터미널에서 <code>xcode-select --install</code> 을 실행해 설치한 뒤 새로 고침을 누르세요.
        </div>
      </div>
    );
  if (!status.isRepo)
    return (
      <div className="scm">
        {header}
        <div className="scm-note">
          <p className="muted">이 폴더는 아직 git 저장소가 아닙니다.</p>
          <button className="btn btn-primary" disabled={!!busy} onClick={() => void initRepo()}>
            Git 저장소 초기화
          </button>
        </div>
      </div>
    );

  const root = status.root;
  const staged = status.changes.filter((c) => c.staged);
  const conflicts = status.changes.filter((c) => c.conflict);
  const unstaged = status.changes.filter((c) => !c.staged && !c.conflict);
  const branch = status.detached ? "(분리된 HEAD)" : status.branch ?? "";

  const commit = async () => {
    let msg = message.trim();
    if (!msg && !amend) return useStore.getState().notify("커밋 메시지를 적으세요.", "error");
    if (!staged.length && !amend) {
      if (!unstaged.length && !conflicts.length) return useStore.getState().notify("커밋할 변경이 없습니다.");
      const ok = await confirmDialog({
        title: "모든 변경 커밋",
        message: "스테이징된 변경이 없습니다. 모든 변경을 스테이징하고 커밋할까요?",
        confirm: "모두 커밋",
      });
      if (!ok) return;
      const staged = await gitOp("stage", async () => (await host.call("git.stage", { paths: unstaged.map((c) => c.path) }), true));
      if (!staged) return;
    }
    if (!msg && amend) msg = log?.[0]?.subject ?? "";
    const r = await gitOp("commit", () => host.call("git.commit", { message: msg, amend }));
    if (r) {
      setMessage("");
      setAmend(false);
      useStore.getState().notify(`커밋했습니다: ${msg.split("\n")[0]}`);
    }
  };

  return (
    <div className="scm">
      {header}
      <BranchBar branch={branch} />
      <div className="scm-commit">
        <textarea
          className="text-input"
          rows={message.includes("\n") ? 4 : 2}
          placeholder={`메시지 (⌘↵ 로 '${branch}'에 커밋)`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void commit();
            }
          }}
        />
        <div className="scm-commit-row">
          <button className="btn btn-primary scm-commit-btn" disabled={!!busy} onClick={() => void commit()}>
            {busy === "commit" ? "커밋 중…" : amend ? "✓ 마지막 커밋 고치기" : staged.length || !status.changes.length ? "✓ 커밋" : "✓ 모두 커밋"}
          </button>
          {status.hasCommits && (
            <label className="scm-amend muted small" title="새 커밋 대신 마지막 커밋에 합칩니다 (amend)">
              <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} /> 마지막 커밋 수정
            </label>
          )}
        </div>
        {busy && busy !== "commit" && <div className="muted small">{busyLabel(busy)}…</div>}
      </div>
      <div className="scm-scroll">
        {conflicts.length > 0 && (
          <Section title="병합 충돌" items={conflicts} root={root} kind="conflict" />
        )}
        {staged.length > 0 && <Section title="스테이징된 변경" items={staged} root={root} kind="staged" />}
        <Section title="변경" items={unstaged} root={root} kind="unstaged" empty={!staged.length && !conflicts.length ? "변경 없음" : undefined} />
        <History log={log ?? []} root={root} />
      </div>
    </div>
  );

  async function pull() {
    const r = await gitOp("pull", () => host.call("git.pull", {}));
    if (r) useStore.getState().notify(r.output.split("\n").pop() || "Pull 완료");
  }
  async function push() {
    const r = await gitOp("push", () => host.call("git.push", {}));
    if (r) useStore.getState().notify("Push 완료");
  }
  async function initRepo() {
    const ok = await confirmDialog({
      title: "Git 저장소 초기화",
      message: `${project!.path} 에 git 저장소를 만들고 R 프로젝트용 .gitignore를 추가합니다.`,
      confirm: "초기화",
    });
    if (!ok) return;
    await gitOp("init", async () => {
      await host.call("git.init", {});
      for (const p of [".Rproj.user/", ".Rhistory", ".RData", ".Ruserdata", ".DS_Store", "/.quarto/", "*_files/", "*_cache/"])
        await host.call("git.ignore", { pattern: p });
    });
  }
}

function busyLabel(b: string) {
  return { pull: "가져오는 중", push: "올리는 중", fetch: "원격 확인 중", init: "초기화 중", stage: "스테이징 중", checkout: "브랜치 바꾸는 중" }[b] ?? "작업 중";
}

function BranchBar({ branch }: { branch: string }) {
  const { status, branches, busy } = useGit();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    void loadBranches();
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const switchTo = (name: string) => {
    setOpen(false);
    void gitOp("checkout", () => host.call("git.checkout", { branch: name }));
  };
  const create = async () => {
    setOpen(false);
    const name = await promptDialog({ title: "새 브랜치", message: `현재 '${branch}'에서 새 브랜치를 만들고 그 브랜치로 바꿉니다.`, placeholder: "예: analysis-v2" });
    if (name?.trim()) await gitOp("checkout", () => host.call("git.checkout", { branch: name.trim().replace(/\s+/g, "-"), create: true }));
  };
  const addRemote = async () => {
    setOpen(false);
    const v = await formDialog({
      title: "원격 저장소 연결",
      message: "GitHub 등에 만든 빈 저장소의 주소를 넣으세요. 연결한 뒤 Push 하면 올라갑니다.",
      fields: [
        { key: "url", label: "주소", placeholder: "https://github.com/me/report.git", required: true },
        { key: "name", label: "이름", value: "origin", required: true },
      ],
      confirm: "연결",
    });
    if (v) await gitOp("remote", () => host.call("git.addRemote", { name: v.name!.trim(), url: v.url!.trim() }));
  };
  const local = (branches ?? []).filter((b) => !b.remote);
  const remote = (branches ?? []).filter((b) => b.remote && !local.some((l) => b.name.endsWith("/" + l.name)));
  return (
    <div className="scm-branch" ref={ref}>
      <button className="scm-branch-btn" title="브랜치 바꾸기 / 만들기" disabled={!!busy} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" className="scm-branch-icon">
          <circle cx="6" cy="5" r="2.2" />
          <circle cx="6" cy="19" r="2.2" />
          <circle cx="18" cy="7" r="2.2" />
          <path d="M6 7.2v9.6M18 9.2c0 5-12 3-12 7.6" />
        </svg>
        <span className="ellipsis">{branch}</span>
        <span className="tb-caret">▾</span>
      </button>
      {status?.upstream ? (
        <span className="muted small" title={`추적: ${status.upstream}`}>
          {status.ahead ? `↑${status.ahead} ` : ""}
          {status.behind ? `↓${status.behind}` : ""}
          {!status.ahead && !status.behind ? "최신" : ""}
        </span>
      ) : status?.remotes?.length ? (
        <span className="muted small">원격에 없음</span>
      ) : (
        <span className="muted small">원격 없음</span>
      )}
      {open && (
        <div className="tb-dropdown scm-branch-menu">
          <div className="menu-item" onClick={() => void create()}>
            ＋ 새 브랜치…
          </div>
          {!status?.remotes?.length && (
            <div className="menu-item" onClick={() => void addRemote()}>
              ⇡ 원격 저장소 연결…
            </div>
          )}
          <div className="tb-sep" />
          <div className="tb-heading">브랜치</div>
          {local.map((b) => (
            <div key={b.name} className={`menu-item ${b.current ? "current" : ""}`} onClick={() => !b.current && switchTo(b.name)}>
              <span className="ellipsis">
                {b.current ? "✓ " : ""}
                {b.name}
              </span>
              {b.date && <span className="muted small tb-hint">{relTime(b.date * 1000)}</span>}
            </div>
          ))}
          {remote.length > 0 && <div className="tb-heading">원격 브랜치</div>}
          {remote.map((b) => (
            <div key={b.name} className="menu-item" onClick={() => switchTo(b.name)}>
              <span className="ellipsis">{b.name}</span>
            </div>
          ))}
          {!branches && <div className="muted small scm-pad">불러오는 중…</div>}
        </div>
      )}
    </div>
  );
}

type Kind = "staged" | "unstaged" | "conflict";

function Section({ title, items, root, kind, empty }: { title: string; items: GitChange[]; root?: string; kind: Kind; empty?: string }) {
  const [open, setOpen] = useState(true);
  const busy = !!useGit((s) => s.busy);
  const paths = items.map((c) => c.path);
  return (
    <div className="scm-section">
      <div className="scm-section-head" onClick={() => setOpen(!open)}>
        <span className="twisty">{open ? "▾" : "▸"}</span>
        <span>{title}</span>
        <span className="spacer" />
        {items.length > 0 && (
          <span className="scm-actions" onClick={(e) => e.stopPropagation()}>
            {kind === "staged" ? (
              <button className="btn btn-icon" title="모두 스테이징 취소" disabled={busy} onClick={() => void gitOp("stage", () => host.call("git.unstage", { paths }))}>
                −
              </button>
            ) : (
              <>
                {kind === "unstaged" && (
                  <button className="btn btn-icon" title="모든 변경 되돌리기" disabled={busy} onClick={() => void discard(items)}>
                    ↶
                  </button>
                )}
                <button className="btn btn-icon" title="모두 스테이징" disabled={busy} onClick={() => void gitOp("stage", () => host.call("git.stage", { paths }))}>
                  ＋
                </button>
              </>
            )}
          </span>
        )}
        <span className="scm-count">{items.length}</span>
      </div>
      {open && items.map((c) => <ChangeRow key={c.path + kind} c={c} root={root} kind={kind} />)}
      {open && !items.length && empty && <div className="muted small scm-pad">{empty}</div>}
    </div>
  );
}

function ChangeRow({ c, root, kind }: { c: GitChange; root?: string; kind: Kind }) {
  const busy = !!useGit((s) => s.busy);
  const rel = relPath(c.path, root);
  const name = rel.split("/").pop()!;
  const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
  const deleted = c.status === "D";
  return (
    <div
      className="scm-row"
      title={`${rel} · ${STATUS_LABEL[c.status] ?? c.status}${c.origPath ? ` (원래 ${relPath(c.origPath, root)})` : ""}`}
      onClick={() => (kind === "conflict" ? void openFile(c.path) : openDiff(c, kind === "staged" ? "staged" : "working"))}
    >
      <span className={`scm-name ellipsis ${deleted ? "deleted" : ""}`}>{name}</span>
      <span className="scm-dir muted small ellipsis">{dir}</span>
      <span className="spacer" />
      <span className="scm-actions" onClick={(e) => e.stopPropagation()}>
        {!deleted && (
          <button className="btn btn-icon" title="파일 열기" onClick={() => void openFile(c.path)}>
            ↗
          </button>
        )}
        {kind === "unstaged" && c.status === "?" && (
          <button className="btn btn-icon" title=".gitignore에 추가" disabled={busy} onClick={() => void gitOp("ignore", () => host.call("git.ignore", { pattern: "/" + relPath(c.path, root) }))}>
            ⊘
          </button>
        )}
        {kind === "unstaged" && (
          <button className="btn btn-icon" title="변경 되돌리기" disabled={busy} onClick={() => void discard([c])}>
            ↶
          </button>
        )}
        {kind === "staged" ? (
          <button className="btn btn-icon" title="스테이징 취소" disabled={busy} onClick={() => void gitOp("stage", () => host.call("git.unstage", { paths: [c.path] }))}>
            −
          </button>
        ) : (
          <button className="btn btn-icon" title={kind === "conflict" ? "해결됨으로 표시 (스테이징)" : "스테이징"} disabled={busy} onClick={() => void gitOp("stage", () => host.call("git.stage", { paths: [c.path] }))}>
            ＋
          </button>
        )}
      </span>
      <span className={`scm-status st-${c.status === "?" ? "U2" : c.status}`}>{c.status === "?" ? "U" : c.status === "U" ? "!" : c.status}</span>
    </div>
  );
}

async function discard(items: GitChange[]) {
  const untracked = items.filter((c) => c.status === "?").map((c) => c.path);
  const tracked = items.filter((c) => c.status !== "?").map((c) => c.path);
  const what = items.length === 1 ? `'${items[0]!.path.split("/").pop()}'의 변경` : `${items.length}개 파일의 변경`;
  const ok = await confirmDialog({
    title: "변경 되돌리기",
    message: `${what}을 버리고 마지막 커밋(또는 스테이징된) 상태로 되돌립니다.${untracked.length ? " 새 파일은 휴지통으로 옮깁니다." : " 되돌린 내용은 복구할 수 없습니다."}`,
    confirm: "되돌리기",
    danger: true,
  });
  if (ok) await gitOp("discard", () => host.call("git.discard", { paths: tracked, untracked }));
}

function History({ log, root }: { log: GitCommit[]; root?: string }) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<string>();
  const [files, setFiles] = useState<Record<string, GitChange[]>>({});
  const toggle = async (c: GitCommit) => {
    if (expanded === c.hash) return setExpanded(undefined);
    setExpanded(c.hash);
    if (!files[c.hash]) {
      try {
        const f = await host.call("git.commitFiles", { hash: c.hash });
        setFiles((m) => ({ ...m, [c.hash]: f }));
      } catch (e) {
        useStore.getState().notify(e instanceof Error ? e.message : String(e), "error");
      }
    }
  };
  return (
    <div className="scm-section">
      <div className="scm-section-head" onClick={() => setOpen(!open)}>
        <span className="twisty">{open ? "▾" : "▸"}</span>
        <span>기록</span>
        <span className="spacer" />
        <span className="scm-count">{log.length}</span>
      </div>
      {open && !log.length && <div className="muted small scm-pad">아직 커밋이 없습니다.</div>}
      {open &&
        log.map((c) => (
          <div key={c.hash}>
            <div
              className={`scm-commit-item ${expanded === c.hash ? "open" : ""}`}
              title={`${c.short} · ${c.author} <${c.email}>\n${new Date(c.date).toLocaleString("ko-KR")}\n\n${c.subject}`}
              onClick={() => void toggle(c)}
            >
              <span className="scm-dot" />
              <span className="ellipsis scm-subject">{c.subject}</span>
              {c.refs
                .filter((r) => r !== "HEAD" && !r.endsWith("/HEAD"))
                .slice(0, 2)
                .map((r) => (
                  <span key={r} className="scm-ref">
                    {r.replace(/^HEAD -> /, "").replace(/^tag: /, "🏷 ")}
                  </span>
                ))}
              <span className="muted small scm-when">{relTime(c.date)}</span>
            </div>
            {expanded === c.hash && (
              <div className="scm-commit-files">
                <div className="muted small scm-pad">
                  {c.author} · {c.short}
                </div>
                {(files[c.hash] ?? []).map((f) => {
                  const rel = relPath(f.path, root);
                  return (
                    <div key={f.path} className="scm-row" title={rel} onClick={() => openDiff(f, "commit", c)}>
                      <span className="scm-name ellipsis">{rel.split("/").pop()}</span>
                      <span className="scm-dir muted small ellipsis">{rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ""}</span>
                      <span className="spacer" />
                      <span className={`scm-status st-${f.status}`}>{f.status}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
