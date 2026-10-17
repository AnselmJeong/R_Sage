// Moves WireMessages between a Host and one UI connection.

import type { WireMessage } from "@rsage/shared";
import type { Host } from "./host";

/** Attach a UI connection. `send` delivers a message to the UI; returns the inbound handler and a detach function. */
export function connectUi(host: Host, send: (msg: WireMessage) => void) {
  const unsubscribe = host.subscribe((type, payload) => send({ t: "evt", type, payload }));
  const onMessage = async (msg: WireMessage) => {
    if (msg.t !== "req") return;
    try {
      const result = await host.dispatch(msg.method, msg.params);
      send({ t: "res", id: msg.id, result });
    } catch (err) {
      send({ t: "res", id: msg.id, error: err instanceof Error ? err.message : String(err) });
    }
  };
  return { onMessage, detach: unsubscribe };
}
