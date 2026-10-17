// Scripted provider for tests and UI work without an API key
// (enabled with RSAGE_FAKE_AI=1). It understands three message shapes:
//   ```r ... ```            → calls run_r with that code
//   write <path>\n<text>    → calls write_file
//   anything else           → lists the project files
// After a tool result it summarises the result in one sentence.

import type { AgentProvider, AgentRunRequest, Provider, TurnRequest, TurnResult } from "./types";

export class FakeProvider implements Provider {
  readonly id = "fake" as const;
  readonly label = "테스트용 모델";
  private n = 0;

  async models() {
    return [{ id: "fake-echo", label: "테스트 (오프라인)" }];
  }

  async turn(req: TurnRequest): Promise<TurnResult> {
    const last = req.history[req.history.length - 1];
    const say = async (text: string) => {
      for (const w of text.split(/(?<= )/)) {
        if (req.signal.aborted) throw new Error("중단됨");
        req.onText(w);
        await Bun.sleep(5);
      }
      return text;
    };
    if (last?.role === "tool_results") {
      const r = last.results[0]!;
      const text = await say(
        r.isError ? `도구가 실패했습니다: ${r.output.slice(0, 200)}` : `${r.name} 결과를 받았습니다 (${r.output.length}자${r.images?.length ? `, 그림 ${r.images.length}개` : ""}).`,
      );
      return { text, calls: [], raw: null, stop: "end" };
    }
    // The editor context the service appends is not part of the script.
    const msg = last?.role === "user" ? last.text.replace(/\n*<editor_context>[\s\S]*$/, "") : "";
    req.onThinking("요청을 살펴보는 중…");
    const id = `fake_${++this.n}`;
    const code = /```r?\n([\s\S]*?)```/.exec(msg)?.[1];
    if (code) {
      const text = await say("R 코드를 실행하겠습니다.");
      return { text, calls: [{ id, name: "run_r", input: { code } }], raw: null, stop: "tool" };
    }
    const w = /^write (\S+)\n([\s\S]*)$/.exec(msg);
    if (w) {
      const text = await say(`${w[1]} 파일을 쓰겠습니다.`);
      return { text, calls: [{ id, name: "write_file", input: { path: w[1], content: w[2] } }], raw: null, stop: "tool" };
    }
    const text = await say("프로젝트 파일을 살펴보겠습니다.");
    return { text, calls: [{ id, name: "list_files", input: {} }], raw: null, stop: "tool" };
  }
}

/**
 * Scripted stand-in for Claude Code / Codex: runs its own "loop" and calls
 * the app's tools through the MCP bridge, like the real agents do.
 */
export class FakeAgentProvider implements AgentProvider {
  readonly kind = "agent" as const;
  readonly id = "fake" as const;
  readonly label = "테스트용 모델";
  private n = 0;

  async connection() {
    return { state: "connected" as const, email: "test@example.com", plan: "test", quotas: [] };
  }

  async login() {}
  async cancelLogin() {}
  async logout() {}

  async models() {
    return [{ id: "fake-agent", label: "테스트 에이전트 (오프라인)" }];
  }

  async run(req: AgentRunRequest) {
    const rpc = async (method: string, params?: unknown) => {
      const r = await fetch(req.mcp.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${req.mcp.token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.n, method, params }),
        signal: req.signal,
      });
      return ((await r.json()) as any).result;
    };
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake", version: "0" } });
    const tools = (await rpc("tools/list")).tools as { name: string }[];
    const msg = req.prompt.replace(/^<earlier_conversation>[\s\S]*?<\/earlier_conversation>\n\n/, "").replace(/\n*<editor_context>[\s\S]*$/, "");
    const code = /```r?\n([\s\S]*?)```/.exec(msg)?.[1];
    req.onMessage();
    req.onThinking("요청을 살펴보는 중…");
    req.onText(code ? "R 코드를 실행하겠습니다." : `도구 ${tools.length}개를 볼 수 있습니다.`);
    let text = "끝났습니다.";
    if (code) {
      const res = await rpc("tools/call", { name: "run_r", arguments: { code } });
      const out = res.content.find((c: any) => c.type === "text")?.text ?? "";
      const imgs = res.content.filter((c: any) => c.type === "image").length;
      text = res.isError ? `실패: ${out.slice(0, 200)}` : `run_r 결과를 받았습니다 (${out.length}자, 그림 ${imgs}개).`;
    }
    req.onMessage();
    req.onText(text);
    return { sessionId: `fake-session-${this.n}`, text };
  }
}
