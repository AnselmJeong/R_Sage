// Finding R chunks in Quarto/R Markdown source, for code intelligence.

/** R chunks of a .qmd/.Rmd: the 0-based line of their first code line and their code. */
export function qmdRChunks(text: string): { start: number; code: string }[] {
  const lines = text.split("\n");
  const out: { start: number; code: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s*(`{3,}|~{3,})\s*\{[rR](?:[\s,}])/.exec(lines[i]!);
    if (!open) continue;
    const fence = open[1]!;
    let j = i + 1;
    while (j < lines.length && !new RegExp(`^\\s*${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`).test(lines[j]!)) j++;
    out.push({ start: i + 1, code: lines.slice(i + 1, j).join("\n") });
    i = j;
  }
  return out;
}
