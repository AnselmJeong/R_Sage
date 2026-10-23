// Assistant tools for the app's analysis modules. The assistant fills in an
// analysis's options (checked against the module's JSON Schema) instead of
// writing the R code itself; the analysis is saved like one made in the
// GUI and opens in an analysis tab, where the user can adjust it.

import type { AnalysisDataset, AnalysisInstance, AnalysisResult, AssistantItem } from "@rsage/shared";
import type { AnalysisService } from "../analysis/service";
import { buildGuide } from "../analysis/guide";
import type { ToolResult, ToolSpec } from "./types";

export const ANALYSIS_TOOL_SPECS: ToolSpec[] = [
  {
    name: "list_analyses",
    description:
      "List the built-in statistical analyses (analysis modules) R Sage can run, each with a one-line summary. Prefer these to hand-written R code when one fits the request: results are checked, reproducible and open in an analysis tab the user can adjust.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_datasets",
    description:
      "List the data frames in the user's R session with their size and columns (name and R class). Use it to find the data set for run_analysis. When the user has not said which data to analyse and more than one data frame could fit, ask the user instead of choosing one.",
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
      "Run a built-in analysis on a named data frame in the user's R session and return its result tables. Options not given take their defaults. The analysis is saved in the project and shown to the user in an analysis tab. If the options are invalid the error names each problem; fix them and call again. To change an analysis you ran before, pass its analysis_id.",
    parameters: {
      type: "object",
      properties: {
        analysis: { type: "string", description: "Analysis key from list_analyses" },
        dataset: {
          type: "string",
          description: "Name of the data frame to analyse, from list_datasets. Always name it explicitly; never guess between several candidates, ask the user.",
        },
        options: { type: "object", description: "Options as described by describe_analysis" },
        title: { type: "string", description: "Short title for the analysis tab" },
        analysis_id: { type: "string", description: "Re-run an existing analysis with new options instead of creating one" },
      },
      required: ["analysis", "dataset"],
    },
  },
  {
    name: "set_exploration_hints",
    description:
      "Write hint cards fitted to the user's question onto a 탐색 안내 (org.rsage.explore/explore) analysis tab. Read the result with get_analysis_result first. Pick the signals (rows of the signals table, by ID such as s03) that bear on the question and explain each in plain Korean: what goes together or differs, why it may matter for the question, and how to check it. Rules: every hint cites one or more signal IDs; numbers in a title or text must come from the cited signals (or their variables' profile and target rows), rounded is fine; never write causes/affects/predicts, write 'go together' or 'differ between groups'; no p-values. Suggestions must be installed analyses with valid options (describe_analysis gives the schema); the cards' rule suggestions are a valid start. A hint without suggestions gets the rule cards' suggestions for the signals it cites, so add your own when the question calls for a different analysis. Also offer 3-6 questions worth asking of these data and your guess of what key variables mean (from their names and level names). If the unit of a row or the outcome is unclear, set `ask` with one question for the user. The tool checks all of this and returns the problems if any; fix them and call again. It runs nothing.",
    parameters: {
      type: "object",
      properties: {
        analysis_id: { type: "string", description: "The 탐색 안내 analysis" },
        question: { type: "string", description: "The user's question in their words; empty for a general look" },
        hints: {
          type: "array",
          description: "3-8 cards, most useful first",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "One line, e.g. '수면 시간이 짧을수록 우울 점수가 높은 편입니다'" },
              text: { type: "string", description: "Two or three sentences: why it matters for the question and how to check it" },
              signals: { type: "array", items: { type: "string" }, description: "Signal IDs from the signals table" },
              suggestions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", description: "Button text, e.g. '선형 회귀 열기'" },
                    analysis: { type: "string", description: "Analysis key from list_analyses" },
                    options: { type: "object" },
                    title: { type: "string" },
                  },
                  required: ["label", "analysis", "options"],
                },
              },
            },
            required: ["title", "text", "signals"],
          },
        },
        questions: { type: "array", items: { type: "string" }, description: "3-6 questions worth asking of these data, in Korean" },
        variables: {
          type: "array",
          description: "Guessed meaning of key variables",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              meaning: { type: "string", description: "e.g. '기저 해밀턴 우울 척도 점수'" },
              role: { type: "string", description: "결과, 노출, 공변량, 시점, ID or 기타" },
            },
            required: ["name", "meaning"],
          },
        },
        ask: { type: "string", description: "One question for the user when the data are unclear" },
      },
      required: ["analysis_id", "hints"],
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
  if (result.hints?.length) {
    out.push("", "## Hint cards shown to the user (in this order)");
    result.hints.forEach((h, i) => {
      out.push(`${i + 1}. [${h.id}] ${h.title}${h.evidence ? ` (${h.evidence})` : ""}`, `   ${h.text}`);
      for (const s of h.suggestions) out.push(`   Next: ${s.label} → run_analysis analysis=${s.analysis} options=${JSON.stringify(s.options)}`);
    });
  }
  const g = inst.guide;
  if (g?.hints.length || g?.ask) {
    out.push("", `## Hints you wrote with set_exploration_hints${g.runId !== result.runId ? " (from an earlier run; the signals may have changed)" : ""}`);
    if (g.question) out.push(`Question: ${g.question}`);
    g.hints.forEach((h, i) => out.push(`${i + 1}. ${h.title} [${h.signal}]`));
    if (g.ask) out.push(`Asked the user: ${g.ask}`);
  }
  for (const t of result.tables) {
    out.push("", `## ${t.title}${t.id ? ` (table ${t.id})` : ""}`);
    if (t.description) out.push(`(How to read: ${t.description})`);
    out.push(t.columns.map((c) => c.label).join("\t"));
    for (const r of t.rows.slice(0, maxRows)) out.push(t.columns.map((c) => cell(r[c.id])).join("\t"));
    if (t.rows.length > maxRows) out.push(`… ${t.rows.length - maxRows} more rows`);
    for (const n of t.notes) out.push(`Note: ${n}`);
  }
  if (result.plots.length) {
    out.push("", "Plots shown to the user:");
    for (const p of result.plots) out.push(`- ${p.title}${p.description ? `: ${p.description}` : ""}`);
  }
  for (const n of result.notes) out.push(`${n.level === "warning" ? "Warning" : "Note"}: ${n.text}`);
  if (result.exports.length) out.push(`Saved in the R session: ${result.exports.join(", ")}`);
  return out.join("\n");
}

/** One data frame for the model: size and columns, cut short for wide data. */
function datasetLine(d: AnalysisDataset, maxCols = 40): string {
  const cols = d.columns.slice(0, maxCols).map((c) => `${c.name} <${c.type}>`);
  if (d.columns.length > maxCols) cols.push(`… ${d.columns.length - maxCols} more`);
  return `${d.name}: ${d.rows} rows × ${d.columns.length} columns; ${cols.join(", ")}`;
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
      case "list_datasets": {
        const ds = await svc.datasets();
        if (!ds.length) return { output: "The R session has no data frames. Load the data first." };
        return { output: ds.map((d) => datasetLine(d)).join("\n") };
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
        const available = await svc.datasets();
        if (!available.some((d) => d.name === dataset))
          return {
            output: `No data frame named ${dataset} in the R session. ${available.length ? `Data frames: ${available.map((d) => d.name).join(", ")}.` : "The session has no data frames."}`,
            isError: true,
          };
        // An analysis that leaves an object in the user's session or writes a file goes through the R approval.
        if (leavesOutput(full) && !env.autoRunR()) {
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
      case "set_exploration_hints": {
        const inst = svc.get(String(input?.analysis_id ?? ""));
        if (!inst) return { output: `No analysis ${input?.analysis_id}`, isError: true };
        const guide = buildGuide(inst, input ?? {}, (s) => svc.checkOptions(svc.def(s.analysis).def, s.options));
        svc.setGuide(inst.id, guide);
        env.openAnalysis?.(inst.id);
        const n = guide.hints.length;
        return { output: `Saved ${n} hint card${n === 1 ? "" : "s"}${guide.questions.length ? `, ${guide.questions.length} questions` : ""}${guide.ask ? " and a question for the user" : ""} on the 탐색 안내 tab. The user sees them above the rule cards. Tell the user in one or two sentences what the cards cover; don't repeat them.` };
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

/**
 * Whether options turn on something that outlives the run: an option group
 * with `enabled` and a `saveAs` object name (imputation, cleaned data) or a
 * `file` to write (a report).
 */
export function leavesOutput(options: any): boolean {
  if (!options || typeof options !== "object" || Array.isArray(options)) return false;
  if (options.enabled === true && ((typeof options.saveAs === "string" && options.saveAs) || (typeof options.file === "string" && options.file))) return true;
  return Object.values(options).some(leavesOutput);
}
