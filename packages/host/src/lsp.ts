// Bridge to Ark's language server.
//
// Ark starts its LSP when the frontend opens a comm with target "lsp"; it
// replies with a `server_started` comm message carrying a TCP port. The
// host speaks LSP (Content-Length framed JSON-RPC) to that port and relays
// requests/notifications to the UI, which implements Monaco providers.

import net from "node:net";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";
import type { JupyterMessage, KernelSession } from "@rsage/kernel";

export class LspBridge extends EventEmitter {
  private sock?: net.Socket;
  private buf = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private commId?: string;
  running = false;

  constructor(private session: KernelSession) {
    super();
  }

  /** Open the LSP comm and connect. Call after each session start. */
  async start(rootPath: string): Promise<void> {
    this.stop();
    const client = this.session.jupyter;
    if (!client) throw new Error("R session is not running");
    const commId = randomUUID();
    this.commId = commId;
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.session.off("comm", onComm);
        reject(new Error("LSP did not start"));
      }, 30000);
      const onComm = (m: JupyterMessage) => {
        if (m.content?.comm_id !== commId || m.header.msg_type !== "comm_msg") return;
        const data = m.content.data;
        if (data?.method === "server_started") {
          clearTimeout(timer);
          this.session.off("comm", onComm);
          resolve(data.params.port);
        }
      };
      this.session.on("comm", onComm);
      client.send("shell", "comm_open", { comm_id: commId, target_name: "lsp", data: { ip_address: "127.0.0.1" } });
    });

    await new Promise<void>((resolve, reject) => {
      const s = net.createConnection({ host: "127.0.0.1", port }, () => resolve());
      s.on("error", reject);
      s.on("data", (d: Buffer) => this.onData(d));
      s.on("close", () => {
        if (this.sock === s) {
          this.running = false;
          this.emit("state", false);
        }
      });
      this.sock = s;
    });

    const rootUri = pathToFileURL(rootPath).href;
    await this.request("initialize", {
      processId: process.pid,
      clientInfo: { name: "R Sage" },
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: rootPath.split("/").pop() }],
      capabilities: {
        textDocument: {
          synchronization: { didSave: true },
          completion: { completionItem: { snippetSupport: true, documentationFormat: ["markdown", "plaintext"] } },
          hover: { contentFormat: ["markdown", "plaintext"] },
          signatureHelp: { signatureInformation: { documentationFormat: ["markdown", "plaintext"] } },
          publishDiagnostics: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        },
        workspace: { workspaceFolders: true, configuration: true },
      },
    });
    this.notify("initialized", {});
    this.running = true;
    this.emit("state", true);
  }

  stop() {
    for (const p of this.pending.values()) p.reject(new Error("LSP stopped"));
    this.pending.clear();
    this.sock?.destroy();
    this.sock = undefined;
    if (this.commId && this.session.jupyter) {
      try {
        this.session.jupyter.send("shell", "comm_close", { comm_id: this.commId, data: {} });
      } catch {}
    }
    this.commId = undefined;
    if (this.running) {
      this.running = false;
      this.emit("state", false);
    }
  }

  private write(msg: object) {
    if (!this.sock) throw new Error("LSP is not running");
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...msg }));
    this.sock.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
  }

  request(method: string, params: unknown, timeoutMs = 15000): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params: unknown) {
    this.write({ method, params });
  }

  private onData(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const sep = this.buf.indexOf("\r\n\r\n");
      if (sep < 0) return;
      const head = this.buf.subarray(0, sep).toString();
      const m = head.match(/Content-Length: (\d+)/i);
      if (!m) {
        this.buf = this.buf.subarray(sep + 4);
        continue;
      }
      const len = parseInt(m[1]!, 10);
      if (this.buf.length < sep + 4 + len) return;
      const body = this.buf.subarray(sep + 4, sep + 4 + len).toString();
      this.buf = this.buf.subarray(sep + 4 + len);
      this.onMessage(JSON.parse(body));
    }
  }

  private onMessage(msg: any) {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && !msg.method) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method && msg.id !== undefined) {
      // Server-to-client request. Answer the ones Ark sends.
      let result: unknown = null;
      if (msg.method === "workspace/configuration") result = (msg.params?.items ?? []).map(() => null);
      this.write({ id: msg.id, result });
      return;
    }
    if (msg.method) this.emit("notification", msg.method, msg.params);
  }
}
