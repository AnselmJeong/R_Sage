// GPT through the user's ChatGPT subscription: runs Codex (bundled with the
// Codex SDK) under the login the user made with `codex login`. Codex runs
// the agent loop; our tools reach it over MCP. Its own shell runs in a
// read-only sandbox, so file changes still go through R Sage's approvals.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Codex, type ThreadItem } from "@openai/codex-sdk";
import type { AgentProvider, AgentRunRequest } from "./types";

export class CodexProvider implements AgentProvider {
  readonly kind = "agent" as const;
  readonly id = "codex" as const;
  readonly label = "ChatGPT 구독 (Codex)";

  available() {
    const home = process.env.CODEX_HOME ?? join(homedir(), ".codex");
    if (existsSync(join(home, "auth.json"))) return { ok: true };
    return { ok: false, hint: "터미널에서 `codex login`을 실행해 ChatGPT 계정으로 로그인하세요. (Codex가 없으면 먼저 설치: npm i -g @openai/codex)" };
  }

  async models() {
    // Codex picks the model that fits the ChatGPT plan; follow the user's Codex setting.
    return [{ id: "codex:default", label: "GPT (구독, Codex 기본 모델)" }];
  }

  async run(req: AgentRunRequest) {
    // An API key in the environment would take precedence over the ChatGPT login.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "OPENAI_API_KEY" && k !== "CODEX_API_KEY") env[k] = v;
    const codex = new Codex({
      env,
      config: {
        mcp_servers: { rsage: { url: req.mcp.url, tool_timeout_sec: 3600, startup_timeout_sec: 20 } },
      },
    });
    const opts = {
      workingDirectory: req.cwd,
      skipGitRepoCheck: true,
      sandboxMode: "read-only" as const,
      approvalPolicy: "never" as const,
      networkAccessEnabled: false,
      webSearchMode: "disabled" as const,
    };
    const model = req.model.replace(/^codex:/, "");
    if (model !== "default") Object.assign(opts, { model });
    const thread = req.sessionId ? codex.resumeThread(req.sessionId, opts) : codex.startThread(opts);
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
    try {
      const { events } = await thread.runStreamed(input, { signal: req.signal });
      for await (const ev of events) {
        if (ev.type === "thread.started") sessionId = ev.thread_id;
        else if (ev.type === "turn.failed") throw new Error(friendly(ev.error.message));
        // Codex reports retries ("Reconnecting... 2/5") as errors too; only the turn's end decides.
        else if (ev.type === "error") lastError = ev.message;
        else if (ev.type === "turn.completed") completed = true;
        else if (ev.type === "item.started" || ev.type === "item.updated" || ev.type === "item.completed") {
          const it: ThreadItem = ev.item;
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
          else if (it.type === "error") req.onOwnTool({ key: it.id, name: "codex", input: {}, output: it.message, status: "error" });
        }
      }
      if (!completed) throw new Error(friendly(lastError || "Codex가 답을 끝내지 못했습니다."));
      return { sessionId: sessionId ?? thread.id ?? undefined, text };
    } catch (err: any) {
      if (req.signal.aborted) throw new Error("중단했습니다.");
      throw new Error(friendly(err?.message ?? String(err)));
    }
  }
}

function friendly(msg: string): string {
  if (/Proxy connection failed|stream disconnected|ECONNREFUSED|network/i.test(msg)) return `Codex가 OpenAI에 연결하지 못했습니다: ${msg}`;
  if (/401|unauthori[sz]ed|not logged in|login/i.test(msg)) return "Codex에 로그인되어 있지 않습니다. 터미널에서 `codex login`을 실행하세요.";
  if (/usage limit|rate limit|429/i.test(msg)) return "ChatGPT 구독 사용 한도에 도달했습니다. 잠시 후 다시 시도하세요.";
  if (/ENOENT|spawn/i.test(msg)) return `Codex를 실행하지 못했습니다: ${msg}`;
  return msg;
}
