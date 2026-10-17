// Electrobun side of the UI transport. Only bundled in the desktop build,
// where "electrobun/view" resolves to the Hutch devkit; the browser build
// aliases it to a stub (see vite.config.ts).
//
// Both directions use one message, `wire`, carrying the same envelope as the
// WebSocket transport.

import Electrobun, { Electroview } from "electrobun/view";
import type { WireMessage } from "@rsage/shared";
import type { Transport } from "./client";

type BridgeRPC = {
  bun: { requests: {}; messages: { wire: WireMessage } };
  webview: { requests: {}; messages: { wire: WireMessage } };
};

export function installElectrobunBridge() {
  const handlers: ((m: WireMessage) => void)[] = [];
  const rpc = Electroview.defineRPC<BridgeRPC>({
    maxRequestTime: 60_000,
    handlers: {
      requests: {},
      messages: {
        wire: (m: WireMessage) => handlers.forEach((h) => h(m)),
      },
    },
  });
  const view = new Electrobun.Electroview({ rpc });
  (window as any).__rsageElectrobun = (): Transport => ({
    send: (m) => (view.rpc as any).send.wire(m),
    onMessage: (cb) => handlers.push(cb),
  });
}
