// Browser shell: serves the built UI and a token-protected WebSocket on
// localhost. Used for development and for end-to-end tests; the desktop app
// uses Electrobun's RPC instead (apps/desktop).

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import type { ServerWebSocket } from "bun";
import type { WireMessage } from "@rsage/shared";
import { Host } from "./host";
import { connectUi } from "./transport";

const port = Number(process.env.RSAGE_PORT ?? 7878);
const token = process.env.RSAGE_TOKEN ?? randomBytes(16).toString("hex");
const distDir = process.env.RSAGE_UI_DIST ?? join(import.meta.dir, "..", "..", "ui", "dist");

const host = new Host({ shell: "browser" });
type Data = { onMessage?: (m: WireMessage) => void; detach?: () => void };

const server = Bun.serve<Data>({
  hostname: "127.0.0.1",
  port,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (url.searchParams.get("token") !== token) return new Response("forbidden", { status: 403 });
      return srv.upgrade(req, { data: {} }) ? undefined : new Response("upgrade failed", { status: 400 });
    }
    const rel = normalize(url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname));
    const file = join(distDir, rel);
    if (!file.startsWith(distDir) || !existsSync(file)) return new Response("not found", { status: 404 });
    return new Response(Bun.file(file));
  },
  websocket: {
    maxPayloadLength: 64 * 1024 * 1024,
    open(ws: ServerWebSocket<Data>) {
      const conn = connectUi(host, (m) => ws.send(JSON.stringify(m)));
      ws.data.onMessage = conn.onMessage;
      ws.data.detach = conn.detach;
    },
    message(ws: ServerWebSocket<Data>, raw) {
      ws.data.onMessage?.(JSON.parse(String(raw)));
    },
    close(ws: ServerWebSocket<Data>) {
      ws.data.detach?.();
    },
  },
});

console.log(`R Sage (browser shell) at http://127.0.0.1:${server.port}/?token=${token}`);

const quit = async () => {
  await host.dispose();
  process.exit(0);
};
process.on("SIGINT", quit);
process.on("SIGTERM", quit);
