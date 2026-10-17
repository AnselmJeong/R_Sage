// A small MCP server (Streamable HTTP, JSON responses only) on localhost that
// exposes the assistant's tools to agents running in their own process
// (Claude Code, Codex). Each run gets its own token in the URL path, so a
// tool call lands in the conversation that started it.

import { randomBytes } from "node:crypto";
import type { Server } from "bun";
import type { ToolResult, ToolSpec } from "./types";

export type ToolHandler = (name: string, input: any) => Promise<Omit<ToolResult, "callId" | "name">>;

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: any;
}

export class McpBridge {
  private server?: Server<unknown>;
  private runs = new Map<string, ToolHandler>();

  constructor(private tools: ToolSpec[]) {}

  /** Registers a run; returns its URL and token. Call the returned function to close it. */
  open(handler: ToolHandler): { url: string; token: string; close: () => void } {
    this.start();
    const token = randomBytes(24).toString("hex");
    this.runs.set(token, handler);
    return { url: `http://127.0.0.1:${this.server!.port}/mcp/${token}`, token, close: () => this.runs.delete(token) };
  }

  dispose() {
    this.server?.stop(true);
    this.server = undefined;
  }

  private start() {
    if (this.server) return;
    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      // Tool calls wait for the user's approval; never time the request out.
      idleTimeout: 0,
      fetch: (req) => this.handle(req),
    });
  }

  private async handle(req: Request): Promise<Response> {
    const m = /^\/mcp\/([0-9a-f]+)$/.exec(new URL(req.url).pathname);
    const token = m?.[1];
    const handler = token ? this.runs.get(token) : undefined;
    // The token is in the path; agents may also send it as a bearer header.
    const auth = req.headers.get("authorization");
    if (!handler || (auth && auth !== `Bearer ${token}`)) return new Response("not found", { status: 404 });
    if (req.method === "DELETE") return new Response(null, { status: 200 });
    // No server-initiated stream.
    if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: { allow: "POST, DELETE" } });

    let body: RpcRequest | RpcRequest[];
    try {
      body = (await req.json()) as RpcRequest | RpcRequest[];
    } catch {
      return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
    }
    const batch = Array.isArray(body) ? body : [body];
    const replies = (await Promise.all(batch.map((r) => this.dispatch(r, handler)))).filter((r) => r !== null);
    if (!replies.length) return new Response(null, { status: 202 });
    return Response.json(Array.isArray(body) ? replies : replies[0]);
  }

  private async dispatch(r: RpcRequest, handler: ToolHandler): Promise<object | null> {
    // Notifications (no id) get no reply.
    if (r.id === undefined || r.id === null) return null;
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: r.id, result });
    switch (r.method) {
      case "initialize":
        return ok({
          protocolVersion: r.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "rsage", version: "0.1.0" },
          instructions: "Tools for the user's R Sage project: files, the live R session, plots, and approved file edits.",
        });
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: this.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })) });
      case "tools/call": {
        const name = String(r.params?.name ?? "");
        if (!this.tools.some((t) => t.name === name)) return { jsonrpc: "2.0", id: r.id, error: { code: -32602, message: `Unknown tool: ${name}` } };
        let res: Omit<ToolResult, "callId" | "name">;
        try {
          res = await handler(name, r.params?.arguments ?? {});
        } catch (err: any) {
          res = { output: err?.message ?? String(err), isError: true };
        }
        return ok({
          content: [
            { type: "text", text: res.output || "(no output)" },
            ...(res.images ?? []).map((img) => ({ type: "image", data: img.data, mimeType: img.mime })),
          ],
          isError: !!res.isError,
        });
      }
      default:
        return { jsonrpc: "2.0", id: r.id, error: { code: -32601, message: `Method not found: ${r.method}` } };
    }
  }
}
