import { expect, test } from "bun:test";
import { McpBridge } from "../src/assistant/mcp";
import { TOOL_SPECS } from "../src/assistant/tools";

test("the MCP bridge serves tools only to the run that owns the token", async () => {
  const bridge = new McpBridge(TOOL_SPECS);
  const run = bridge.open(async (name, input) => ({ output: `${name}:${JSON.stringify(input)}`, images: [{ mime: "image/png", data: "AA==" }] }));
  const post = (url: string, body: unknown) =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const init = await (await post(run.url, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).json();
    expect(init.result.serverInfo.name).toBe("rsage");
    expect((await post(run.url, { jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const list = await (await post(run.url, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    expect(list.result.tools.map((t: any) => t.name)).toContain("run_r");
    const res = await (await post(run.url, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_plot", arguments: {} } })).json();
    expect(res.result.content[0].text).toBe("get_plot:{}");
    expect(res.result.content[1]).toEqual({ type: "image", data: "AA==", mimeType: "image/png" });
    const bad = run.url.replace(/[0-9a-f]{8}$/, "00000000");
    expect((await post(bad, { jsonrpc: "2.0", id: 4, method: "tools/list" })).status).toBe(404);
    run.close();
    expect((await post(run.url, { jsonrpc: "2.0", id: 5, method: "tools/list" })).status).toBe(404);
  } finally {
    bridge.dispose();
  }
});
