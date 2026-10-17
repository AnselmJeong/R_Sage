// Version-control state for the Source Control view: status, history and
// branches from the user's own git, refreshed after every operation, on file
// changes and when the window regains focus (the project watcher skips .git).

import { create } from "zustand";
import type { GitBranch, GitChange, GitCommit, GitStatus } from "@rsage/shared";
import { host } from "./host/client";
import { useStore } from "./store";
import { getDockApi, basename } from "./editor/files";

interface GitState {
  status?: GitStatus;
  log?: GitCommit[];
  branches?: GitBranch[];
  /** What is running now ("pull", "commit", ...), to disable buttons. */
  busy?: string;
  loading: boolean;
}

export const useGit = create<GitState>(() => ({ loading: false }));

let seq = 0;
export async function refreshGit() {
  const mine = ++seq;
  if (!useStore.getState().project) return useGit.setState({ status: undefined, log: undefined, branches: undefined });
  useGit.setState({ loading: true });
  try {
    const status = await host.call("git.status", {});
    const log = status.isRepo && status.hasCommits ? await host.call("git.log", { limit: 80 }) : [];
    if (mine === seq) useGit.setState({ status, log, loading: false });
  } catch (e) {
    if (mine === seq) useGit.setState({ loading: false });
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
export function refreshGitSoon(ms = 400) {
  clearTimeout(timer);
  timer = setTimeout(() => void refreshGit(), ms);
}

export async function loadBranches() {
  try {
    useGit.setState({ branches: await host.call("git.branches", {}) });
  } catch {}
}

/** Runs one git operation with the view marked busy; errors become a toast. */
export async function gitOp<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  useGit.setState({ busy: label });
  try {
    return await fn();
  } catch (e) {
    useStore.getState().notify(e instanceof Error ? e.message : String(e), "error");
    return undefined;
  } finally {
    useGit.setState({ busy: undefined });
    await refreshGit();
  }
}

/** Number of changed files, for the activity bar badge. */
export function changeCount(s?: GitStatus) {
  return s ? new Set(s.changes.map((c) => c.path)).size : 0;
}

export function relPath(path: string, root?: string) {
  return root && path.startsWith(root + "/") ? path.slice(root.length + 1) : path;
}

export const STATUS_LABEL: Record<string, string> = {
  M: "수정됨",
  A: "추가됨",
  D: "삭제됨",
  R: "이름 바뀜",
  C: "복사됨",
  T: "형식 바뀜",
  U: "충돌",
  "?": "추적 안 됨",
};

export type DiffMode = "working" | "staged" | "commit";
export interface DiffParams {
  path: string;
  origPath?: string;
  mode: DiffMode;
  hash?: string;
}

/** Opens a side-by-side diff as an editor tab. */
export function openDiff(c: GitChange, mode: DiffMode, commit?: GitCommit) {
  const api = getDockApi();
  if (!api) return;
  const id = `diff:${mode}:${commit?.hash ?? ""}:${c.path}`;
  const existing = api.getPanel(id);
  if (existing) return existing.api.setActive();
  const where = mode === "working" ? "작업 트리" : mode === "staged" ? "스테이징" : commit!.short;
  const ref = api.panels.find((p) => p.id.startsWith("editor:") || p.id.startsWith("diff:") || p.id === "welcome-editor");
  api.addPanel({
    id,
    component: "diff",
    title: `${basename(c.path)} (${where})`,
    params: { path: c.path, origPath: c.origPath, mode, hash: commit?.hash } satisfies DiffParams,
    position: ref ? { referencePanel: ref.id, direction: "within" } : undefined,
  });
}

/** "3분 전", "어제", or a date. */
export function relTime(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
  return new Date(ms).toLocaleDateString("ko-KR");
}
