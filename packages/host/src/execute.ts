// Runs R code in the live session and gathers what it printed and drew:
// used by the assistant's run_r tool and by Quarto chunks run from the editor.

import type { ExecutionRecord, OutputEvent, SourceRef } from "@rsage/shared";
import type { KernelSession } from "@rsage/kernel";
import type { CommManager } from "./comms";

export interface Collected {
  executionId: string;
  status: ExecutionRecord["status"];
  /** Printed output, messages and the error with its traceback. */
  text: string;
  isError: boolean;
  /** The plots the code drew (last few), as base64 images. */
  images: { mime: string; data: string }[];
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

export async function renderPlot(comms: CommManager, commId: string, size = { width: 800, height: 560 }) {
  try {
    const r = (await comms.rpc(commId, "render", { size, pixel_ratio: 1, format: "png" })) as { data: string; mime_type: string };
    return { mime: r.mime_type || "image/png", data: r.data };
  } catch {
    return undefined;
  }
}

export async function collectExecution(
  session: KernelSession,
  comms: CommManager,
  code: string,
  opts: { origin: ExecutionRecord["origin"]; source?: SourceRef; signal?: AbortSignal; onStart?: (executionId: string) => void; maxPlots?: number },
): Promise<Collected> {
  const rec = session.execute(code, { origin: opts.origin, source: opts.source });
  opts.onStart?.(rec.id);
  let text = "";
  let isError = false;
  const plots = new Set<string>();
  const onOutput = (o: OutputEvent) => {
    if (!("executionId" in o) || o.executionId !== rec.id) return;
    if (o.kind === "stream") text += o.text;
    else if (o.kind === "result" || o.kind === "display") {
      const t = o.data["text/plain"];
      if (typeof t === "string") text += t + "\n";
    } else if (o.kind === "error") {
      isError = true;
      text += `Error: ${stripAnsi(o.evalue)}\n${o.traceback.map(stripAnsi).join("\n")}\n`;
    }
  };
  const onOpen = (c: { target: string; commId: string; executionId?: string }) => {
    if (c.target === "positron.plot" && c.executionId === rec.id) plots.add(c.commId);
  };
  const onEvent = (e: { target: string; method: string; commId: string }) => {
    if (e.target === "positron.plot" && e.method === "update" && session.runningExecution()?.id === rec.id) plots.add(e.commId);
  };
  const onAbort = () => void session.interrupt();
  session.on("output", onOutput);
  comms.on("open", onOpen);
  comms.on("event", onEvent);
  opts.signal?.addEventListener("abort", onAbort);
  let status: ExecutionRecord["status"];
  try {
    status = await new Promise((resolve) => {
      const f = (o: OutputEvent) => {
        if (o.kind === "done" && o.executionId === rec.id) {
          session.off("output", f);
          resolve(o.status);
        }
      };
      session.on("output", f);
    });
  } finally {
    session.off("output", onOutput);
    comms.off("open", onOpen);
    comms.off("event", onEvent);
    opts.signal?.removeEventListener("abort", onAbort);
  }
  if (status === "aborted") {
    isError = true;
    text += "\n(interrupted)";
  }
  const images: Collected["images"] = [];
  for (const id of [...plots].slice(-(opts.maxPlots ?? 4))) {
    const img = await renderPlot(comms, id);
    if (img) images.push(img);
  }
  return { executionId: rec.id, status, text, isError: isError || status === "error", images };
}
