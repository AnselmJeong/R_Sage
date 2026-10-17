// Jupyter messaging protocol (v5.3) over the ZMTP sockets.
// https://jupyter-client.readthedocs.io/en/stable/messaging.html

import { createHmac, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { ZmtpSocket } from "@rsage/zmtp";

export interface ConnectionInfo {
  ip: string;
  transport: "tcp";
  signature_scheme: "hmac-sha256";
  key: string;
  shell_port: number;
  iopub_port: number;
  stdin_port: number;
  control_port: number;
  hb_port: number;
  kernel_name?: string;
}

export interface Header {
  msg_id: string;
  session: string;
  username: string;
  date: string;
  msg_type: string;
  version: string;
}

export interface JupyterMessage<C = any> {
  header: Header;
  parent_header: Partial<Header>;
  metadata: Record<string, unknown>;
  content: C;
  buffers: Buffer[];
  channel: Channel;
}

export type Channel = "shell" | "control" | "iopub" | "stdin";

const DELIM = Buffer.from("<IDS|MSG>");

export class MessageCodec {
  constructor(
    private key: string,
    readonly session: string,
  ) {}

  sign(parts: Buffer[]): string {
    if (!this.key) return "";
    const h = createHmac("sha256", this.key);
    for (const p of parts) h.update(p);
    return h.digest("hex");
  }

  encode(msgType: string, content: unknown, parent: Partial<Header> = {}, metadata = {}): {
    header: Header;
    frames: Buffer[];
  } {
    const header: Header = {
      msg_id: randomUUID(),
      session: this.session,
      username: "rsage",
      date: new Date().toISOString(),
      msg_type: msgType,
      version: "5.3",
    };
    const parts = [header, parent, metadata, content].map((x) => Buffer.from(JSON.stringify(x)));
    return { header, frames: [DELIM, Buffer.from(this.sign(parts)), ...parts] };
  }

  decode(frames: Buffer[], channel: Channel): JupyterMessage | undefined {
    const i = frames.findIndex((f) => f.equals(DELIM));
    if (i < 0 || frames.length < i + 6) return undefined;
    const sig = frames[i + 1]!.toString();
    const parts = frames.slice(i + 2, i + 6);
    if (this.key && sig !== this.sign(parts)) return undefined;
    const [header, parent_header, metadata, content] = parts.map((p) => JSON.parse(p.toString()));
    return { header, parent_header, metadata, content, buffers: frames.slice(i + 6), channel };
  }
}

/**
 * Raw Jupyter client: four sockets plus request/reply correlation.
 * Emits "message" (JupyterMessage) for every message on iopub/shell/control/stdin.
 */
export class JupyterClient extends EventEmitter {
  readonly codec: MessageCodec;
  private sockets: Record<Channel, ZmtpSocket>;
  private waiters = new Map<string, (m: JupyterMessage) => void>();

  constructor(readonly conn: ConnectionInfo) {
    super();
    this.codec = new MessageCodec(conn.key, randomUUID());
    const identity = Buffer.from(this.codec.session);
    this.sockets = {
      shell: new ZmtpSocket({ type: "DEALER", identity }),
      control: new ZmtpSocket({ type: "DEALER", identity }),
      stdin: new ZmtpSocket({ type: "DEALER", identity }),
      iopub: new ZmtpSocket({ type: "SUB" }),
    };
    for (const [channel, sock] of Object.entries(this.sockets) as [Channel, ZmtpSocket][]) {
      sock.on("message", (frames: Buffer[]) => {
        const msg = this.codec.decode(frames, channel);
        if (!msg) return;
        if (channel !== "iopub") {
          const w = msg.parent_header.msg_id && this.waiters.get(msg.parent_header.msg_id);
          if (w) {
            this.waiters.delete(msg.parent_header.msg_id!);
            w(msg);
          }
        }
        this.emit("message", msg);
      });
      sock.on("error", (err) => this.emit("socket-error", channel, err));
      sock.on("close", () => this.emit("socket-close", channel));
    }
    this.sockets.iopub.subscribe("");
  }

  async connect(): Promise<void> {
    const { ip, shell_port, control_port, stdin_port, iopub_port } = this.conn;
    await Promise.all([
      this.sockets.iopub.connect(ip, iopub_port),
      this.sockets.shell.connect(ip, shell_port),
      this.sockets.control.connect(ip, control_port),
      this.sockets.stdin.connect(ip, stdin_port),
    ]);
  }

  /** Send a message; returns its header. */
  send(channel: Exclude<Channel, "iopub">, msgType: string, content: unknown, parent?: Partial<Header>): Header {
    const { header, frames } = this.codec.encode(msgType, content, parent);
    this.sockets[channel].send(frames);
    return header;
  }

  /** Send and wait for the reply with matching parent msg_id. */
  request<C = any>(
    channel: "shell" | "control",
    msgType: string,
    content: unknown,
    timeoutMs = 0,
  ): { header: Header; reply: Promise<JupyterMessage<C>> } {
    const { header, frames } = this.codec.encode(msgType, content);
    const reply = new Promise<JupyterMessage<C>>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      this.waiters.set(header.msg_id, (m) => {
        if (timer) clearTimeout(timer);
        resolve(m as JupyterMessage<C>);
      });
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (this.waiters.delete(header.msg_id)) reject(new Error(`${msgType} timed out`));
        }, timeoutMs);
      }
    });
    this.sockets[channel].send(frames);
    return { header, reply };
  }

  close() {
    for (const s of Object.values(this.sockets)) s.close();
    this.waiters.clear();
  }
}
