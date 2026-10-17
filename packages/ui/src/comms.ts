// UI side of the Positron comms: variables, plots, help, data viewers.
// The host forwards comm.open / comm.event / comm.close; requests go back
// through comm.rpc. Shapes follow Ark's generated comm types.

import { create } from "zustand";
import type { CommInfo, RVariable } from "@rsage/shared";
import { host } from "./host/client";
import { useStore } from "./store";

export interface PlotEntry {
  commId: string;
  executionId?: string;
  createdAt: string;
  /** data: URL of the latest render (or Ark's pre-render). */
  image?: string;
  /** Size the image was rendered at, in CSS pixels. */
  size?: { width: number; height: number };
  /** Pixel ratio of the latest render. */
  pixelRatio?: number;
  /** Bumped when R redraws the plot (e.g. lines() after plot()). */
  version: number;
  /** The version the current image shows. */
  renderedVersion?: number;
}

export interface DataViewerEntry {
  commId: string;
  title: string;
  executionId?: string;
  /** Bumped on schema_update / data_update so the grid refetches. */
  version: number;
}

interface CommState {
  uiComm?: string;
  variablesComm?: string;
  helpComm?: string;
  variables: RVariable[];
  variablesVersion: number;
  plots: PlotEntry[];
  currentPlot?: string;
  helpHistory: string[];
  helpIndex: number;
  dataViewers: Record<string, DataViewerEntry>;
  busy: boolean;
}

export const useComms = create<CommState>(() => ({
  variables: [],
  variablesVersion: 0,
  plots: [],
  helpHistory: [],
  helpIndex: -1,
  dataViewers: {},
  busy: false,
}));

/** Panels that want to appear when something arrives (wired by Workbench). */
export const commHooks: {
  showPlots?: () => void;
  showHelp?: () => void;
  openDataViewer?: (v: DataViewerEntry) => void;
  closeDataViewer?: (commId: string) => void;
} = {};

export const rpc = <T = any>(commId: string, method: string, params?: unknown) =>
  host.call("comm.rpc", { commId, method, params }) as Promise<T>;

function upsertPlot(commId: string, patch: Partial<PlotEntry>) {
  useComms.setState((s) => ({
    plots: s.plots.map((p) => (p.commId === commId ? { ...p, ...patch } : p)),
  }));
}

function onOpen(c: CommInfo) {
  switch (c.target) {
    case "positron.ui":
      useComms.setState({ uiComm: c.commId });
      break;
    case "positron.variables":
      useComms.setState({ variablesComm: c.commId });
      // After a window reload the initial refresh event is long gone.
      void rpc<{ variables: RVariable[]; version: number }>(c.commId, "list")
        .then((r) => useComms.setState({ variables: r.variables, variablesVersion: r.version }))
        .catch(() => {});
      break;
    case "positron.help":
      useComms.setState({ helpComm: c.commId });
      break;
    case "positron.plot": {
      const pre = c.data?.pre_render;
      const plot: PlotEntry = {
        commId: c.commId,
        executionId: c.executionId,
        createdAt: c.openedAt,
        image: pre?.data ? `data:${pre.mime_type ?? "image/png"};base64,${pre.data}` : undefined,
        size: pre?.settings?.size,
        pixelRatio: pre?.settings?.pixel_ratio,
        version: 0,
        renderedVersion: pre?.data ? 0 : undefined,
      };
      useComms.setState((s) => ({ plots: [...s.plots.filter((p) => p.commId !== c.commId), plot], currentPlot: c.commId }));
      commHooks.showPlots?.();
      break;
    }
    case "positron.dataExplorer": {
      const v: DataViewerEntry = { commId: c.commId, title: c.data?.title ?? "데이터", executionId: c.executionId, version: 0 };
      useComms.setState((s) => ({ dataViewers: { ...s.dataViewers, [c.commId]: v } }));
      commHooks.openDataViewer?.(v);
      break;
    }
  }
}

function onEvent(e: { commId: string; target: string; method: string; params: any }) {
  const s = useComms.getState();
  switch (e.target) {
    case "positron.ui":
      if (e.method === "busy") useComms.setState({ busy: !!e.params.busy });
      else if (e.method === "show_url") showHelpUrl(e.params.url);
      else if (e.method === "show_html_file") showHelpUrl(e.params.path);
      else if (e.method === "show_message") useStore.getState().notify(String(e.params.message ?? ""));
      else if (e.method === "open_editor") {
        void import("./editor/files").then((f) =>
          f.openFile(e.params.file, e.params.line > 0 ? { line: e.params.line, column: e.params.column || 1 } : undefined),
        );
      }
      break;
    case "positron.variables":
      if (e.method === "refresh") {
        useComms.setState({ variables: e.params.variables ?? [], variablesVersion: e.params.version ?? 0 });
      } else if (e.method === "update") {
        const removed = new Set<string>(e.params.removed ?? []);
        const assigned: RVariable[] = e.params.assigned ?? [];
        const byKey = new Map(s.variables.filter((v) => !removed.has(v.access_key)).map((v) => [v.access_key, v]));
        for (const v of assigned) byKey.set(v.access_key, v);
        const variables = [...byKey.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
        useComms.setState({ variables, variablesVersion: e.params.version ?? s.variablesVersion + 1 });
      }
      break;
    case "positron.help":
      if (e.method === "show_help" && e.params.kind === "url") showHelpUrl(e.params.content, e.params.focus !== false);
      break;
    case "positron.plot":
      if (e.method === "update") {
        const p = s.plots.find((x) => x.commId === e.commId);
        upsertPlot(e.commId, { version: (p?.version ?? 0) + 1 });
        useComms.setState({ currentPlot: e.commId });
      } else if (e.method === "show") {
        useComms.setState({ currentPlot: e.commId });
        commHooks.showPlots?.();
      }
      break;
    case "positron.dataExplorer":
      if (e.method === "schema_update" || e.method === "data_update") {
        const v = s.dataViewers[e.commId];
        if (v) useComms.setState({ dataViewers: { ...s.dataViewers, [e.commId]: { ...v, version: v.version + 1 } } });
      }
      break;
  }
}

function onClose(c: { commId: string; target: string }) {
  if (c.target === "positron.plot") {
    // Keep the last image so the history survives the session; it just can't re-render.
    closedPlots.add(c.commId);
  } else if (c.target === "positron.dataExplorer") {
    commHooks.closeDataViewer?.(c.commId);
    useComms.setState((s) => {
      const dataViewers = { ...s.dataViewers };
      delete dataViewers[c.commId];
      return { dataViewers };
    });
  } else if (c.target === "positron.variables") {
    useComms.setState({ variablesComm: undefined, variables: [] });
  } else if (c.target === "positron.ui") {
    useComms.setState({ uiComm: undefined, busy: false });
  } else if (c.target === "positron.help") {
    useComms.setState({ helpComm: undefined });
  }
}

/** Plots whose comm is gone (session restarted): image only, no re-render. */
export const closedPlots = new Set<string>();

export function showHelpUrl(url: string, focus = true) {
  if (!url) return;
  useComms.setState((s) => {
    const hist = s.helpHistory.slice(0, s.helpIndex + 1);
    if (hist[hist.length - 1] !== url) hist.push(url);
    return { helpHistory: hist.slice(-100), helpIndex: Math.min(hist.length, 100) - 1 };
  });
  if (focus) commHooks.showHelp?.();
}

export async function renderPlot(commId: string, size: { width: number; height: number }, format: "png" | "svg" | "pdf" | "jpeg" | "tiff" = "png", pixelRatio = window.devicePixelRatio || 1) {
  const r = await rpc<{ data: string; mime_type: string }>(commId, "render", {
    size: { width: Math.max(50, Math.round(size.width)), height: Math.max(50, Math.round(size.height)) },
    pixel_ratio: pixelRatio,
    format,
  });
  return r;
}

export function initComms() {
  host.on("comm.open", onOpen);
  host.on("comm.event", onEvent);
  host.on("comm.close", onClose);
  host.on("frontend.request", async (r) => {
    if (!r.id) return; // informational: the host already answered
    const { confirmDialog, promptDialog } = await import("./components/Dialogs");
    let result: unknown = null;
    if (r.method === "show_question") {
      result = await confirmDialog({
        title: r.params.title ?? "R",
        message: stripHtml(r.params.message ?? ""),
        confirm: r.params.ok_button_title || "확인",
        cancel: r.params.cancel_button_title || "취소",
      });
    } else if (r.method === "show_prompt") {
      result = await promptDialog({ title: r.params.title ?? "R", message: r.params.message, value: r.params.default ?? "" });
    } else if (r.method === "show_dialog") {
      await confirmDialog({ title: r.params.title ?? "R", message: stripHtml(r.params.message ?? ""), confirm: "확인", cancel: "닫기" });
    }
    await host.call("frontend.reply", { id: r.id, result });
  });
  // Pick up comms opened before this window connected (browser reload).
  void host.call("comm.list").then((list) => list.forEach(onOpen));
}

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, "");
