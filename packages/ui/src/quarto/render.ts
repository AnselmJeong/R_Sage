// Rendering the open .qmd with Quarto and showing the result in the Preview
// panel. Rendering runs in a fresh R process, so the log tells the user when
// a document depends on something that only exists in their console.

import { create } from "zustand";
import { host } from "../host/client";
import { useStore } from "../store";
import { getDockApi, saveFile } from "../editor/files";

export type RenderFormat = "html" | "pdf" | "docx" | "typst";

export const FORMATS: { id: RenderFormat | ""; label: string }[] = [
  { id: "", label: "문서 설정대로" },
  { id: "html", label: "HTML" },
  { id: "pdf", label: "PDF (LaTeX)" },
  { id: "typst", label: "PDF (Typst)" },
  { id: "docx", label: "Word" },
];

interface RenderState {
  renderId?: string;
  file?: string;
  running: boolean;
  log: string;
  output?: string;
  /** http URL showing the output (HTML, PDF). */
  url?: string;
  error?: string;
  /** Bumped on each finished render so the preview reloads. */
  stamp: number;
  quarto?: { path?: string; version?: string };
}

export const useRender = create<RenderState>(() => ({ running: false, log: "", stamp: 0 }));

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  host.on("quarto.log", ({ renderId, text }) => {
    if (useRender.getState().renderId === renderId) useRender.setState((s) => ({ log: (s.log + text).slice(-200_000) }));
  });
  host.on("quarto.done", async ({ renderId, ok, output, error }) => {
    if (useRender.getState().renderId !== renderId) return;
    let url: string | undefined;
    if (ok && output && /\.(html?|pdf)$/i.test(output)) url = await host.call("preview.url", { path: output }).catch(() => undefined);
    useRender.setState((s) => ({ running: false, output, url, error: ok ? undefined : error, stamp: s.stamp + 1 }));
    if (ok) useStore.getState().notify(`렌더링 완료: ${output?.split("/").pop() ?? ""}`);
    else useStore.getState().notify("렌더링에 실패했습니다. 미리보기 패널의 로그를 확인하세요.", "error");
  });
}

/** Opens (or focuses) the Preview as a tab in the editor area, next to the documents. */
export function showPreview() {
  const api = getDockApi();
  if (!api) return;
  let p = api.getPanel("preview");
  if (!p) {
    const inEditorArea = (id: string) =>
      id.startsWith("editor:") || id === "welcome-editor" || id.startsWith("analysis:") || id.startsWith("data:") || id.startsWith("diff:");
    const active = api.activePanel && inEditorArea(api.activePanel.id) ? api.activePanel : undefined;
    const ref = active ?? api.panels.find((x) => inEditorArea(x.id));
    const consolePanel = api.getPanel("console");
    p = api.addPanel({
      id: "preview",
      component: "preview",
      title: "미리보기",
      position: ref
        ? { referencePanel: ref.id, direction: "within" }
        : consolePanel
          ? { referencePanel: consolePanel.id, direction: "above" }
          : undefined,
    });
  }
  p.api.setActive();
}

/** Shows an existing HTML or PDF file in the Preview panel; files outside the project open in the default app. */
export async function previewFile(path: string) {
  wire();
  const url = await host.call("preview.url", { path }).catch(() => undefined);
  if (!url) return void host.call("shell.openExternal", { path }).catch(() => {});
  const st = useRender.getState();
  if (st.running && st.renderId) await host.call("quarto.stop", { renderId: st.renderId }).catch(() => {});
  useRender.setState((s) => ({ running: false, log: "", file: undefined, renderId: undefined, error: undefined, output: path, url, stamp: s.stamp + 1 }));
  showPreview();
}

export async function renderDocument(path: string, to?: RenderFormat | "") {
  wire();
  const st = useRender.getState();
  if (st.running && st.renderId) await host.call("quarto.stop", { renderId: st.renderId }).catch(() => {});
  if (useStore.getState().openFiles[path]?.dirty) await saveFile(path);
  useRender.setState({ running: true, log: "", file: path, error: undefined, output: undefined, url: undefined, renderId: undefined });
  showPreview();
  try {
    const { renderId } = await host.call("quarto.render", { path, to: to || undefined });
    useRender.setState({ renderId });
  } catch (e: any) {
    useRender.setState({ running: false, error: String(e?.message ?? e) });
  }
}

export async function stopRender() {
  const id = useRender.getState().renderId;
  if (id) await host.call("quarto.stop", { renderId: id });
}

export async function loadQuartoInfo() {
  wire();
  const quarto = await host.call("quarto.info").catch(() => ({}));
  useRender.setState({ quarto });
  return quarto;
}
