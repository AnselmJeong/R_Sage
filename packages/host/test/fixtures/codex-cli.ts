// Stand-in for the `codex` CLI: `app-server` speaks the JSON-RPC subset R Sage
// uses; login state lives in CODEX_HOME.
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const marker = join(process.env.CODEX_HOME!, "signed-in");
const send = (v: unknown) => process.stdout.write(JSON.stringify(v) + "\n");

if (args[0] === "app-server") {
  for await (const line of createInterface({ input: process.stdin })) {
    const m = JSON.parse(line);
    if (m.id === undefined) continue;
    const reply = (result: unknown) => send({ id: m.id, result });
    if (m.method === "initialize") reply({ userAgent: "rsage/0.170.0 (test)" });
    else if (m.method === "account/read") reply({ account: existsSync(marker) ? { type: "chatgpt", email: "anselm@example.com", planType: "pro" } : null });
    else if (m.method === "account/rateLimits/read")
      existsSync(marker)
        ? reply({ rateLimits: { limitId: "codex", primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 2_000_000_000 }, secondary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 2_000_500_000 } }, ordinaryUsageAllowed: true })
        : send({ id: m.id, error: { code: -32600, message: "codex account authentication required to read rate limits" } });
    else if (m.method === "model/list") reply({ data: [{ model: "gpt-test", displayName: "GPT-Test", hidden: false }, { model: "gpt-hidden", hidden: true }], nextCursor: null });
    else if (m.method === "account/login/start") {
      reply({ type: "chatgpt", loginId: "login-1", authUrl: "https://auth.openai.com/oauth/authorize?x=1" });
      setTimeout(() => {
        writeFileSync(marker, "ok");
        send({ method: "account/login/completed", params: { loginId: "login-1", success: true } });
      }, 100);
    } else if (m.method === "account/logout") {
      if (existsSync(marker)) unlinkSync(marker);
      reply({});
    } else send({ id: m.id, error: { code: -32601, message: "unknown" } });
  }
}
