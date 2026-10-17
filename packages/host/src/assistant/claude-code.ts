// Claude through the user's Claude subscription: runs the user's own Claude
// Code (`claude -p`, stream-json) under the login they made with /login.
// Claude Code runs the agent loop; our tools reach it over MCP, and its own
// built-in tools are turned off so everything goes through R Sage's
// approvals.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { findCli, runJsonLines } from "./cli";
import type { AgentProvider, AgentRunRequest } from "./types";

const MODELS = [
  { id: "cc:claude-opus-5-5", label: "Claude Opus 5.5 (구독)" },
  { id: "cc:claude-sonnet-5-5", label: "Claude Sonnet 5.5 (구독)" },
  { id: "cc:claude-haiku-5-5", label: "Claude Haiku 5.5 (구독)" },
];

const AUTH_ERRORS: Record<string, string> = {
  authentication_failed: "Claude Code에 로그인되어 있지 않습니다. 터미널에서 `claude`를 실행하고 /login 으로 로그인하세요.",
  oauth_org_not_allowed: "이 Claude 계정의 조직이 Claude Code 사용을 허용하지 않습니다.",
  account_on_hold: "Claude 계정이 정지 상태입니다.",
  billing_error: "Claude 구독 결제에 문제가 있습니다.",
  rate_limit: "Claude 구독 사용 한도에 도달했습니다. 잠시 후 다시 시도하세요.",
  overloaded: "Claude가 지금 과부하 상태입니다. 잠시 후 다시 시도하세요.",
  model_not_found: "이 모델을 구독으로 쓸 수 없습니다. 다른 Claude 모델을 고르세요.",
};

export class ClaudeCodeProvider implements AgentProvider {
  readonly kind = "agent" as const;
  readonly id = "claude-code" as const;
  readonly label = "Claude 구독 (Claude Code)";

  available() {
    if (!findCli("claude")) return { ok: false, hint: "Claude Code(`claude`)를 찾지 못했습니다. 설치한 뒤 터미널에서 `claude`를 실행하고 /login 으로 로그인하세요." };
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return { ok: true };
    const dir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
    if (existsSync(join(dir, ".credentials.json"))) return { ok: true };
    // macOS keeps the login in the Keychain; this only checks the item exists.
    if (process.platform === "darwin" && spawnSync("/usr/bin/security", ["find-generic-password", "-s", "Claude Code-credentials"], { stdio: "ignore" }).status === 0)
      return { ok: true };
    return { ok: false, hint: "터미널에서 `claude`를 실행하고 /login 으로 Claude 계정에 로그인하세요. (Claude Code가 없으면 먼저 설치)" };
  }

  async models() {
    return MODELS;
  }

  async run(req: AgentRunRequest) {
    const cli = findCli("claude");
    if (!cli) throw new Error("Claude Code(`claude`)를 찾지 못했습니다. 설치되어 있다면 터미널에서 `which claude` 결과를 알려 주세요.");
    const mcpConfig = JSON.stringify({
      mcpServers: { rsage: { type: "http", url: req.mcp.url, headers: { authorization: `Bearer ${req.mcp.token}` } } },
    });
    // Only R Sage's tools: no built-in Bash/Edit, no user MCP servers, hooks
    // or CLAUDE.md from the user's settings. The prompt goes in on stdin.
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--model", req.model.replace(/^cc:/, ""),
      "--system-prompt", req.system,
      "--tools", "",
      "--mcp-config", mcpConfig,
      "--strict-mcp-config",
      "--allowed-tools", "mcp__rsage",
      "--permission-mode", "dontAsk",
      "--setting-sources", "",
    ];
    if (req.sessionId) args.push("--resume", req.sessionId);
    let sessionId = req.sessionId;
    let text = "";
    let current = "";
    try {
      for await (const m of runJsonLines(cli, args, { input: req.prompt, env: childEnv(), cwd: req.cwd, signal: req.signal })) {
        if (m.session_id) sessionId = m.session_id;
        if (m.type === "stream_event" && !m.parent_tool_use_id) {
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
          if (m.error) throw new Error(AUTH_ERRORS[m.error] ?? `Claude Code 오류: ${m.error}`);
          if (current) text = current;
        } else if (m.type === "result") {
          if (m.subtype !== "success" || m.is_error) throw new Error(m.errors?.join("\n") || m.result || `Claude Code가 멈췄습니다 (${m.subtype}).`);
          text = m.result || text;
        }
      }
      if (req.signal.aborted) throw new Error("중단했습니다.");
      return { sessionId, text };
    } catch (err: any) {
      if (req.signal.aborted) throw new Error("중단했습니다.");
      const msg = String(err?.message ?? err);
      if (/not logged in|login|authenticat/i.test(msg) && !/로그인/.test(msg)) throw new Error(AUTH_ERRORS.authentication_failed);
      throw new Error(msg);
    }
  }
}

/**
 * The environment for Claude Code. API keys and base URLs would take
 * precedence over the subscription login, and session variables from a
 * Claude Code that launched R Sage would attach the agent to that session.
 */
function childEnv(): Record<string, string> {
  const keep = new Set(["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"]);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith("ANTHROPIC_") || (k.startsWith("CLAUDE") && !keep.has(k))) continue;
    env[k] = v;
  }
  return env;
}
