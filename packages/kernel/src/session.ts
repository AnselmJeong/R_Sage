// One R session: an Ark process plus the Jupyter client talking to it.
//
// Every execution gets an id and lands in the run history (design principle 3:
// results stay linked to the code that produced them). Each (re)start bumps the
// session generation so the UI can tell results of a previous session apart.

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync, rmSync } from "node:fs";
import { launchArk, type LaunchedKernel } from "./ark";
import { JupyterClient, type JupyterMessage } from "./jupyter";

export type SessionState = "stopped" | "starting" | "idle" | "busy" | "interrupting" | "restarting" | "exited";

export interface SourceRef {
  file: string;
  line: number;
  endLine?: number;
}

export interface ExecutionRecord {
  id: string;
  generation: number;
  code: string;
  source?: SourceRef;
  /** "console" for typed input, "editor" for code sent from a file, "app" for UI-issued code. */
  origin: "console" | "editor" | "app" | "ai";
  executionCount?: number;
  startedAt: string;
  finishedAt?: string;
  status: "queued" | "running" | "ok" | "error" | "aborted";
  error?: { ename: string; evalue: string; traceback: string[] };
  /** Display ids (e.g. plot comm ids) produced by this execution. */
  outputs: string[];
}

export type OutputEvent =
  | { kind: "input"; executionId: string; code: string; executionCount?: number }
  | { kind: "stream"; executionId?: string; name: "stdout" | "stderr"; text: string }
  | { kind: "result"; executionId?: string; data: Record<string, unknown> }
  | { kind: "display"; executionId?: string; data: Record<string, unknown>; displayId?: string }
  | { kind: "error"; executionId?: string; ename: string; evalue: string; traceback: string[] }
  | { kind: "input_request"; prompt: string; password: boolean }
  | { kind: "done"; executionId: string; status: ExecutionRecord["status"] };

export interface SessionInfo {
  state: SessionState;
  generation: number;
  rHome?: string;
  rVersion?: string;
  pid?: number;
  cwd?: string;
  logFile?: string;
  exitCode?: number | null;
  /** Shown when the R process died on its own. */
  crashMessage?: string;
}

export interface StartOptions {
  arkPath: string;
  rHome: string;
  cwd: string;
  runtimeDir?: string;
  env?: Record<string, string>;
  startupFile?: string;
}

/**
 * Events:
 * - "state" (SessionInfo)
 * - "output" (OutputEvent)
 * - "execution" (ExecutionRecord) whenever a record changes
 * - "comm" (JupyterMessage) for comm_open / comm_msg / comm_close
 * - "iopub" (JupyterMessage) raw, for anything else that wants it
 */
export class KernelSession extends EventEmitter {
  private kernel?: LaunchedKernel;
  private client?: JupyterClient;
  private info: SessionInfo = { state: "stopped", generation: 0 };
  private byMsgId = new Map<string, ExecutionRecord>();
  /**
   * The shell reply can arrive before the iopub output it caused, so an
   * execution is done only once both the reply and the idle status are in.
   */
  private interrupted = new Set<ExecutionRecord>();
  private pendingDone = new Map<ExecutionRecord, { reply?: ExecutionRecord["status"]; idle?: boolean }>();
  private stopping = false;
  private lastStart?: StartOptions;
  private lastStderrFile?: string;

  get state(): SessionInfo {
    return { ...this.info };
  }

  get jupyter(): JupyterClient | undefined {
    return this.client;
  }

  private setState(patch: Partial<SessionInfo>) {
    this.info = { ...this.info, ...patch };
    this.emit("state", this.state);
  }

  async start(opts: StartOptions): Promise<SessionInfo> {
    if (this.kernel) await this.shutdown();
    this.lastStart = opts;
    this.stopping = false;
    this.setState({
      state: "starting",
      generation: this.info.generation + 1,
      rHome: opts.rHome,
      cwd: opts.cwd,
      crashMessage: undefined,
      exitCode: undefined,
    });
    const generation = this.info.generation;

    const kernel = await launchArk({
      ...opts,
      onExit: (code, signal) => this.onExit(generation, code, signal),
    });
    this.kernel = kernel;
    this.lastStderrFile = kernel.stderrFile;
    const client = new JupyterClient(kernel.conn);
    this.client = client;
    client.on("message", (m: JupyterMessage) => this.onMessage(m));
    await client.connect();
    const { reply } = client.request("shell", "kernel_info_request", {}, 60000);
    const ki = await reply;
    const banner: string = ki.content?.language_info?.version ?? "";
    const version = banner.match(/(\d+\.\d+\.\d+)/)?.[1] ?? banner;
    this.setState({ state: "idle", rVersion: version, pid: kernel.proc.pid, logFile: kernel.logFile });
    return this.state;
  }

  private onExit(generation: number, code: number | null, signal: string | null) {
    if (generation !== this.info.generation) return;
    this.client?.close();
    this.client = undefined;
    this.kernel = undefined;
    for (const rec of this.byMsgId.values()) {
      if (rec.status === "running" || rec.status === "queued") this.finish(rec, "aborted");
    }
    this.byMsgId.clear();
    if (this.stopping) {
      this.setState({ state: "stopped", pid: undefined, exitCode: code });
    } else {
      let tail = "";
      try {
        tail = readFileSync(this.lastStderrFile ?? "", "utf8").trim().slice(-2000);
      } catch {}
      this.setState({
        state: "exited",
        pid: undefined,
        exitCode: code,
        crashMessage: `R exited unexpectedly (${signal ? `signal ${signal}` : `code ${code}`}).${tail ? `\n${tail}` : ""}`,
      });
    }
  }

  /** Requests sent by evalText: their output is the caller's, not the console's. */
  private privateIds = new Set<string>();

  private onMessage(m: JupyterMessage) {
    const parentId = m.parent_header?.msg_id;
    if (parentId && this.privateIds.has(parentId) && m.channel === "iopub" && m.header.msg_type !== "status") return;
    const rec = parentId ? this.byMsgId.get(parentId) : undefined;
    const executionId = rec?.id;
    const c = m.content;

    if (m.channel === "stdin" && m.header.msg_type === "rpc_request") {
      // Positron extension: the kernel asks the frontend something (e.g.
      // show_question) and blocks until we send an rpc_reply on stdin.
      this.emit("frontend_request", {
        method: c.method as string,
        params: c.params,
        reply: (result: unknown, error?: string) =>
          this.client?.send(
            "stdin",
            "rpc_reply",
            error ? { error: { code: -32603, message: error, data: null } } : { result: result ?? null },
            m.header,
          ),
      });
      return;
    }
    if (m.channel === "stdin" && m.header.msg_type === "input_request") {
      this.emit("output", { kind: "input_request", prompt: c.prompt ?? "", password: !!c.password } satisfies OutputEvent);
      return;
    }
    if (m.channel === "shell" && m.header.msg_type === "execute_reply" && rec) {
      rec.executionCount = c.execution_count;
      if (c.status === "error" && !rec.error) rec.error = { ename: c.ename, evalue: c.evalue, traceback: c.traceback ?? [] };
      this.markDone(rec, { reply: c.status === "ok" ? "ok" : c.status === "aborted" ? "aborted" : "error" });
      return;
    }
    if (m.channel !== "iopub") return;

    switch (m.header.msg_type) {
      case "status": {
        const s = c.execution_state;
        if (s === "idle" && rec) this.markDone(rec, { idle: true });
        if (s === "busy" || s === "idle") {
          if (this.info.state !== "starting" && this.info.state !== "restarting" && this.info.state !== s) {
            // Only track busy/idle for our own requests' parents, plus kernel-wide.
            this.setState({ state: s });
          }
        }
        break;
      }
      case "execute_input":
        if (rec) {
          rec.status = "running";
          rec.executionCount = c.execution_count;
          this.emit("execution", { ...rec });
        }
        break;
      case "stream":
        this.emit("output", { kind: "stream", executionId, name: c.name, text: c.text } satisfies OutputEvent);
        // Ark keeps going after an error in the user's .Rprofile, but its message reads like a failed start.
        if (/Error while sourcing R profile/.test(c.text ?? "") && this.profileNoted !== this.info.generation) {
          this.profileNoted = this.info.generation;
          const text =
            "\n[R Sage] .Rprofile을 실행하다 오류가 나서 그 줄부터 뒤의 내용은 적용되지 않았습니다. " +
            "R 세션은 정상적으로 시작되었습니다. 위 오류를 일으킨 줄을 고치거나 지우면 이 메시지는 나오지 않습니다.\n";
          this.emit("output", { kind: "stream", executionId, name: "stdout", text } satisfies OutputEvent);
        }
        break;
      case "execute_result":
        this.emit("output", { kind: "result", executionId, data: c.data } satisfies OutputEvent);
        break;
      case "display_data":
      case "update_display_data":
        this.emit("output", {
          kind: "display",
          executionId,
          data: c.data,
          displayId: c.transient?.display_id,
        } satisfies OutputEvent);
        break;
      case "error":
        if (rec) rec.error = { ename: c.ename, evalue: c.evalue, traceback: c.traceback ?? [] };
        this.emit("output", {
          kind: "error",
          executionId,
          ename: c.ename,
          evalue: c.evalue,
          traceback: c.traceback ?? [],
        } satisfies OutputEvent);
        break;
      case "comm_open":
      case "comm_msg":
      case "comm_close":
        this.emit("comm", m);
        break;
    }
    this.emit("iopub", m);
  }

  private markDone(rec: ExecutionRecord, patch: { reply?: ExecutionRecord["status"]; idle?: boolean }) {
    const p = { ...this.pendingDone.get(rec), ...patch };
    if (p.reply && p.idle) {
      this.pendingDone.delete(rec);
      this.finish(rec, p.reply);
    } else {
      this.pendingDone.set(rec, p);
    }
  }

  private finish(rec: ExecutionRecord, status: ExecutionRecord["status"]) {
    this.pendingDone.delete(rec);
    // R reports an interrupted evaluation as "ok"; the record should not.
    if (this.interrupted.delete(rec) && status === "ok") status = "aborted";
    rec.status = status;
    rec.finishedAt = new Date().toISOString();
    this.emit("execution", { ...rec });
    this.emit("output", { kind: "done", executionId: rec.id, status } satisfies OutputEvent);
    for (const [k, v] of this.byMsgId) if (v === rec) this.byMsgId.delete(k);
  }

  /** Attach an output (e.g. a plot id) to the execution that produced it. */
  attachOutput(parentMsgId: string | undefined, outputId: string): ExecutionRecord | undefined {
    const rec = parentMsgId ? this.byMsgId.get(parentMsgId) : undefined;
    if (rec) {
      rec.outputs.push(outputId);
      this.emit("execution", { ...rec });
    }
    return rec;
  }

  /** The execution R is busy with right now, if any. */
  runningExecution(): ExecutionRecord | undefined {
    for (const rec of this.byMsgId.values()) if (rec.status === "running") return rec;
    return undefined;
  }

  executionForMsg(msgId: string | undefined): ExecutionRecord | undefined {
    return msgId ? this.byMsgId.get(msgId) : undefined;
  }

  execute(
    code: string,
    opts: { origin?: ExecutionRecord["origin"]; source?: SourceRef; silent?: boolean; storeHistory?: boolean; /** false: run normally (plots reach the Plots pane) but don't show the code in the console. */ echo?: boolean } = {},
  ): ExecutionRecord {
    if (!this.client) throw new Error("R session is not running");
    const rec: ExecutionRecord = {
      id: randomUUID(),
      generation: this.info.generation,
      code,
      source: opts.source,
      origin: opts.origin ?? "console",
      startedAt: new Date().toISOString(),
      status: "queued",
      outputs: [],
    };
    const header = this.client.send("shell", "execute_request", {
      code,
      silent: !!opts.silent,
      store_history: opts.storeHistory ?? !opts.silent,
      user_expressions: {},
      allow_stdin: true,
      stop_on_error: true,
    });
    this.byMsgId.set(header.msg_id, rec);
    this.emit("execution", { ...rec });
    if (!opts.silent && opts.echo !== false) this.emit("output", { kind: "input", executionId: rec.id, code } satisfies OutputEvent);
    return rec;
  }

  /**
   * Run code without echo and return its stdout. Used by the app itself
   * (e.g. reading .libPaths()). Queues behind user code like any request.
   */
  async evalText(code: string, timeoutMs = 30000): Promise<string> {
    if (!this.client) throw new Error("R session is not running");
    const header = this.client.send("shell", "execute_request", {
      code,
      silent: false,
      store_history: false,
      user_expressions: {},
      allow_stdin: false,
      stop_on_error: true,
    });
    this.privateIds.add(header.msg_id);
    return new Promise((resolve, reject) => {
      let out = "";
      let reply: any;
      let idle = false;
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("evaluation timed out"));
      }, timeoutMs);
      const onMsg = (m: JupyterMessage) => {
        if (m.parent_header?.msg_id !== header.msg_id) return;
        if (m.header.msg_type === "stream" && m.content.name === "stdout") out += m.content.text;
        if (m.header.msg_type === "execute_result") out += m.content.data?.["text/plain"] ?? "";
        if (m.header.msg_type === "execute_reply") reply = m.content;
        if (m.header.msg_type === "status" && m.content.execution_state === "idle") idle = true;
        if (reply && idle) {
          cleanup();
          if (reply.status === "ok") resolve(out);
          else reject(new Error(reply.evalue ?? "evaluation failed"));
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.client?.off("message", onMsg);
        // Late messages (after idle) are still not the console's.
        setTimeout(() => this.privateIds.delete(header.msg_id), 5000);
      };
      this.client!.on("message", onMsg);
    });
  }

  /**
   * Run app code as one private request (no echo, no history, no execution
   * record) with no time limit. Aborting interrupts R only once this request
   * is the one R is running, so queued user code is never interrupted; a
   * request aborted while still queued runs later and its outcome is ignored.
   */
  runPrivate(code: string, signal?: AbortSignal): Promise<{ status: "ok" | "error" | "aborted"; error?: string; stdout: string }> {
    if (!this.client) return Promise.reject(new Error("R session is not running"));
    const client = this.client;
    const generation = this.info.generation;
    const header = client.send("shell", "execute_request", {
      code,
      silent: false,
      store_history: false,
      user_expressions: {},
      allow_stdin: false,
      stop_on_error: true,
    });
    this.privateIds.add(header.msg_id);
    return new Promise((resolve) => {
      let out = "";
      let reply: any;
      let idle = false;
      let busy = false;
      let aborted = false;
      let retry: ReturnType<typeof setInterval> | undefined;
      // R drops an interrupt that arrives inside C code that never checks for
      // one (saveRDS, some model fits), so keep asking until it is idle.
      const interrupt = () => {
        client.send("control", "interrupt_request", {});
        retry ??= setInterval(() => client.send("control", "interrupt_request", {}), 1000);
      };
      const finish = (r: { status: "ok" | "error" | "aborted"; error?: string }) => {
        clearInterval(retry);
        client.off("message", onMsg);
        this.off("state", onState);
        signal?.removeEventListener("abort", onAbort);
        setTimeout(() => this.privateIds.delete(header.msg_id), 5000);
        resolve({ ...r, stdout: out });
      };
      const onAbort = () => {
        aborted = true;
        if (busy && !idle) interrupt();
        else finish({ status: "aborted" });
      };
      const onState = (st: SessionInfo) => {
        if (st.generation !== generation || st.state === "exited" || st.state === "stopped") finish({ status: "error", error: "R 세션이 종료되었습니다." });
      };
      const onMsg = (m: JupyterMessage) => {
        if (m.parent_header?.msg_id !== header.msg_id) return;
        const t = m.header.msg_type;
        if (t === "stream" && m.content.name === "stdout") out += m.content.text;
        if (t === "execute_reply") reply = m.content;
        if (t === "status" && m.content.execution_state === "busy") {
          busy = true;
          if (aborted) interrupt();
        }
        if (t === "status" && m.content.execution_state === "idle") idle = true;
        if (reply && idle) {
          if (aborted) finish({ status: "aborted" });
          else if (reply.status === "ok") finish({ status: "ok" });
          else finish({ status: "error", error: reply.evalue ?? "evaluation failed" });
        }
      };
      client.on("message", onMsg);
      this.on("state", onState);
      signal?.addEventListener("abort", onAbort);
      if (signal?.aborted) onAbort();
    });
  }

  inputReply(value: string) {
    this.client?.send("stdin", "input_reply", { value });
  }

  /** Generation whose .Rprofile error has already been explained in the console. */
  private profileNoted = -1;

  async interrupt() {
    if (!this.client) return;
    for (const rec of this.byMsgId.values()) if (rec.status === "running") this.interrupted.add(rec);
    this.client.send("control", "interrupt_request", {});
  }

  async shutdown(): Promise<void> {
    const kernel = this.kernel;
    if (!kernel) {
      this.setState({ state: "stopped" });
      return;
    }
    this.stopping = true;
    try {
      this.client?.send("control", "shutdown_request", { restart: false });
    } catch {}
    const exited = await Promise.race([kernel.proc.exited.then(() => true), Bun.sleep(3000).then(() => false)]);
    if (!exited) {
      kernel.proc.kill("SIGKILL");
      await kernel.proc.exited;
    }
    this.client?.close();
    this.client = undefined;
    this.kernel = undefined;
    this.setState({ state: "stopped", pid: undefined });
    try {
      rmSync(kernel.connectionFile, { force: true });
    } catch {}
  }

  /** Last-resort cleanup when the app process exits: never leave R running. */
  killNow() {
    try {
      this.kernel?.proc.kill("SIGKILL");
    } catch {}
  }

  async restart(opts?: Partial<StartOptions>): Promise<SessionInfo> {
    if (!this.lastStart) throw new Error("session was never started");
    const next = { ...this.lastStart, ...opts };
    this.setState({ state: "restarting" });
    await this.shutdown();
    return this.start(next);
  }
}
