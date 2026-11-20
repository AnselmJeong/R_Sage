// What the "문서에 넣기" button on an assistant R run puts into a document:
// the run's code as a chunk and the assistant's explanation around it.
// Kept free of editor imports so it can be tested.

import type { AssistantItem } from "@rsage/shared";

export type InsertPiece = { kind: "text"; text: string } | { kind: "code"; code: string };

const isRun = (it: AssistantItem) => it.kind === "tool" && it.name === "run_r";
const isDoneRun = (it: AssistantItem) => isRun(it) && it.kind === "tool" && it.status === "done" && !!it.input?.code;
const textOf = (it: AssistantItem) => (it.kind === "assistant" ? it.text.trim() : "");

/** The items of the answer holding `id`: from after the user's message to the next one. */
export function turnOf(items: AssistantItem[], id: string): AssistantItem[] {
  const at = items.findIndex((it) => it.id === id);
  if (at < 0) return [];
  let a = at;
  while (a > 0 && items[a - 1]!.kind !== "user") a--;
  let b = at;
  while (b < items.length - 1 && items[b + 1]!.kind !== "user") b++;
  return items.slice(a, b + 1);
}

/**
 * The explanation written right before and right after a run, up to the
 * neighbouring successful runs. Text between two runs counts as the earlier
 * run's "after" only, so inserting the runs one by one never repeats it.
 */
export function aroundRun(items: AssistantItem[], id: string): { before: string; after: string } {
  const turn = turnOf(items, id);
  const at = turn.findIndex((it) => it.id === id);
  const first = !turn.slice(0, at).some(isDoneRun);
  const collect = (from: number, step: 1 | -1) => {
    const out: string[] = [];
    for (let i = from; i >= 0 && i < turn.length && !isDoneRun(turn[i]!); i += step) {
      const t = textOf(turn[i]!);
      if (t) out.push(t);
    }
    return (step < 0 ? out.reverse() : out).join("\n\n");
  };
  return { before: first ? collect(at - 1, -1) : "", after: collect(at + 1, 1) };
}

/** The successful runs in the answer holding `id`. */
export function runsInTurn(items: AssistantItem[], id: string): number {
  return turnOf(items, id).filter(isDoneRun).length;
}

/** Pieces for one run, with the explanation before and/or after it. */
export function piecesForRun(items: AssistantItem[], id: string, opts: { before: boolean; after: boolean }): InsertPiece[] {
  const run = items.find((it) => it.id === id);
  if (!run || run.kind !== "tool" || !run.input?.code) return [];
  const { before, after } = aroundRun(items, id);
  const out: InsertPiece[] = [];
  if (opts.before && before) out.push({ kind: "text", text: before });
  out.push({ kind: "code", code: String(run.input.code) });
  if (opts.after && after) out.push({ kind: "text", text: after });
  return out;
}

/** Pieces for the whole answer: its text, and the code of the runs that succeeded (failed tries are left out). */
export function piecesForTurn(items: AssistantItem[], id: string, withText = true): InsertPiece[] {
  const out: InsertPiece[] = [];
  for (const it of turnOf(items, id)) {
    if (isDoneRun(it) && it.kind === "tool") out.push({ kind: "code", code: String(it.input.code) });
    else if (withText && textOf(it)) out.push({ kind: "text", text: textOf(it) });
  }
  return out;
}

/**
 * The text to insert after a line: in a .qmd, paragraphs and ```{r} chunks
 * separated by blank lines; in an R script, the explanation as comments.
 * Starts with a blank line (it is inserted at the end of a line); the line
 * break after that line then ends it.
 */
export function renderPieces(pieces: InsertPiece[], qmd: boolean): string {
  const blocks = pieces.map((p) => {
    if (p.kind === "code") {
      const code = p.code.replace(/^\n+|\s+$/g, "");
      return qmd ? `\`\`\`{r}\n${code}\n\`\`\`` : code;
    }
    return qmd ? p.text : p.text.split("\n").map((l) => (l.trim() ? `# ${l}` : "#")).join("\n");
  });
  return blocks.length ? `\n\n${blocks.join("\n\n")}` : "";
}
