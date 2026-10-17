// Typed client for the host API. The transport is either Electrobun's RPC
// (inside the desktop app) or a WebSocket (browser shell).

import type { EventName, HostEvents, MethodName, Params, Result, WireMessage } from "@rsage/shared";

export interface Transport {
  send(msg: WireMessage): void;
  onMessage(cb: (msg: WireMessage) => void): void;
  onClose?(cb: () => void): void;
}

type Listener<E extends EventName> = (payload: HostEvents[E]) => void;

export class HostClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private listeners = new Map<string, Set<(p: any) => void>>();

  constructor(private transport: Transport) {
    transport.onMessage((msg) => {
      if (msg.t === "res") {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error !== undefined) p.reject(new Error(msg.error));
        else p.resolve(msg.result);
      } else if (msg.t === "evt") {
        for (const l of this.listeners.get(msg.type) ?? []) l(msg.payload);
      }
    });
  }

  call<M extends MethodName>(method: M, params: Params<M> = {} as Params<M>): Promise<Result<M>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.transport.send({ t: "req", id, method, params });
    });
  }

  on<E extends EventName>(type: E, fn: Listener<E>): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }
}

export function websocketTransport(url: string): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const handlers: ((m: WireMessage) => void)[] = [];
    const closers: (() => void)[] = [];
    ws.onopen = () =>
      resolve({
        send: (m) => ws.send(JSON.stringify(m)),
        onMessage: (cb) => handlers.push(cb),
        onClose: (cb) => closers.push(cb),
      });
    ws.onerror = () => reject(new Error("Could not connect to the R Sage host"));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data) as WireMessage;
      for (const h of handlers) h(m);
    };
    ws.onclose = () => closers.forEach((c) => c());
  });
}

export let host: HostClient;

export async function connectHost(): Promise<HostClient> {
  const bridge = (window as any).__rsageElectrobun as (() => Transport) | undefined;
  let transport: Transport;
  if (bridge) {
    transport = bridge();
  } else {
    const params = new URLSearchParams(location.search);
    const token = params.get("token") ?? sessionStorage.getItem("rsage-token") ?? "";
    if (token) sessionStorage.setItem("rsage-token", token);
    const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?token=${token}`;
    transport = await websocketTransport(wsUrl);
  }
  host = new HostClient(transport);
  return host;
}
