// What the assistant can do in the project. Every tool is confined to the
// open project folder; file changes and R code go through the user's
// approval (R code can be set to run without asking).

import { existsSync, readFileSync, statSync } from "node:fs";
import type { AssistantItem, RVariable } from "@rsage/shared";
import type { KernelSession } from "@rsage/kernel";
import type { CommManager } from "../comms";
import { writeFileAtomic } from "../config";
import { collectExecution, renderPlot } from "../execute";
import type { Project } from "../project";
import { listFiles, searchText } from "../search";
import type { ToolResult, ToolSpec } from "./types";

const MAX_OUTPUT = 20000;
const MAX_READ = 120000;

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "list_files",
    description:
      "List files in the project (relative paths, .gitignore respected). Use `dir` to list only one folder. Start here to learn what data, scripts and documents exist.",
    parameters: {
      type: "object",
      properties: { dir: { type: "string", description: "Folder relative to the project root; omit for everything" } },
      required: [],
    },
  },
  {
    name: "read_file",
    description:
      "Read a text file from the project (R scripts, .qmd, .csv, .md, ...). Large files are cut; use start_line/end_line to page through them. For data files prefer run_r with readr/str() to understand structure.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the project root" },
        start_line: { type: "integer", description: "First line to return (1-based)" },
        end_line: { type: "integer", description: "Last line to return (inclusive)" },
      },
      required: ["path"],
    },
  },
  {
    name: "search",
    description: "Search text across project files. Returns matching lines as path:line: text.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        regex: { type: "boolean", description: "Treat query as a regular expression" },
        glob: { type: "string", description: "Limit to files matching this glob, e.g. *.qmd" },
      },
      required: ["query"],
    },
  },
  {
    name: "run_r",
    description:
      "Run R code in the user's live R session (the same session as their console; objects persist). Returns printed output, messages, warnings and errors. Plots drawn by the code are returned as images. Use this to load data, check results and verify code before putting it in a file. The user may be asked to approve each run.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "R code to run" },
        purpose: { type: "string", description: "One short line telling the user what this code does" },
      },
      required: ["code"],
    },
  },
  {
    name: "get_variables",
    description: "List the objects in the R global environment with their type, size and a preview.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_plot",
    description: "Get the most recent plot in the Plots pane as an image, to look at it.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "write_file",
    description:
      "Create a file or replace its whole content. The user sees a diff and must approve. Prefer edit_file for changes to an existing file.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description:
      "Replace one exact piece of text in a file. old_string must match the file exactly (including whitespace) and occur once, unless replace_all is true. Include enough surrounding lines to make it unique. In .qmd files keep chunk fences (```{r} ... ```) and chunk options intact. The user sees a diff and must approve.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
];

export interface ToolEnv {
  project?: Project;
  session: KernelSession;
  comms: CommManager;
  ensureSession(): Promise<void>;
  autoRunR(): boolean;
  /** True when changes to this file were already approved (this file or the whole project). */
  autoApply(path: string): boolean;
  /** Show the item for approval; resolves true when approved. */
  approve(item: Extract<AssistantItem, { kind: "tool" }>): Promise<boolean>;
  /** Update the tool item shown to the user. */
  update(patch: Partial<Extract<AssistantItem, { kind: "tool" }>>): void;
  signal: AbortSignal;
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export async function runTool(
  name: string,
  input: any,
  item: Extract<AssistantItem, { kind: "tool" }>,
  env: ToolEnv,
): Promise<Omit<ToolResult, "callId" | "name">> {
  if (input?.__invalid_json !== undefined) return { output: "Tool input was not valid JSON.", isError: true };
  const project = env.project;
  const need = (field: string) => {
    const v = str(input?.[field]);
    if (v === undefined) throw new Error(`Missing string field "${field}"`);
    return v;
  };

  switch (name) {
    case "list_files": {
      if (!project) return noProject();
      const { files, truncated } = await listFiles(project.root);
      const dir = str(input?.dir)?.replace(/^\.?\/?/, "").replace(/\/$/, "");
      const shown = dir ? files.filter((f) => f.startsWith(dir + "/")) : files;
      const lines = shown.slice(0, 800).map((f) => {
        try {
          const size = statSync(project.resolve(f)).size;
          return `${f}  (${fmtSize(size)})`;
        } catch {
          return f;
        }
      });
      return { output: (lines.join("\n") || "(no files)") + (shown.length > 800 || truncated ? `\n… ${shown.length} files in total` : "") };
    }

    case "read_file": {
      if (!project) return noProject();
      const abs = project.resolve(need("path"));
      if (!existsSync(abs)) return { output: `No such file: ${input.path}`, isError: true };
      const buf = readFileSync(abs);
      if (buf.subarray(0, 8000).includes(0)) return { output: `${input.path} is a binary file (${fmtSize(buf.length)}). Use run_r to read it.`, isError: true };
      const all = buf.toString("utf8").split("\n");
      const from = Math.max(1, Number(input.start_line) || 1);
      const to = Math.min(all.length, Number(input.end_line) || all.length);
      let text = all.slice(from - 1, to).join("\n");
      let note = "";
      if (text.length > MAX_READ) {
        text = text.slice(0, MAX_READ);
        note = `\n… cut at ${MAX_READ} characters; the file has ${all.length} lines. Use start_line/end_line for the rest.`;
      } else if (from > 1 || to < all.length) note = `\n(lines ${from}–${to} of ${all.length})`;
      return { output: text + note };
    }

    case "search": {
      if (!project) return noProject();
      const { matches, truncated } = await searchText(project.root, { query: need("query"), regex: !!input.regex, glob: str(input.glob) });
      const lines = matches.slice(0, 200).map((m) => `${project.relative(m.path)}:${m.line}: ${m.text.trim()}`);
      return { output: (lines.join("\n") || "No matches.") + (matches.length > 200 || truncated ? `\n… more matches not shown` : "") };
    }

    case "run_r": {
      const code = need("code");
      if (!env.autoRunR()) {
        const ok = await env.approve(item);
        if (!ok) return { output: "The user declined to run this code.", isError: true };
      }
      env.update({ status: "running" });
      await env.ensureSession();
      return runR(code, env);
    }

    case "get_variables": {
      const comm = env.comms.byTarget("positron.variables");
      if (!comm) return { output: "The R session is not running.", isError: true };
      const r = (await env.comms.rpc(comm.commId, "list")) as { variables: RVariable[] };
      if (!r.variables.length) return { output: "The global environment is empty." };
      return {
        output: r.variables
          .map((v) => `${v.display_name}\t${v.display_type}\t${v.display_value.slice(0, 120)}`)
          .join("\n"),
      };
    }

    case "get_plot": {
      const plots = env.comms.list().filter((c) => c.target === "positron.plot");
      const last = plots[plots.length - 1];
      if (!last) return { output: "There is no plot." };
      const img = await renderPng(env, last.commId);
      return img ? { output: "The most recent plot:", images: [img] } : { output: "Could not render the plot.", isError: true };
    }

    case "write_file":
    case "edit_file": {
      if (!project) return noProject();
      const rel = need("path");
      const abs = project.resolve(rel);
      const isNew = !existsSync(abs);
      const before = isNew ? "" : readFileSync(abs, "utf8");
      let after: string;
      if (name === "write_file") after = need("content");
      else {
        if (isNew) return { output: `No such file: ${rel}. Use write_file to create it.`, isError: true };
        const oldS = need("old_string");
        const newS = str(input.new_string) ?? "";
        const count = oldS ? before.split(oldS).length - 1 : 0;
        if (count === 0) return { output: "old_string was not found in the file. Read the file again and copy the text exactly.", isError: true };
        if (count > 1 && !input.replace_all) return { output: `old_string occurs ${count} times; add surrounding lines to make it unique or set replace_all.`, isError: true };
        after = input.replace_all ? before.split(oldS).join(newS) : before.replace(oldS, () => newS);
      }
      if (after === before) return { output: "No change." };
      env.update({ diff: { path: abs, before, after, isNew } });
      const ok = env.autoApply(abs) || (await env.approve({ ...item, diff: { path: abs, before, after, isNew } }));
      if (!ok) return { output: "The user rejected this change.", isError: true };
      // Re-check the file hasn't changed while the user was looking at the diff.
      const now = existsSync(abs) ? readFileSync(abs, "utf8") : "";
      if (now !== before) return { output: "The file changed on disk before the change was approved; read it again.", isError: true };
      // Written without the project's own-write marker so the editor reloads it.
      writeFileAtomic(abs, after);
      return { output: `${isNew ? "Created" : "Updated"} ${rel}.` };
    }

    default:
      return { output: `Unknown tool ${name}`, isError: true };
  }
}

const noProject = () => ({ output: "No project folder is open.", isError: true });

function fmtSize(n: number) {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}


async function renderPng(env: ToolEnv, commId: string) {
  return renderPlot(env.comms, commId);
}

async function runR(code: string, env: ToolEnv): Promise<Omit<ToolResult, "callId" | "name">> {
  const r = await collectExecution(env.session, env.comms, code, { origin: "ai", signal: env.signal, onStart: (executionId) => env.update({ executionId }) });
  let out = r.text;
  if (out.length > MAX_OUTPUT) out = out.slice(0, MAX_OUTPUT / 2) + `\n… (${out.length - MAX_OUTPUT} characters cut) …\n` + out.slice(-MAX_OUTPUT / 2);
  const summary = out.trim() || (r.images.length ? "" : "(no output)");
  return { output: summary + (r.images.length ? `${summary ? "\n" : ""}${r.images.length} plot(s) drawn.` : ""), images: r.images, isError: r.isError };
}

