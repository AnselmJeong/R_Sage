// Stand-in for the `claude` CLI: login state lives in CLAUDE_CONFIG_DIR.
import { appendFileSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [scenario, ...args] = process.argv.slice(2);
const dir = process.env.CLAUDE_CONFIG_DIR!;
const marker = join(dir, "signed-in");
appendFileSync(join(dir, "calls.jsonl"), JSON.stringify({ args, apiKey: process.env.ANTHROPIC_API_KEY ?? null }) + "\n");
const send = (v: unknown) => process.stdout.write(JSON.stringify(v) + "\n");

if (args.includes("--version")) console.log("2.1.300 (Claude Code)");
else if (args.includes("status")) {
  const loggedIn = existsSync(marker);
  send({ loggedIn, authMethod: scenario === "api-key" ? "api_key" : "claude.ai", apiProvider: "firstParty", subscriptionType: "max", email: "anselm@example.com" });
  if (!loggedIn) process.exitCode = 1;
} else if (args.includes("login")) {
  await Bun.sleep(100);
  writeFileSync(marker, "ok");
} else if (args.includes("logout")) {
  if (existsSync(marker)) unlinkSync(marker);
} else if (args.includes("-p")) {
  await Bun.stdin.text();
  send({ type: "system", subtype: "init", session_id: "cc-session-1" });
  const resetsAt = Math.floor(Date.now() / 1000) + 3600;
  if (scenario === "quota") {
    send({ type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt } });
    await Bun.sleep(30_000);
  } else {
    send({ type: "rate_limit_event", rate_limit_info: { status: "allowed", rateLimitType: "five_hour", utilization: 0.25, resetsAt } });
    send({ type: "stream_event", event: { type: "message_start" } });
    send({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "안녕하세요" } } });
    send({ type: "assistant", message: { content: [{ type: "text", text: "안녕하세요" }] } });
    send({ type: "result", subtype: "success", is_error: false, result: "안녕하세요", session_id: "cc-session-1" });
  }
}
