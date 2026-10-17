// Minimal ZMTP 3.0 client (NULL security) in pure TypeScript.
//
// The `zeromq` npm package is a N-API addon that crashes under Bun
// (uv_async_init is not implemented), so R Sage speaks the wire protocol
// itself. Only what a Jupyter frontend needs is implemented: client-side
// DEALER, SUB and REQ sockets connecting over TCP to a kernel's
// ROUTER / PUB / REP sockets.
//
// Spec: https://rfc.zeromq.org/spec/23/ (ZMTP 3.0)

import net from "node:net";
import { EventEmitter } from "node:events";

export type SocketType = "DEALER" | "SUB" | "REQ";

const FLAG_MORE = 0x01;
const FLAG_LONG = 0x02;
const FLAG_COMMAND = 0x04;

/** The 64-byte greeting for ZMTP 3.0 with the NULL mechanism, as client. */
export function greeting(): Buffer {
  const g = Buffer.alloc(64, 0);
  g[0] = 0xff;
  g[9] = 0x7f;
  g[10] = 3; // major
  g[11] = 0; // minor: advertise 3.0 so subscriptions are plain messages
  g.write("NULL", 12, "ascii");
  g[32] = 0; // as-server = false
  return g;
}

export function encodeFrame(body: Buffer, more: boolean, command = false): Buffer {
  let flags = (more ? FLAG_MORE : 0) | (command ? FLAG_COMMAND : 0);
  if (body.length > 255) {
    flags |= FLAG_LONG;
    const head = Buffer.alloc(9);
    head[0] = flags;
    head.writeBigUInt64BE(BigInt(body.length), 1);
    return Buffer.concat([head, body]);
  }
  const head = Buffer.alloc(2);
  head[0] = flags;
  head[1] = body.length;
  return Buffer.concat([head, body]);
}

export function encodeMessage(parts: Buffer[]): Buffer {
  return Buffer.concat(parts.map((p, i) => encodeFrame(p, i < parts.length - 1)));
}

/** READY command body with metadata properties. */
export function readyCommand(props: Record<string, Buffer | string>): Buffer {
  const chunks: Buffer[] = [Buffer.from([5]), Buffer.from("READY", "ascii")];
  for (const [name, raw] of Object.entries(props)) {
    const value = typeof raw === "string" ? Buffer.from(raw) : raw;
    const len = Buffer.alloc(4);
    len.writeUInt32BE(value.length);
    chunks.push(Buffer.from([name.length]), Buffer.from(name, "ascii"), len, value);
  }
  return encodeFrame(Buffer.concat(chunks), false, true);
}

export interface Frame {
  body: Buffer;
  more: boolean;
  command: boolean;
}

/** Incremental frame decoder: feed bytes, get whole frames out. */
export class FrameDecoder {
  private buf: Buffer = Buffer.alloc(0);

  push(data: Buffer): Frame[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, data]) : data;
    const frames: Frame[] = [];
    for (;;) {
      if (this.buf.length < 2) break;
      const flags = this.buf[0]!;
      let size: number;
      let headLen: number;
      if (flags & FLAG_LONG) {
        if (this.buf.length < 9) break;
        size = Number(this.buf.readBigUInt64BE(1));
        headLen = 9;
      } else {
        size = this.buf[1]!;
        headLen = 2;
      }
      if (this.buf.length < headLen + size) break;
      frames.push({
        body: this.buf.subarray(headLen, headLen + size),
        more: (flags & FLAG_MORE) !== 0,
        command: (flags & FLAG_COMMAND) !== 0,
      });
      this.buf = this.buf.subarray(headLen + size);
    }
    // Detach from the large concatenated buffer so it can be collected.
    if (this.buf.length) this.buf = Buffer.from(this.buf);
    return frames;
  }
}

function commandName(body: Buffer): string {
  const n = body[0] ?? 0;
  return body.subarray(1, 1 + n).toString("ascii");
}

export interface ZmtpSocketOptions {
  type: SocketType;
  /** Routing identity sent in READY metadata (DEALER/REQ only). */
  identity?: Buffer;
  /** How long to keep retrying while the peer is not listening yet. */
  connectTimeoutMs?: number;
}

type State = "connecting" | "greeting" | "handshake" | "ready" | "closed";

/**
 * One client socket with one peer connection. Emits:
 * - "message" (parts: Buffer[]) for each complete multipart message
 * - "ready" once the handshake finished
 * - "error" (err), "close"
 */
export class ZmtpSocket extends EventEmitter {
  readonly type: SocketType;
  private sock?: net.Socket;
  private state: State = "connecting";
  private pending: Buffer[] = [];
  private decoder = new FrameDecoder();
  private greetBuf = Buffer.alloc(0);
  private parts: Buffer[] = [];
  private opts: ZmtpSocketOptions;
  private subscriptions: Buffer[] = [];

  constructor(opts: ZmtpSocketOptions) {
    super();
    this.type = opts.type;
    this.opts = opts;
  }

  get isReady(): boolean {
    return this.state === "ready";
  }

  /** Connect, retrying while the kernel has not bound the port yet. */
  connect(host: string, port: number): Promise<void> {
    const deadline = Date.now() + (this.opts.connectTimeoutMs ?? 20000);
    return new Promise((resolve, reject) => {
      const attempt = () => {
        if (this.state === "closed") return reject(new Error("socket closed"));
        const s = net.createConnection({ host, port });
        let established = false;
        s.once("connect", () => {
          established = true;
          s.setNoDelay(true);
          this.sock = s;
          this.state = "greeting";
          s.write(greeting());
        });
        s.on("data", (d: Buffer) => this.onData(d));
        s.on("error", (err: NodeJS.ErrnoException) => {
          if (!established) {
            s.destroy();
            if (Date.now() < deadline && (err.code === "ECONNREFUSED" || err.code === "ECONNRESET")) {
              setTimeout(attempt, 50);
            } else {
              reject(err);
            }
            return;
          }
          this.emit("error", err);
        });
        s.on("close", () => {
          if (established && this.state !== "closed") {
            this.state = "closed";
            this.emit("close");
          }
        });
      };
      this.once("ready", () => resolve());
      attempt();
    });
  }

  private onData(d: Buffer) {
    if (this.state === "greeting") {
      this.greetBuf = Buffer.concat([this.greetBuf, d]);
      if (this.greetBuf.length < 64) return;
      const g = this.greetBuf;
      if (g[0] !== 0xff || g[9] !== 0x7f || (g[10] ?? 0) < 3) {
        this.emit("error", new Error("peer is not a ZMTP 3 endpoint"));
        this.close();
        return;
      }
      const rest = g.subarray(64);
      this.greetBuf = Buffer.alloc(0);
      this.state = "handshake";
      const props: Record<string, Buffer | string> = { "Socket-Type": this.type };
      if (this.opts.identity && this.type !== "SUB") props["Identity"] = this.opts.identity;
      this.sock!.write(readyCommand(props));
      if (rest.length) this.onFrames(this.decoder.push(Buffer.from(rest)));
      return;
    }
    this.onFrames(this.decoder.push(d));
  }

  private onFrames(frames: Frame[]) {
    for (const f of frames) {
      if (f.command) {
        this.onCommand(f.body);
        continue;
      }
      if (this.state !== "ready") continue;
      this.parts.push(Buffer.from(f.body));
      if (!f.more) {
        let msg = this.parts;
        this.parts = [];
        // REQ strips the empty delimiter frame the REP peer echoes back.
        if (this.type === "REQ" && msg.length && msg[0]!.length === 0) msg = msg.slice(1);
        this.emit("message", msg);
      }
    }
  }

  private onCommand(body: Buffer) {
    const name = commandName(body);
    if (name === "READY" && this.state === "handshake") {
      this.state = "ready";
      for (const sub of this.subscriptions) this.sock!.write(encodeMessage([sub]));
      for (const p of this.pending) this.sock!.write(p);
      this.pending = [];
      this.emit("ready");
    } else if (name === "ERROR") {
      const n = body[6] ?? 0;
      this.emit("error", new Error(`ZMTP peer error: ${body.subarray(7, 7 + n).toString()}`));
    } else if (name === "PING") {
      // PING: name, 2-byte TTL, context. Reply PONG with the same context.
      const ctx = body.subarray(1 + 4 + 2);
      const pong = Buffer.concat([Buffer.from([4]), Buffer.from("PONG"), ctx]);
      this.sock?.write(encodeFrame(pong, false, true));
    }
  }

  /** SUB only: subscribe to a topic prefix ("" = everything). */
  subscribe(topic = "") {
    const frame = Buffer.concat([Buffer.from([1]), Buffer.from(topic)]);
    if (this.state === "ready") this.sock!.write(encodeMessage([frame]));
    else this.subscriptions.push(frame);
  }

  send(parts: Buffer[]) {
    if (this.state === "closed") throw new Error("socket closed");
    const wire = encodeMessage(this.type === "REQ" ? [Buffer.alloc(0), ...parts] : parts);
    if (this.state === "ready") this.sock!.write(wire);
    else this.pending.push(wire);
  }

  close() {
    if (this.state === "closed") return;
    this.state = "closed";
    this.sock?.destroy();
    this.emit("close");
  }
}
