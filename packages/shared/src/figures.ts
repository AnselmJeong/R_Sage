// Converting a figure to tidyplots: the types the host and the UI share, and
// how a conversion is written back into the .qmd chunk that drew the figure.

export type FigureColors = "auto" | "friendly" | "okabeito" | "seaside" | "ibm" | "apple" | "metro" | "candy" | "viridis";
export type FigureTheme = "tidyplot" | "minimal_xy" | "minimal_y" | "minimal_x" | "ggplot2";

export interface FigureOptions {
  colors?: FigureColors;
  theme?: FigureTheme;
  /** "fill": the figure fills the chunk's size; "fixed": tidyplots' own 50 mm panels. */
  size?: "fill" | "fixed";
}

export interface FigureCheck {
  check: string;
  before: string;
  after: string;
  ok: boolean;
}

export interface FigureConversion {
  /** What drew the original: ggplot, tidyplot (already converted), base, lattice, none, error. */
  kind: string;
  /**
   * rule: every part converted and checked · partial: some parts kept as ggplot
   * code or dropped (see notes) · mismatch: converted, but the check found
   * differences · ai: needs the assistant · unsupported · already · none · error ·
   * missing: R packages to install first (see missing).
   */
  status: "rule" | "partial" | "mismatch" | "ai" | "unsupported" | "already" | "none" | "error" | "missing";
  code?: string | null;
  /** Lines of the original code (1-based, inclusive) the conversion replaces. */
  target?: { first_line: number; last_line: number; assign?: string | null } | null;
  notes: string[];
  /** ggplot terms kept with tidyplots::add(). */
  kept: string[];
  checks?: FigureCheck[] | null;
  message?: string | null;
  missing?: string[];
  /** Execution that drew the converted figure in the Plots pane. */
  previewExecutionId?: string;
}

export interface FigureEdit {
  /** New text of the whole file. */
  text: string;
  /** 1-based first line the conversion starts on in the new text. */
  line: number;
  /** True when library(tidyplots) was added. */
  addedLibrary: boolean;
}

/**
 * Writes a conversion back into a .qmd: finds the R chunk that holds the
 * code that drew the figure (the whole chunk or the part that was run),
 * replaces the target lines with the new code and, unless the
 * document already loads it, adds library(tidyplots) to the setup chunk (the
 * chunk labelled setup, else the first R chunk). Returns null when the code
 * is no longer in the file.
 */
export function applyFigureConversion(text: string, ranCode: string, target: { first_line: number; last_line: number }, newCode: string): FigureEdit | null {
  const lines = text.split("\n");
  const ran = ranCode.replace(/\n+$/, "").split("\n");
  const chunks = rChunkRanges(lines);
  // Where the run code starts in the file: a chunk whose code holds it line for line.
  let at = -1;
  for (const c of chunks) {
    const body = lines.slice(c.start, c.end);
    for (let i = 0; i + ran.length <= body.length; i++) {
      if (ran.every((l, k) => body[i + k] === l)) {
        at = c.start + i;
        break;
      }
    }
    if (at >= 0) break;
  }
  if (at < 0) return null;

  const from = at + target.first_line - 1;
  const to = at + target.last_line; // exclusive
  const indent = /^\s*/.exec(lines[from] ?? "")![0];
  const replacement = newCode.split("\n").map((l) => (l ? indent + l : l));
  lines.splice(from, to - from, ...replacement);
  let line = from + 1;

  const loads = /\blibrary\(\s*["']?tidyplots["']?\s*\)|\brequire\(\s*["']?tidyplots/.test(text);
  if (!loads) {
    const after = rChunkRanges(lines);
    const setup = after.find((c) => lines.slice(c.start, c.end).some((l) => /^\s*#\|\s*label:\s*setup\s*$/.test(l))) ?? after.find((c) => /setup/.test(lines[c.start - 1] ?? "")) ?? after[0];
    if (setup) {
      let i = setup.start;
      while (i < setup.end && /^\s*#\|/.test(lines[i]!)) i++;
      // After the chunk's other library() calls, so tidyplots loads last.
      let j = i;
      for (let k = i; k < setup.end; k++) if (/^\s*library\(/.test(lines[k]!)) j = k + 1;
      lines.splice(j, 0, "library(tidyplots)");
      if (j < line) line++;
    }
  }
  return { text: lines.join("\n"), line, addedLibrary: !loads };
}

/** R chunks as [start, end) line ranges of their code (0-based). */
function rChunkRanges(lines: string[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s*(`{3,}|~{3,})\s*\{[rR](?:[\s,}])/.exec(lines[i]!);
    if (!open) continue;
    const fence = open[1]!;
    let j = i + 1;
    while (j < lines.length && !new RegExp(`^\\s*${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`).test(lines[j]!)) j++;
    out.push({ start: i + 1, end: j });
    i = j;
  }
  return out;
}
