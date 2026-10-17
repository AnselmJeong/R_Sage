// GPT through the user's ChatGPT subscription, the way ScholarPen does it:
// the official Codex CLI runs with a CODEX_HOME of R Sage's own and is forced
// onto the ChatGPT login (`forced_login_method="chatgpt"`), so no API key can
// be used. `codex app-server` answers account, usage-limit, model and
// sign-in questions; each turn runs `codex exec`, whose agent loop reaches
// our tools over MCP. Codex's own shell and file editing are turned off, so
// file changes still go through R Sage's approvals.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { SubscriptionQuota, SubscriptionStatus } from "@rsage/shared";
import { agentEnv, agentHome, findCli, runJsonLines } from "./cli";
import type { AgentProvider, AgentRunRequest } from "./types";

/** ChatGPT login only; nothing of Codex's own beyond the model and our MCP tools. */
const CONFIG = [
  'forced_login_method="chatgpt"',
  'model_provider="openai"',
  'cli_auth_credentials_store="file"',
  'approval_policy="never"',
  'sandbox_mode="read-only"',
  'web_search="disabled"',
  "features.shell_tool=false",
  "features.unified_exec=false",
  "features.multi_agent=false",
  "features.apps=false",
  "features.plugins=false",
  "features.hooks=false",
  "features.code_mode=false",
  "features.code_mode_host=false",
  "features.apply_patch_freeform=false",
  "project_doc_max_bytes=0",
  "analytics.enabled=false",
];

const NOT_SIGNED_IN = "설정 → AI 연결에서 ChatGPT 구독으로 로그인해 주세요.";
const LIMIT = "ChatGPT 구독 사용 한도에 도달했습니다. 한도가 초기화된 뒤 다시 시도해 주세요. 유료 API로 전환하지 않았습니다.";

const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as any) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");

function windowLabel(mins: unknown) {
  if (typeof mins !== "number") return "사용 한도";
  return mins >= 1440 ? (mins === 10080 ? "주간 한도" : `${Math.round(mins / 1440)}일 한도`) : `${Math.round(mins / 60)}시간 한도`;
}

/** account/rateLimits/read → one row per usage window. */
export function parseQuotas(result: Record<string, any>): SubscriptionQuota[] {
  const buckets = Object.entries(obj(result.rateLimitsByLimitId));
  if (!buckets.length && result.rateLimits) buckets.push([str(obj(result.rateLimits).limitId) || "codex", result.rateLimits]);
  const out: SubscriptionQuota[] = [];
  for (const [id, value] of buckets) {
    const q = obj(value);
    const name = id === "codex" || id === "default" ? "" : `${str(q.limitName) || id} `;
    for (const w of [q.primary, q.secondary].map(obj)) {
      if (typeof w.usedPercent !== "number") continue;
      out.push({ label: name + windowLabel(w.windowDurationMins), usedPercent: w.usedPercent, resetsAt: typeof w.resetsAt === "number" ? w.resetsAt : undefined });
    }
  }
  return out;
}

/** A long-lived `codex app-server` (JSON-RPC, one message per line). */
class AppServer {
  private child: ChildProcessWithoutNullStreams;
  private next = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  closed = false;
  version?: string;

  constructor(cmd: string[], home: string, private onNote: (method: string, params: any) => void, private onClose: () => void) {
    const cwd = join(home, "workspace");
    mkdirSync(cwd, { recursive: true, mode: 0o700 });
    const args = [...cmd.slice(1), "app-server", ...[...CONFIG, "mcp_servers={}"].flatMap((c) => ["-c", c])];
    this.child = spawn(cmd[0]!, args, { cwd, env: agentEnv({ CODEX_HOME: home }), stdio: ["pipe", "pipe", "pipe"] });
    // Never log stderr: it can carry sign-in URLs.
    this.child.stderr.resume();
    this.child.stdin.on("error", () => this.close());
    this.child.once("error", () => this.close(new Error("Codex를 실행하지 못했습니다.")));
    this.child.once("exit", () => this.close());
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on("line", (line) => {
      let m: any;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof m.method === "string") {
        // Requests from the server (approvals and the like): this connection never grants any.
        if (m.id !== undefined) this.send({ id: m.id, error: { code: -32601, message: "R Sage does not answer Codex requests here." } });
        else this.onNote(m.method, obj(m.params));
        return;
      }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(new Error(str(obj(m.error).message) || "Codex 요청이 실패했습니다."));
      else p.resolve(m.result);
    });
  }

  async start() {
    const init = obj(await this.request("initialize", { clientInfo: { name: "rsage", title: "R Sage", version: "0.1.0" }, capabilities: {} }));
    this.version = str(init.userAgent).match(/^[^/]+\/(\d+\.\d+\.\d+)/)?.[1];
    this.send({ method: "initialized" });
  }

  private send(m: unknown) {
    if (this.closed || this.child.stdin.destroyed) throw new Error("Codex 연결이 끊어졌습니다.");
    this.child.stdin.write(JSON.stringify(m) + "\n");
  }

  request(method: string, params: unknown = {}, timeoutMs = 20_000): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex가 응답하지 않습니다 (${method}).`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (e: any) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  close(error = new Error("Codex 연결이 끊어졌습니다.")) {
    if (this.closed) return;
    this.closed = true;
    this.child.kill("SIGTERM");
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.onClose();
  }
}

export class CodexProvider implements AgentProvider {
  readonly kind = "agent" as const;
  readonly id = "codex" as const;
  readonly label = "ChatGPT 구독";
  private server?: AppServer;
  private connecting?: Promise<AppServer>;
  private loginId?: string;
  private loginError?: string;
  private last?: SubscriptionStatus;
  private modelList?: { id: string; label: string }[];
  private runs = 0;

  /** `command` and `home` replace the installed CLI and R Sage's folder (tests). */
  constructor(private opts: { command?: string[]; home?: string } = {}) {}

  private cli(): string[] | null {
    if (this.opts.command) return this.opts.command;
    const p = findCli("codex");
    return p ? [p] : null;
  }

  private home() {
    return this.opts.home ?? agentHome("codex");
  }

  private async connect(): Promise<AppServer> {
    if (this.server && !this.server.closed) return this.server;
    if (this.connecting) return this.connecting;
    const cli = this.cli();
    if (!cli) throw new Error("Codex를 찾지 못했습니다. 설치한 뒤 새로고침을 누르세요.");
    this.connecting = (async () => {
      const s = new AppServer(
        cli,
        this.home(),
        (method, params) => {
          if (method === "account/login/completed") {
            this.loginId = undefined;
            this.loginError = params.success === true ? undefined : str(params.error) || "ChatGPT 로그인을 마치지 못했습니다. 다시 로그인해 주세요.";
            this.modelList = undefined;
          }
        },
        () => {
          if (this.server === s) {
            this.server = undefined;
            this.loginId = undefined;
          }
        },
      );
      try {
        await s.start();
      } catch (e) {
        s.close();
        throw e;
      }
      this.server = s;
      return s;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  async connection(refresh = false): Promise<SubscriptionStatus> {
    // A fresh server picks up a Codex the user just installed or updated.
    if (refresh && !this.loginId && !this.runs) {
      this.server?.close();
      this.modelList = undefined;
    }
    const cli = this.cli();
    let s: AppServer;
    try {
      s = await this.connect();
    } catch (e: any) {
      return (this.last = { state: "unavailable", cliPath: cli?.[0], quotas: [], error: e?.message ?? String(e) });
    }
    const base = { cliPath: cli?.[0], cliVersion: s.version, quotas: [] as SubscriptionQuota[] };
    try {
      const account = obj(obj(await s.request("account/read", { refreshToken: false })).account);
      if (account.type !== "chatgpt") {
        if (account.type) return (this.last = { ...base, state: "error", error: "ChatGPT 구독 로그인만 씁니다. 로그아웃한 뒤 ChatGPT 계정으로 다시 로그인해 주세요." });
        return (this.last = { ...base, state: this.loginId ? "signingIn" : "signedOut", error: this.loginError });
      }
      const connected: SubscriptionStatus = { ...base, state: "connected", email: str(account.email) || undefined, plan: str(account.planType) || undefined };
      try {
        const limits = obj(await s.request("account/rateLimits/read"));
        connected.quotas = parseQuotas(limits);
        connected.quotaCheckedAt = Date.now();
        if (limits.ordinaryUsageAllowed === false) connected.error = LIMIT;
      } catch {
        connected.error = "구독 사용 한도를 확인하지 못했습니다.";
      }
      return (this.last = connected);
    } catch (e: any) {
      return (this.last = { ...base, state: "error", error: e?.message ?? String(e) });
    }
  }

  async login(open: (url: string) => void) {
    const s = await this.connect();
    if (this.loginId) await this.cancelLogin();
    this.loginError = undefined;
    const r = obj(await s.request("account/login/start", { type: "chatgpt" }));
    let url: URL;
    try {
      url = new URL(str(r.authUrl));
    } catch {
      throw new Error("Codex가 올바른 로그인 주소를 주지 않았습니다.");
    }
    if (r.type !== "chatgpt" || !str(r.loginId) || url.protocol !== "https:" || !["auth.openai.com", "chatgpt.com"].includes(url.hostname))
      throw new Error("Codex가 올바른 로그인 주소를 주지 않았습니다.");
    this.loginId = str(r.loginId);
    open(url.toString());
  }

  async cancelLogin() {
    const id = this.loginId;
    this.loginId = undefined;
    this.loginError = undefined;
    if (id && this.server && !this.server.closed) await this.server.request("account/login/cancel", { loginId: id }).catch(() => {});
  }

  async logout() {
    await this.cancelLogin();
    if (this.runs) throw new Error("Codex가 답하는 중입니다. 끝난 뒤 로그아웃해 주세요.");
    await (await this.connect()).request("account/logout");
    this.modelList = undefined;
    this.last = undefined;
  }

  async models() {
    if (this.modelList) return this.modelList;
    const list = [{ id: "codex:default", label: "GPT 구독 기본 모델" }];
    try {
      const s = await this.connect();
      let cursor: string | null = null;
      const seen = new Set<string>();
      do {
        const r = obj(await s.request("model/list", { cursor, limit: 100, includeHidden: false }));
        for (const m of Array.isArray(r.data) ? r.data.map(obj) : []) {
          if (!str(m.model) || m.hidden === true) continue;
          list.push({ id: `codex:${m.model}`, label: str(m.displayName) || m.model });
        }
        cursor = str(r.nextCursor) || null;
        if (cursor && seen.has(cursor)) break;
        if (cursor) seen.add(cursor);
      } while (cursor);
      this.modelList = list;
    } catch {
      // Keep the default model when the list is unavailable; try again next time.
    }
    return list;
  }

  async run(req: AgentRunRequest) {
    if (this.loginId) throw new Error("ChatGPT 로그인을 먼저 마쳐 주세요.");
    const status = await this.connection();
    if (status.state !== "connected") throw new Error(status.error || NOT_SIGNED_IN);
    if (status.error === LIMIT || status.quotas.some((q) => (q.usedPercent ?? 0) >= 100)) throw new Error(LIMIT);
    const [cmd, ...pre] = this.cli()!;
    const model = req.model.replace(/^codex:/, "");
    const args = [
      ...pre,
      "exec",
      "--json",
      ...CONFIG.flatMap((c) => ["--config", c]),
      "--config", `mcp_servers.rsage.url=${JSON.stringify(req.mcp.url)}`,
      "--config", "mcp_servers.rsage.tool_timeout_sec=3600",
      "--config", "mcp_servers.rsage.startup_timeout_sec=20",
      // With approval_policy "never" Codex rejects MCP calls that would need
      // its own approval; R Sage asks the user itself, so pre-approve them.
      "--config", 'mcp_servers.rsage.default_tools_approval_mode="approve"',
      "--sandbox", "read-only",
      "--cd", req.cwd,
      "--skip-git-repo-check",
    ];
    if (model && model !== "default") args.push("--model", model);
    if (req.sessionId) args.push("resume", req.sessionId);
    // Codex has no separate system prompt in exec mode; a new thread gets it up front.
    const input = req.sessionId ? req.prompt : `<instructions>\n${req.system}\n</instructions>\n\n${req.prompt}`;

    let sessionId = req.sessionId;
    let text = "";
    let lastError = "";
    let completed = false;
    const seen = new Map<string, number>();
    const grow = (item: { id: string; text: string }, emit: (d: string) => void) => {
      const n = seen.get(item.id) ?? 0;
      if (item.text.length > n) emit(item.text.slice(n));
      seen.set(item.id, item.text.length);
    };
    this.runs++;
    try {
      for await (const ev of runJsonLines(cmd!, args, { input, env: agentEnv({ CODEX_HOME: this.home() }), cwd: req.cwd, signal: req.signal })) {
        if (ev.type === "thread.started") sessionId = ev.thread_id;
        else if (ev.type === "turn.failed") throw new Error(friendly(ev.error?.message ?? ""));
        // Codex reports retries ("Reconnecting... 2/5") as errors too; only the turn's end decides.
        else if (ev.type === "error") lastError = ev.message;
        else if (ev.type === "turn.completed") completed = true;
        else if (ev.type === "item.started" || ev.type === "item.updated" || ev.type === "item.completed") {
          const it = ev.item;
          if (it.type === "agent_message") {
            if (!seen.has(it.id)) req.onMessage();
            grow(it, req.onText);
            if (ev.type === "item.completed") text = it.text;
          } else if (it.type === "reasoning") grow(it, req.onThinking);
          else if (it.type === "command_execution")
            req.onOwnTool({
              key: it.id,
              name: "shell",
              input: { command: it.command },
              output: it.aggregated_output,
              status: it.status === "in_progress" ? "running" : it.status === "completed" && !it.exit_code ? "done" : "error",
            });
          // Non-fatal notices, e.g. a deprecated config key.
          else if (it.type === "error" && /deprecated|under-development|suppress_unstable|Code Mode is unavailable/i.test(it.message)) continue;
          else if (it.type === "error") req.onOwnTool({ key: it.id, name: "codex", input: {}, output: it.message, status: "error" });
        }
      }
      if (!completed) throw new Error(friendly(lastError || "Codex가 답을 끝내지 못했습니다."));
      return { sessionId, text };
    } catch (err: any) {
      if (req.signal.aborted) throw new Error("중단했습니다.");
      throw new Error(friendly(err?.message ?? String(err)));
    } finally {
      this.runs--;
    }
  }

  dispose() {
    this.server?.close();
  }
}

function friendly(msg: string): string {
  if (/usage.?limit|rate.?limit|quota|429/i.test(msg)) return LIMIT;
  if (/401|unauthori[sz]ed|not logged in|login/i.test(msg) && !/로그인/.test(msg)) return NOT_SIGNED_IN;
  if (/Proxy connection failed|stream disconnected|ECONNREFUSED|network/i.test(msg)) return `Codex가 OpenAI에 연결하지 못했습니다: ${msg}`;
  if (/ENOENT|spawn/i.test(msg)) return `Codex를 실행하지 못했습니다: ${msg}`;
  return msg;
}
