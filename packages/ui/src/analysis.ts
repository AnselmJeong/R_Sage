// Analysis modules in the UI: the installed analyses, the project's saved
// analysis instances (kept in sync with the host's analysis.* events) and
// the analysis tabs in the editor area.

import { create } from "zustand";
import type { AnalysisDataset, AnalysisDef, AnalysisInstance, AnalysisModuleInfo, AnalysisRuntimeStatus } from "@rsage/shared";
import { host } from "./host/client";
import { useStore } from "./store";
import { getDockApi, getModel, editorsByPath } from "./editor/files";

interface AnalysisState {
  modules: AnalysisModuleInfo[];
  instances: Record<string, AnalysisInstance>;
  datasets: AnalysisDataset[];
  runtime: Record<string, AnalysisRuntimeStatus | "checking">;
}

export const useAnalyses = create<AnalysisState>(() => ({ modules: [], instances: {}, datasets: [], runtime: {} }));

export function analysisDefs(): AnalysisDef[] {
  return useAnalyses.getState().modules.flatMap((m) => m.analyses);
}

export function findDef(key: string): { mod: AnalysisModuleInfo; def: AnalysisDef } | undefined {
  for (const mod of useAnalyses.getState().modules) {
    const def = mod.analyses.find((a) => a.key === key);
    if (def) return { mod, def };
  }
}

const notifyError = (e: any) => useStore.getState().notify(e?.message ?? String(e), "error");

export async function loadModules() {
  try {
    useAnalyses.setState({ modules: await host.call("analysis.modules") });
  } catch (e) {
    console.warn("[analysis] modules", e);
  }
}

export async function refreshInstances() {
  const list = useStore.getState().project ? await host.call("analysis.list").catch(() => []) : [];
  useAnalyses.setState({ instances: Object.fromEntries(list.map((i) => [i.id, i])) });
}

export async function refreshDatasets() {
  try {
    useAnalyses.setState({ datasets: await host.call("analysis.datasets") });
  } catch {}
}

/** Checks the module's R packages (installing the app's own ones). */
export async function prepareModule(moduleId: string) {
  useAnalyses.setState((s) => ({ runtime: { ...s.runtime, [moduleId]: "checking" } }));
  try {
    const st = await host.call("analysis.prepare", { moduleId });
    useAnalyses.setState((s) => ({ runtime: { ...s.runtime, [moduleId]: st } }));
    return st;
  } catch (e: any) {
    const st = { ready: false, missing: [], missingOptional: [], error: e?.message ?? String(e) };
    useAnalyses.setState((s) => ({ runtime: { ...s.runtime, [moduleId]: st } }));
    return st;
  }
}

/** Opens (or focuses) the tab of an analysis. */
export function openAnalysisTab(id: string) {
  const api = getDockApi();
  if (!api) return;
  const panelId = `analysis:${id}`;
  const existing = api.getPanel(panelId);
  if (existing) return existing.api.setActive();
  const inst = useAnalyses.getState().instances[id];
  const ref = api.panels.find((p) => p.id.startsWith("editor:") || p.id === "welcome-editor" || p.id.startsWith("analysis:") || p.id.startsWith("data:"));
  api.addPanel({
    id: panelId,
    component: "analysis",
    title: `분석: ${inst?.title ?? ""}`,
    params: { id },
    position: ref ? { referencePanel: ref.id, direction: "within" } : undefined,
  });
}

/** New analysis of the given kind, on the data set the user most likely means. */
export async function newAnalysis(key: string) {
  if (!useStore.getState().project) return useStore.getState().notify("분석은 프로젝트 폴더를 연 뒤에 저장됩니다. 먼저 폴더를 여세요.", "error");
  try {
    await refreshDatasets();
    const ds = useAnalyses.getState().datasets;
    const inst = await host.call("analysis.create", { analysis: key, dataset: ds.length === 1 ? ds[0]!.name : "" });
    useAnalyses.setState((s) => ({ instances: { ...s.instances, [inst.id]: inst } }));
    openAnalysisTab(inst.id);
  } catch (e) {
    notifyError(e);
  }
}

export async function deleteAnalysis(id: string) {
  await host.call("analysis.delete", { id }).catch(notifyError);
  getDockApi()?.getPanel(`analysis:${id}`)?.api.close();
}

/** Puts R code into the open document: a chunk in a .qmd, plain lines in an R script. */
export function insertIntoDocument(code: string, label?: string): boolean {
  const path = useStore.getState().activeFile;
  const model = path ? getModel(path) : null;
  if (!path || !model) {
    useStore.getState().notify("코드를 넣을 .qmd나 R 파일을 먼저 여세요.", "error");
    return false;
  }
  const qmd = /\.(qmd|rmd|md)$/i.test(path);
  const text = qmd ? `\n\`\`\`{r}\n${label ? `#| label: ${label}\n` : ""}${code}\n\`\`\`\n` : `\n${code}\n`;
  const ed = editorsByPath.get(path);
  const sel = ed?.getSelection();
  const end = model.getFullModelRange().getEndPosition();
  // In a document, after the line the cursor is on; otherwise at the end.
  const line = sel ? sel.endLineNumber : end.lineNumber;
  const col = sel ? model.getLineMaxColumn(line) : end.column;
  model.pushEditOperations([], [{ range: { startLineNumber: line, startColumn: col, endLineNumber: line, endColumn: col }, text }], () => null);
  useStore.getState().notify(`${path.split("/").pop()}에 코드를 넣었습니다.`);
  return true;
}

let started = false;
export function startAnalysisSync() {
  if (started) return;
  started = true;
  void loadModules();
  void refreshInstances();
  host.on("analysis.changed", (inst) => {
    useAnalyses.setState((s) => ({ instances: { ...s.instances, [inst.id]: inst } }));
    getDockApi()?.getPanel(`analysis:${inst.id}`)?.api.setTitle(`분석: ${inst.title}`);
  });
  host.on("analysis.deleted", ({ id }) =>
    useAnalyses.setState((s) => {
      const { [id]: _, ...rest } = s.instances;
      return { instances: rest };
    }),
  );
  host.on("analysis.open", ({ id }) => openAnalysisTab(id));
  host.on("project.changed", () => void refreshInstances());
  // A new session may run another R, or one with packages installed since: check again.
  let generation = -1;
  host.on("session.state", (s) => {
    if (s.generation !== generation) {
      generation = s.generation;
      useAnalyses.setState({ runtime: {} });
    }
  });
}
