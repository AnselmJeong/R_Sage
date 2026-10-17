// Subscription logins through stand-ins for the claude and codex CLIs.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeProvider } from "../src/assistant/claude-code";
import { CodexProvider } from "../src/assistant/codex";
import type { AgentRunRequest } from "../src/assistant/types";

const fixture = (name: string) => join(import.meta.dir, "fixtures", name);
const until = async (pred: () => Promise<boolean>, ms = 5000) => {
  const t0 = Date.now();
  while (!(await pred()) && Date.now() - t0 < ms) await Bun.sleep(50);
  return pred();
};
const request = (over: Partial<AgentRunRequest> = {}): AgentRunRequest => ({
  model: "cc:opus",
  system: "sys",
  prompt: "hi",
  cwd: tmpdir(),
  mcp: { url: "http://127.0.0.1:1/mcp/x", token: "x" },
  signal: new AbortController().signal,
  onText: () => {},
  onThinking: () => {},
  onMessage: () => {},
  onOwnTool: () => {},
  ...over,
});

test("Claude: app-only login, run with usage, never an API key", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-should-not-pass";
  const home = mkdtempSync(join(tmpdir(), "rsage-claude-"));
  const p = new ClaudeCodeProvider({ command: [process.execPath, fixture("claude-cli.ts"), "ok"], home });
  expect((await p.connection(true)).state).toBe("signedOut");
  await p.login(() => {});
  expect((await p.connection()).state).toBe("signingIn");
  expect(await until(async () => (await p.connection()).state === "connected")).toBe(true);
  const st = await p.connection();
  expect(st).toMatchObject({ email: "anselm@example.com", plan: "max", cliVersion: "2.1.300" });

  let text = "";
  const r = await p.run(request({ onText: (d) => (text += d) }));
  expect(r).toEqual({ sessionId: "cc-session-1", text: "안녕하세요" });
  expect(text).toBe("안녕하세요");
  expect((await p.connection()).quotas).toMatchObject([{ label: "5시간 한도", usedPercent: 25, status: "allowed" }]);

  const calls = readFileSync(join(home, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(calls.every((c) => c.apiKey === null)).toBe(true);
  const run = calls.find((c) => c.args.includes("-p")).args as string[];
  expect(run).toContain("--strict-mcp-config");
  expect(run[run.indexOf("--model") + 1]).toBe("opus");

  await p.logout();
  expect((await p.connection()).state).toBe("signedOut");
  delete process.env.ANTHROPIC_API_KEY;
});

test("Claude: stops at the usage limit and refuses API logins", async () => {
  const home = mkdtempSync(join(tmpdir(), "rsage-claude-"));
  const quota = new ClaudeCodeProvider({ command: [process.execPath, fixture("claude-cli.ts"), "quota"], home });
  await quota.login(() => {});
  await until(async () => (await quota.connection()).state === "connected");
  await expect(quota.run(request())).rejects.toThrow(/한도에 도달.*유료 API로 전환하지 않았습니다/);
  // The next turn stops before starting Claude at all.
  await expect(quota.run(request())).rejects.toThrow(/한도에 도달/);

  const api = new ClaudeCodeProvider({ command: [process.execPath, fixture("claude-cli.ts"), "api-key"], home });
  const st = await api.connection(true);
  expect(st.state).toBe("error");
  expect(st.error).toMatch(/API 인증으로는 요청하지 않습니다/);
});

test("Codex: ChatGPT login in the browser, usage windows and models", async () => {
  const home = mkdtempSync(join(tmpdir(), "rsage-codex-"));
  const p = new CodexProvider({ command: [process.execPath, fixture("codex-cli.ts")], home });
  try {
    const first = await p.connection();
    expect(first).toMatchObject({ state: "signedOut", cliVersion: "0.170.0" });
    let opened = "";
    await p.login((url) => (opened = url));
    expect(opened).toStartWith("https://auth.openai.com/");
    expect(await until(async () => (await p.connection()).state === "connected")).toBe(true);
    const st = await p.connection();
    expect(st).toMatchObject({ email: "anselm@example.com", plan: "pro" });
    expect(st.quotas).toEqual([
      { label: "5시간 한도", usedPercent: 40, resetsAt: 2_000_000_000 },
      { label: "주간 한도", usedPercent: 10, resetsAt: 2_000_500_000 },
    ]);
    expect((await p.models()).map((m) => m.id)).toEqual(["codex:default", "codex:gpt-test"]);
    await p.logout();
    expect((await p.connection()).state).toBe("signedOut");
  } finally {
    p.dispose();
  }
});
