// Jupyter comms with Ark (the Positron extensions to the protocol).
//
// Frontend-opened comms: positron.ui (enables dynamic plots, prompt state,
// working directory), positron.variables, positron.help.
// Kernel-opened comms: positron.plot (one per plot), positron.dataExplorer
// (one per View()).
//
// Requests are comm_msg with data {jsonrpc, id, method, params}; Ark answers
// on iopub with a comm_msg whose parent is our request and data
// {method, result} or {error}. Events are comm_msg without an id.
// Protocol shapes follow Ark's generated types (crates/amalthea/src/comm).

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { JupyterMessage, KernelSession } from "@rsage/kernel";

export interface OpenComm {
  commId: string;
  target: string;
  data: any;
  /** Execution that created it (plots, data explorers). */
  executionId?: string;
  openedAt: string;
}

export const FRONTEND_COMMS = ["positron.ui", "positron.variables", "positron.help"] as const;

/**
 * Events:
 * - "open" (OpenComm)
 * - "event" ({ commId, target, method, params })
 * - "close" ({ commId, target })
 */
export class CommManager extends EventEmitter {
  private comms = new Map<string, OpenComm>();
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private frontend = new Map<string, string>(); // target → commId

  constructor(private session: KernelSession) {
    super();
    session.on("comm", (m: JupyterMessage) => this.onComm(m));
    session.on("state", (s) => {
      if (s.state === "starting" || s.state === "exited" || s.state === "stopped") this.reset();
    });
  }

  list(): OpenComm[] {
    return [...this.comms.values()];
  }

  byTarget(target: string): OpenComm | undefined {
    const id = this.frontend.get(target);
    return id ? this.comms.get(id) : [...this.comms.values()].find((c) => c.target === target);
  }

  private reset() {
    for (const c of this.comms.values()) this.emit("close", { commId: c.commId, target: c.target });
    this.comms.clear();
    this.frontend.clear();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("R session ended"));
    }
    this.pending.clear();
  }

  /** Open the comms the frontend owns. Call after every session start. */
  openFrontendComms() {
    const client = this.session.jupyter;
    if (!client) return;
    for (const target of FRONTEND_COMMS) {
      const commId = randomUUID();
      const comm: OpenComm = { commId, target, data: {}, openedAt: new Date().toISOString() };
      this.comms.set(commId, comm);
      this.frontend.set(target, commId);
      client.send("shell", "comm_open", { comm_id: commId, target_name: target, data: {} });
      this.emit("open", comm);
    }
  }

  rpc(commId: string, method: string, params?: unknown, timeoutMs = 30000): Promise<unknown> {
    const client = this.session.jupyter;
    if (!client) return Promise.reject(new Error("R session is not running"));
    if (!this.comms.has(commId)) return Promise.reject(new Error(`Comm ${commId} is not open`));
    // The reply arrives asynchronously on iopub, so registering after send is safe.
    const header = client.send("shell", "comm_msg", {
      comm_id: commId,
      // Ark rejects a params map for unit-variant requests (e.g. get_state).
      data: { jsonrpc: "2.0", id: randomUUID(), method, ...(params === undefined ? {} : { params }) },
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(header.msg_id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(header.msg_id, { resolve, reject, timer });
    });
  }

  /** Fire-and-forget notification to the backend (no reply expected). */
  notify(commId: string, method: string, params?: unknown) {
    this.session.jupyter?.send("shell", "comm_msg", { comm_id: commId, data: { jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) } });
  }

  close(commId: string) {
    const c = this.comms.get(commId);
    if (!c) return;
    this.session.jupyter?.send("shell", "comm_close", { comm_id: commId, data: {} });
    this.comms.delete(commId);
    this.emit("close", { commId, target: c.target });
  }

  private onComm(m: JupyterMessage) {
    const c = m.content;
    switch (m.header.msg_type) {
      case "comm_open": {
        // Ark sends kernel-opened comms without a parent header, so link a
        // plot or data viewer to whatever execution is running.
        const parent = m.parent_header?.msg_id;
        const rec = this.session.executionForMsg(parent) ?? this.session.runningExecution();
        const comm: OpenComm = {
          commId: c.comm_id,
          target: c.target_name,
          data: c.data ?? {},
          executionId: rec?.id,
          openedAt: new Date().toISOString(),
        };
        // The LSP bridge opens its own "lsp" comm; it is not ours to track.
        if (comm.target === "lsp" || comm.target === "ark_dap") return;
        this.comms.set(comm.commId, comm);
        if (rec) {
          rec.outputs.push(comm.commId);
          this.session.emit("execution", { ...rec });
        }
        this.emit("open", comm);
        break;
      }
      case "comm_msg": {
        const parent = m.parent_header?.msg_id;
        const p = parent ? this.pending.get(parent) : undefined;
        const data = c.data ?? {};
        if (p && (("result" in data) || ("error" in data))) {
          this.pending.delete(parent!);
          clearTimeout(p.timer);
          if (data.error) p.reject(new Error(data.error.message ?? "comm error"));
          else p.resolve(data.result);
          return;
        }
        const comm = this.comms.get(c.comm_id);
        if (!comm || !data.method) return;
        this.emit("event", { commId: comm.commId, target: comm.target, method: data.method, params: data.params ?? {} });
        break;
      }
      case "comm_close": {
        const comm = this.comms.get(c.comm_id);
        if (!comm) return;
        this.comms.delete(c.comm_id);
        this.emit("close", { commId: comm.commId, target: comm.target });
        break;
      }
    }
  }
}
