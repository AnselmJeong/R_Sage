// Assistant tools for the app's analysis modules. The assistant fills in an
// analysis's options (checked against the module's JSON Schema) instead of
// writing the R code itself; the analysis is saved like one made in the
// GUI and opens in an analysis tab, where the user can adjust it.

import type { AnalysisInstance, AnalysisResult, AssistantItem } from "@rsage/shared";
import type { AnalysisService } from "../analysis/service";
import type { ToolResult, ToolSpec } from "./types";

export const ANALYSIS_TOOL_SPECS: ToolSpec[] = [
  {
    name: "list_analyses",
    description:
      "List the built-in statistical analyses (analysis modules) R Sage can run, each with a one-line summary. Prefer these to hand-written R code when one fits the request: results are checked, reproducible and open in an analysis tab the user can adjust.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "describe_analysis",
    description: "Get the options (JSON Schema with defaults) and usage guide of one analysis from list_analyses. Call before run_analysis.",
    parameters: { type: "object", properties: { analysis: { type: "string", description: "Analysis key from list_analyses" } }, required: ["analysis"] },
  },
  {
    name: "run_analysis",
    description:
      "Run a built-in analysis on a data frame in the user's R session and return its result tables. Options not given take their defaults. The analysis is saved in the project and shown to the user in an analysis tab. If the options are invalid the error names each problem; fix them and call again. To change an analysis you ran before, pass its analysis_id.",
    parameters: {
      type: "object",
      properties: {
        analysis: { type: "string", description: "Analysis key from list_analyses" },
        dataset: { type: "string", description: "Name of a data frame in the R global environment" },
        options: { type: "object", description: "Options as described by describe_analysis" },
        title: { type: "string", description: "Short title for the analysis tab" },
        analysis_id: { type: "string", description: "Re-run an existing analysis with new options instead of creating one" },
      },
      required: ["analysis", "dataset"],
    },
  },
  {
    name: "get_analysis_result",
    description: "Read the latest result of a saved analysis (e.g. after the user changed its options in the analysis tab), with full numbers.",
    parameters: { type: "object", properties: { analysis_id: { type: "string" } }, required: ["analysis_id"] },
  },
];

export const ANALYSIS_TOOL_NAMES = new Set(ANALYSIS_TOOL_SPECS.map((t) => t.name));

const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(+v.toPrecision(6))) : String(v));

/** Result as plain text for the model: every table as tab-separated rows. */
export function formatResult(inst: AnalysisInstance, result: AnalysisResult | undefined, maxRows = 60): string {
  const out = [`analysis_id: ${inst.id} (revision ${inst.revision}, data set ${inst.dataset})`];
  if (inst.lastRun?.status === "error") out.push(`Last run failed: ${inst.lastRun.error?.message}`);
  if (inst.lastRun?.status === "cancelled") out.push("Last run was cancelled.");
  if (!result) return out.concat("No result yet.").join("\n");
  if (inst.resultRevision !== inst.revision) out.push(`(Result is from revision ${inst.resultRevision}; the options have changed since.)`);
  const d = result.dataInfo;
  if (d.rows !== undefined) out.push(`Data: ${d.rows} rows × ${d.columns} columns`);
  for (const t of result.tables) {
    out.push("", `## ${t.title}`, t.columns.map((c) => c.label).join("\t"));
    for (const r of t.rows.slice(0, maxRows)) out.push(t.columns.map((c) => cell(r[c.id])).join("\t"));
    if (t.rows.length > maxRows) out.push(`… ${t.rows.length - maxRows} more rows`);
    for (const n of t.notes) out.push(`Note: ${n}`);
  }
  if (result.plots.length) out.push("", `Plots shown to the user: ${result.plots.map((p) => p.title).join("; ")}`);
  for (const n of result.notes) out.push(`${n.level === "warning" ? "Warning" : "Note"}: ${n.text}`);
  if (result.exports.length) out.push(`Saved in the R session: ${result.exports.join(", ")}`);
  return out.join("\n");
}

export interface AnalysisToolEnv {
  analyses?: AnalysisService;
  openAnalysis?(id: string): void;
  autoRunR(): boolean;
  approve(item: Extract<AssistantItem, { kind: "tool" }>): Promise<boolean>;
  update(patch: Partial<Extract<AssistantItem, { kind: "tool" }>>): void;
  signal: AbortSignal;
}

function plotImages(result: AnalysisResult | undefined, max = 2) {
  return (result?.plots ?? [])
    .filter((p) => p.src.startsWith("data:"))
    .slice(0, max)
    .map((p) => ({ mime: p.src.slice(5, p.src.indexOf(";")), data: p.src.slice(p.src.indexOf(",") + 1) }));
}

export async function runAnalysisTool(
  name: string,
  input: any,
  item: Extract<AssistantItem, { kind: "tool" }>,
  env: AnalysisToolEnv,
): Promise<Omit<ToolResult, "callId" | "name">> {
  const svc = env.analyses;
  if (!svc) return { output: "Analyses are not available.", isError: true };
  try {
    switch (name) {
      case "list_analyses": {
        const defs = svc.defs();
        if (!defs.length) return { output: "No analysis modules are installed." };
        return { output: defs.map((d) => `${d.key}: ${d.title}. ${d.summary}`).join("\n") };
      }
      case "describe_analysis": {
        const { mod, def } = svc.def(String(input?.analysis ?? ""));
        const backends = mod.backends.map((b) => `${b.package} (${b.role})`).join(", ");
        return {
          output: `${def.key}: ${def.title}\nR package: ${mod.rPackage}; backends: ${backends}\n\nOptions schema:\n${JSON.stringify(def.schema, null, 1)}\n\nGuide:\n${def.guide}`,
        };
      }
      case "run_analysis": {
        const { def } = svc.def(String(input?.analysis ?? ""));
        const dataset = String(input?.dataset ?? "");
        if (!dataset) return { output: "dataset is required: the name of a data frame in the R session.", isError: true };
        const options = input?.options ?? {};
        // Check before asking the user anything, so the model can fix its options first.
        const full = svc.checkOptions(def, options);
        // An analysis that leaves an object in the user's session goes through the R approval.
        if (full?.impute?.enabled && full.impute.saveAs && !env.autoRunR()) {
          const ok = await env.approve(item);
          if (!ok) return { output: "The user declined to run this analysis.", isError: true };
        }
        env.update({ status: "running" });
        const existing = input?.analysis_id ? svc.get(String(input.analysis_id)) : null;
        const inst = existing
          ? svc.update({ id: existing.id, dataset, options, title: input?.title })
          : svc.create({ analysis: def.key, dataset, options, title: input?.title, createdBy: "assistant" });
        env.openAnalysis?.(inst.id);
        const onAbort = () => svc.cancel(inst.id);
        env.signal.addEventListener("abort", onAbort);
        try {
          const done = await svc.run(inst.id, "assistant");
          const ok = done.lastRun?.status === "ok";
          return { output: formatResult(done, ok ? done.result : undefined), isError: !ok, images: ok ? plotImages(done.result) : undefined };
        } finally {
          env.signal.removeEventListener("abort", onAbort);
        }
      }
      case "get_analysis_result": {
        const inst = svc.get(String(input?.analysis_id ?? ""));
        if (!inst) return { output: `No analysis ${input?.analysis_id}`, isError: true };
        return { output: formatResult(inst, inst.result, 500) };
      }
    }
  } catch (e: any) {
    return { output: e.message ?? String(e), isError: true };
  }
  return { output: `Unknown tool ${name}`, isError: true };
}
