// Version control through the user's own git (and so their credentials,
// config and hooks). Paths going out are absolute; the project folder may sit
// anywhere inside the repository.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { GitBranch, GitChange, GitCommit, GitStatus } from "@rsage/shared";

export class GitError extends Error {}

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function gitBinary(): string | null {
  for (const p of [process.env.RSAGE_GIT, "/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"]) if (p && existsSync(p)) return p;
  return Bun.which("git");
}

export class GitService {
  constructor(private cwd: () => string | undefined) {}

  async run(args: string[], opts: { input?: string; allowFail?: boolean; timeoutMs?: number } = {}): Promise<GitResult> {
    const git = gitBinary();
    if (!git) throw new GitError("git을 찾지 못했습니다. Xcode Command Line Tools(xcode-select --install)나 Homebrew로 git을 설치하세요.");
    const cwd = this.cwd();
    if (!cwd) throw new GitError("열린 프로젝트가 없습니다.");
    const p = Bun.spawn([git, ...args], {
      cwd,
      // Never wait on a password prompt nobody can see; credential helpers and ssh-agent still work.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
      stdin: opts.input !== undefined ? new TextEncoder().encode(opts.input) : "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => p.kill(), opts.timeoutMs ?? 60_000);
    const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    clearTimeout(timer);
    if (code !== 0 && !opts.allowFail) throw new GitError(friendly(stderr.trim() || stdout.trim() || `git ${args[0]} failed (${code})`));
    return { code, stdout, stderr };
  }

  /**
   * The repository root as seen from the project folder. --show-toplevel gives
   * the real path (/private/var/…, a resolved Google Drive link), which would not
   * match the paths the editor uses, so walk up from the project path instead.
   */
  async root(): Promise<string | null> {
    const r = await this.run(["rev-parse", "--show-cdup"], { allowFail: true });
    if (r.code !== 0) return null;
    const cwd = this.cwd()!;
    return resolve(cwd, r.stdout.trim() || ".");
  }

  async status(): Promise<GitStatus> {
    if (!gitBinary()) return { isRepo: false, gitMissing: true, changes: [] };
    const root = await this.root();
    if (!root) return { isRepo: false, changes: [] };
    const r = await this.run(["status", "--porcelain=v1", "-b", "-z", "--untracked-files=all"]);
    const st = parseStatus(r.stdout, root);
    const head = await this.run(["rev-parse", "--verify", "-q", "HEAD"], { allowFail: true });
    const remotes = (await this.run(["remote"], { allowFail: true })).stdout.split("\n").filter(Boolean);
    return { ...st, root, hasCommits: head.code === 0, remotes };
  }

  async init() {
    await this.run(["init"]);
    // A first commit needs a branch name people expect.
    await this.run(["symbolic-ref", "HEAD", "refs/heads/main"], { allowFail: true });
  }

  /** Text of a file at a revision: "HEAD", "" (the index), or a commit. Empty when it doesn't exist there. */
  async show(rev: string, absPath: string): Promise<string> {
    const root = (await this.root())!;
    const rel = absPath.startsWith(root + "/") ? absPath.slice(root.length + 1) : absPath;
    const r = await this.run(["show", `${rev}:${rel}`], { allowFail: true });
    return r.code === 0 ? r.stdout : "";
  }

  async stage(paths: string[]) {
    await this.run(["add", "-A", "--", ...paths]);
  }

  async unstage(paths: string[], hasCommits: boolean) {
    if (hasCommits) await this.run(["restore", "--staged", "--", ...paths]);
    else await this.run(["rm", "--cached", "-r", "-q", "--", ...paths]);
  }

  /** Throws away working-tree changes to tracked files (untracked files are the caller's to trash). */
  async discard(paths: string[]) {
    await this.run(["restore", "--worktree", "--", ...paths]);
  }

  async commit(message: string, opts: { amend?: boolean; all?: boolean } = {}) {
    const args = ["commit", "-F", "-"];
    if (opts.amend) args.push("--amend");
    if (opts.all) args.push("-a");
    const r = await this.run(args, { input: message });
    return r.stdout.split("\n")[0]?.trim() ?? "";
  }

  async branches(): Promise<GitBranch[]> {
    const r = await this.run(["for-each-ref", "--format=%(refname)%00%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(committerdate:unix)", "refs/heads", "refs/remotes"]);
    return r.stdout
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("\0"))
      .filter(([ref]) => !ref!.endsWith("/HEAD"))
      .map(([ref, name, head, upstream, date]) => ({
        name: name!,
        remote: ref!.startsWith("refs/remotes/"),
        current: head === "*",
        upstream: upstream || undefined,
        date: Number(date) || undefined,
      }));
  }

  async checkout(branch: string, opts: { create?: boolean } = {}) {
    if (opts.create) return void (await this.run(["switch", "-c", branch]));
    // A remote branch (origin/x) checks out as a local tracking branch.
    const remote = /^[^/]+\/(.+)$/.exec(branch);
    const local = await this.run(["rev-parse", "--verify", "-q", `refs/heads/${branch}`], { allowFail: true });
    if (local.code !== 0 && remote) {
      const exists = await this.run(["rev-parse", "--verify", "-q", `refs/heads/${remote[1]}`], { allowFail: true });
      if (exists.code === 0) return void (await this.run(["switch", remote[1]!]));
      return void (await this.run(["switch", "--track", branch]));
    }
    await this.run(["switch", branch]);
  }

  async pull() {
    // Without a configured strategy, newer git refuses to pull divergent branches; merge like git used to.
    const cfg = await this.run(["config", "--get-regexp", "^pull\\.(rebase|ff)$"], { allowFail: true });
    const args = cfg.stdout.trim() ? ["pull", "--no-edit"] : ["pull", "--no-edit", "--no-rebase"];
    return (await this.run(args, { timeoutMs: 180_000 })).stdout.trim();
  }

  async push() {
    const up = await this.run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { allowFail: true });
    const args = up.code === 0 ? ["push"] : ["push", "-u", "origin", "HEAD"];
    const r = await this.run(args, { timeoutMs: 180_000 });
    return (r.stderr || r.stdout).trim();
  }

  async fetch() {
    await this.run(["fetch", "--all", "--prune"], { timeoutMs: 180_000 });
  }

  async log(limit = 100, path?: string): Promise<GitCommit[]> {
    const args = ["log", `-n${limit}`, "--date=unix", "--format=%H%x00%h%x00%an%x00%ae%x00%ad%x00%D%x00%s%x00%P%x1e"];
    if (path) args.push("--follow", "--", path);
    const r = await this.run(args, { allowFail: true });
    if (r.code !== 0) return [];
    return r.stdout
      .split("\x1e")
      .map((s) => s.replace(/^\n/, ""))
      .filter(Boolean)
      .map((s) => {
        const [hash, short, author, email, date, refs, subject, parents] = s.split("\0");
        return {
          hash: hash!,
          short: short!,
          author: author!,
          email: email!,
          date: Number(date) * 1000,
          refs: refs ? refs.split(", ").filter(Boolean) : [],
          subject: subject ?? "",
          parents: parents ? parents.split(" ").filter(Boolean) : [],
        };
      });
  }

  /** Files a commit changed, with absolute paths. */
  async commitFiles(hash: string): Promise<GitChange[]> {
    const root = (await this.root())!;
    // --root lists the files of a first commit too.
    const r = await this.run(["diff-tree", "--root", "--no-commit-id", "-r", "-M", "--name-status", "-z", hash]);
    const parts = r.stdout.split("\0").filter((x, i, a) => x || i < a.length - 1);
    const out: GitChange[] = [];
    for (let i = 0; i < parts.length; ) {
      const code = parts[i++]!;
      if (!code) continue;
      const kind = code[0]!;
      if (kind === "R" || kind === "C") {
        const from = parts[i++]!;
        const to = parts[i++]!;
        out.push({ path: join(root, to), origPath: join(root, from), status: kind, staged: false });
      } else out.push({ path: join(root, parts[i++]!), status: kind, staged: false });
    }
    return out;
  }

  async addRemote(name: string, url: string) {
    await this.run(["remote", "add", name, url]);
  }
}

/** Parses `git status --porcelain=v1 -b -z`. */
export function parseStatus(out: string, root: string): Omit<GitStatus, "root" | "hasCommits" | "remotes"> {
  const parts = out.split("\0");
  let branch: string | undefined;
  let upstream: string | undefined;
  let ahead = 0;
  let behind = 0;
  let detached = false;
  const changes: GitChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]!;
    if (!e) continue;
    if (e.startsWith("## ")) {
      const h = e.slice(3);
      if (h.startsWith("No commits yet on ")) branch = h.slice("No commits yet on ".length);
      else if (h.startsWith("HEAD (no branch)")) detached = true;
      else {
        const m = /^(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(h)!;
        branch = m[1];
        upstream = m[2];
        ahead = Number(/ahead (\d+)/.exec(m[3] ?? "")?.[1] ?? 0);
        behind = Number(/behind (\d+)/.exec(m[3] ?? "")?.[1] ?? 0);
      }
      continue;
    }
    const x = e[0]!;
    const y = e[1]!;
    const rel = e.slice(3);
    let orig: string | undefined;
    // Renames and copies carry the old path as the next entry.
    if (x === "R" || x === "C") orig = parts[++i];
    const abs = join(root, rel);
    if (x === "?" && y === "?") {
      changes.push({ path: abs, status: "?", staged: false });
      continue;
    }
    if (x === "!") continue;
    const conflict = x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D");
    if (conflict) {
      changes.push({ path: abs, status: "U", staged: false, conflict: true });
      continue;
    }
    if (x !== " ") changes.push({ path: abs, origPath: orig ? join(root, orig) : undefined, status: x, staged: true });
    if (y !== " ") changes.push({ path: abs, status: y, staged: false });
  }
  return { isRepo: true, branch, upstream, ahead, behind, detached, changes };
}

function friendly(msg: string): string {
  if (/could not read Username|terminal prompts disabled|Authentication failed/i.test(msg))
    return `원격 저장소 인증에 실패했습니다. 터미널에서 한 번 git push/pull 해서 로그인 정보를 저장하거나(macOS 키체인), SSH 키를 설정하세요.\n\n${msg}`;
  if (/Please tell me who you are|user\.email/i.test(msg))
    return `커밋할 사용자 이름과 이메일이 없습니다. 터미널에서 git config --global user.name "이름" 과 git config --global user.email "메일" 을 설정하세요.\n\n${msg}`;
  if (/would be overwritten by checkout|Your local changes/i.test(msg))
    return `커밋하지 않은 변경이 있어 브랜치를 바꿀 수 없습니다. 먼저 커밋하거나 변경을 되돌리세요.\n\n${msg}`;
  if (/non-fast-forward|fetch first|rejected/i.test(msg)) return `원격에 새 커밋이 있습니다. 먼저 pull 하세요.\n\n${msg}`;
  if (/CONFLICT|Automatic merge failed/i.test(msg)) return `병합 충돌이 생겼습니다. 충돌 파일을 고친 뒤 스테이징하고 커밋하세요.\n\n${msg}`;
  return msg;
}
