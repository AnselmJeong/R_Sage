// Claude through the user's Claude subscription, the way ScholarPen does it:
// the official Claude Code CLI runs with a config folder of R Sage's own, so
// the user signs in once from the app (`claude auth login --claudeai`) and
// that login is the only credential it can use. API keys and other endpoints
// are never passed in, and a turn that would spill into paid usage stops
// instead.
//
// Claude Code runs the agent loop; our tools reach it over MCP, and its own
// built-in tools are turned off so everything goes through R Sage's
// approvals.

import { spawn, type ChildProcess } from "node:child_process";
import type { SubscriptionQuota, SubscriptionStatus } from "@rsage/shared";
import { agentEnv, agentHome, findCli, runJsonLines, runText } from "./cli";
import type { AgentProvider, AgentRunRequest } from "./types";

const MODELS = [
  { id: "cc:default", label: "Claude 구독 기본 모델" },
  { id: "cc:opus", label: "Claude Opus" },
  { id: "cc:sonnet", label: "Claude Sonnet" },
  { id: "cc:haiku", label: "Claude Haiku" },
];

/** No user or project settings, hooks or memory: only what R Sage passes. */
const CONFIG = ["--setting-sources", "", "--settings", JSON.stringify({ disableAllHooks: true, autoMemoryEnabled: false })];

const NOT_SIGNED_IN = "설정 → AI 연결에서 Claude 구독으로 로그인해 주세요.";

const ERRORS: Record<string, string> = {
  authentication_failed: NOT_SIGNED_IN,
  oauth_org_not_allowed: "이 Claude 계정의 조직이 Claude Code 사용을 허용하지 않습니다.",
  account_on_hold: "Claude 계정이 정지 상태입니다.",
  billing_error: "Claude 구독 결제에 문제가 있습니다.",
  overloaded: "Claude가 지금 과부하 상태입니다. 잠시 후 다시 시도하세요.",
  model_not_found: "이 모델을 구독으로 쓸 수 없습니다. 다른 Claude 모델을 고르세요.",
};

const WINDOWS: Record<string, string> = { five_hour: "5시간 한도", seven_day: "주간 한도", seven_day_opus: "주간 Opus 한도", seven_day_sonnet: "주간 Sonnet 한도" };

function limitError(resetsAt?: number) {
  const when = resetsAt ? ` ${new Date(resetsAt * 1000).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}에 초기화됩니다.` : "";
  return `Claude 구독 사용 한도에 도달했습니다.${when} 유료 API로 전환하지 않았습니다.`;
}

export class ClaudeCodeProvider implements AgentProvider {
  readonly kind = "agent" as const;
  readonly id = "claude-code" as const;
  readonly label = "Claude 구독";
  private loginProc?: ChildProcess;
  private loginError?: string;
  private last?: { at: number; status: SubscriptionStatus };
  private quotas = new Map<string, SubscriptionQuota>();
  private quotaAt?: number;
  private account?: string;
  private runs = 0;

  /** `command` and `home` replace the installed CLI and R Sage's folder (tests). */
  constructor(private opts: { command?: string[]; home?: string } = {}) {}

  private cli(): string[] | null {
    if (this.opts.command) return this.opts.command;
    const p = findCli("claude");
    return p ? [p] : null;
  }

  private home() {
    return this.opts.home ?? agentHome("claude");
  }

  private env() {
    return agentEnv({ CLAUDE_CONFIG_DIR: this.home(), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" });
  }

  private quotaList() {
    return [...this.quotas.values()];
  }

  async connection(refresh = false): Promise<SubscriptionStatus> {
    if (this.loginProc) return { state: "signingIn", quotas: [] };
    if (!refresh && this.last && Date.now() - this.last.at < 60_000) return { ...this.last.status, quotas: this.quotaList(), quotaCheckedAt: this.quotaAt };
    const status = await this.inspect();
    this.last = { at: Date.now(), status };
    return status;
  }

  private async inspect(): Promise<SubscriptionStatus> {
    const cli = this.cli();
    if (!cli) return { state: "unavailable", quotas: [], error: "Claude Code를 찾지 못했습니다. 설치한 뒤 새로고침을 누르세요." };
    const [cmd, ...pre] = cli;
    const base = { cliPath: cmd, quotas: [] as SubscriptionQuota[] };
    try {
      const opts = { env: this.env(), cwd: this.home() };
      const v = await runText(cmd!, [...pre, "--version"], opts);
      const cliVersion = v.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? (v.stdout.trim() || undefined);
      const r = await runText(cmd!, [...pre, ...CONFIG, "auth", "status", "--json"], opts);
      let auth: any;
      try {
        auth = JSON.parse(r.stdout);
      } catch {
        return { ...base, cliVersion, state: "error", error: `Claude Code 로그인 상태를 읽지 못했습니다. Claude Code를 업데이트해 주세요. ${r.stderr.trim().split("\n").pop() ?? ""}`.trim() };
      }
      if (auth.loggedIn !== true) return { ...base, cliVersion, state: "signedOut", error: this.loginError };
      if (auth.authMethod !== "claude.ai" || auth.apiProvider !== "firstParty" || !auth.subscriptionType)
        return {
          ...base,
          cliVersion,
          state: "error",
          error: "Claude 구독 로그인이 아닙니다. API 인증으로는 요청하지 않습니다. 로그아웃한 뒤 Claude 계정으로 다시 로그인해 주세요.",
        };
      const account = `${auth.orgId ?? ""}:${auth.email ?? ""}`;
      if (this.account !== account) {
        this.quotas.clear();
        this.quotaAt = undefined;
      }
      this.account = account;
      return { ...base, cliVersion, state: "connected", email: auth.email, plan: auth.subscriptionType, quotas: this.quotaList(), quotaCheckedAt: this.quotaAt };
    } catch (e: any) {
      return { ...base, state: "error", error: `Claude Code를 실행하지 못했습니다: ${e?.message ?? e}` };
    }
  }

  async login(_open: (url: string) => void) {
    if (this.loginProc) return;
    if (this.runs) throw new Error("Claude가 답하는 중입니다. 끝난 뒤 로그인해 주세요.");
    const cli = this.cli();
    if (!cli) throw new Error("Claude Code를 찾지 못했습니다. 먼저 설치해 주세요.");
    const [cmd, ...pre] = cli;
    this.loginError = undefined;
    // The official CLI opens Anthropic's sign-in page in the browser itself.
    const child = spawn(cmd!, [...pre, ...CONFIG, "auth", "login", "--claudeai"], { env: this.env(), cwd: this.home(), stdio: ["ignore", "ignore", "ignore"] });
    this.loginProc = child;
    const timer = setTimeout(() => child.kill("SIGTERM"), 5 * 60_000);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      if (this.loginProc !== child) return;
      this.loginProc = undefined;
      this.last = undefined;
      if (!ok) this.loginError = "Claude 로그인을 마치지 못했습니다. 다시 로그인해 주세요.";
    };
    child.once("error", () => done(false));
    child.once("close", (code) => done(code === 0));
  }

  async cancelLogin() {
    const child = this.loginProc;
    this.loginProc = undefined;
    this.loginError = undefined;
    this.last = undefined;
    child?.kill("SIGTERM");
  }

  async logout() {
    await this.cancelLogin();
    if (this.runs) throw new Error("Claude가 답하는 중입니다. 끝난 뒤 로그아웃해 주세요.");
    const cli = this.cli();
    if (!cli) return;
    const [cmd, ...pre] = cli;
    await runText(cmd!, [...pre, ...CONFIG, "auth", "logout"], { env: this.env(), cwd: this.home() });
    this.account = undefined;
    this.quotas.clear();
    this.quotaAt = undefined;
    this.last = undefined;
  }

  async models() {
    return MODELS;
  }

  private noteLimit(info: any) {
    if (!info || typeof info !== "object") return;
    const key = typeof info.rateLimitType === "string" ? info.rateLimitType : "default";
    this.quotas.set(key, {
      label: WINDOWS[key] ?? "사용 한도",
      status: typeof info.status === "string" ? info.status : undefined,
      resetsAt: typeof info.resetsAt === "number" ? info.resetsAt : undefined,
      usedPercent: typeof info.utilization === "number" ? Math.round(info.utilization <= 1 ? info.utilization * 100 : info.utilization) : undefined,
    });
    this.quotaAt = Date.now();
  }

  async run(req: AgentRunRequest) {
    if (this.loginProc) throw new Error("Claude 로그인을 먼저 마쳐 주세요.");
    let status = await this.connection();
    if (status.state !== "connected") status = await this.connection(true);
    if (status.state !== "connected") throw new Error(status.error || NOT_SIGNED_IN);
    const blocked = this.quotaList().find((q) => q.status === "rejected" && q.resetsAt && q.resetsAt * 1000 > Date.now());
    if (blocked) throw new Error(limitError(blocked.resetsAt));
    const [cmd, ...pre] = this.cli()!;
    const mcpConfig = JSON.stringify({
      mcpServers: { rsage: { type: "http", url: req.mcp.url, headers: { authorization: `Bearer ${req.mcp.token}` } } },
    });
    const model = req.model.replace(/^cc:/, "");
    // Only R Sage's tools: no built-in Bash/Edit, no other MCP servers, skills
    // or browser. The prompt goes in on stdin.
    const args = [
      ...pre,
      ...CONFIG,
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--system-prompt", req.system,
      "--tools", "",
      "--mcp-config", mcpConfig,
      "--strict-mcp-config",
      "--allowed-tools", "mcp__rsage",
      "--permission-mode", "dontAsk",
      "--disable-slash-commands",
      "--no-chrome",
    ];
    if (model && model !== "default") args.push("--model", model);
    if (req.sessionId) args.push("--resume", req.sessionId);
    let sessionId = req.sessionId;
    let text = "";
    let current = "";
    this.runs++;
    try {
      for await (const m of runJsonLines(cmd!, args, { input: req.prompt, env: this.env(), cwd: req.cwd, signal: req.signal })) {
        if (m.session_id) sessionId = m.session_id;
        if (m.type === "rate_limit_event") {
          this.noteLimit(m.rate_limit_info);
          const info = m.rate_limit_info ?? {};
          if (info.status === "rejected" || info.isUsingOverage === true) throw new Error(limitError(info.resetsAt));
        } else if (m.type === "system" && m.subtype === "api_retry" && (m.error_status === 429 || m.error === "rate_limit")) {
          throw new Error(limitError());
        } else if (m.type === "stream_event" && !m.parent_tool_use_id) {
          const ev = m.event;
          if (ev?.type === "message_start") {
            req.onMessage();
            current = "";
          } else if (ev?.type === "content_block_delta") {
            if (ev.delta?.type === "text_delta") {
              current += ev.delta.text;
              req.onText(ev.delta.text);
            } else if (ev.delta?.type === "thinking_delta") req.onThinking(ev.delta.thinking);
          }
        } else if (m.type === "assistant" && !m.parent_tool_use_id) {
          if (m.error) {
            if (/rate_limit/.test(m.error)) throw new Error(limitError());
            if (m.error === "authentication_failed") this.last = undefined;
            throw new Error(ERRORS[m.error] ?? `Claude 오류: ${m.error}`);
          }
          if (current) text = current;
        } else if (m.type === "result") {
          if (m.subtype !== "success" || m.is_error) {
            const detail = [m.result, ...(m.errors ?? [])].filter(Boolean).join("\n");
            if (/rate.?limit|usage.?limit|quota|exceeded.*limit/i.test(detail)) throw new Error(limitError());
            throw new Error(detail || `Claude Code가 멈췄습니다 (${m.subtype}).`);
          }
          text = m.result || text;
        }
      }
      if (req.signal.aborted) throw new Error("중단했습니다.");
      return { sessionId, text };
    } catch (err: any) {
      if (req.signal.aborted) throw new Error("중단했습니다.");
      const msg = String(err?.message ?? err);
      if (/not logged in|please run \/login|invalid api key|authenticat/i.test(msg) && !/로그인/.test(msg)) {
        this.last = undefined;
        throw new Error(NOT_SIGNED_IN);
      }
      throw new Error(msg);
    } finally {
      this.runs--;
    }
  }

  dispose() {
    this.loginProc?.kill("SIGTERM");
  }
}
