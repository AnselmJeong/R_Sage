// Where inserted text goes in a .qmd, kept free of editor imports so it can be tested.

/** The 1-based line to insert after so that text lands outside the YAML header and code chunks. */
export function insertLineAfter(lines: string[], line: number): number {
  let open = 0; // line where the block around `line` starts, 0 when none
  let close = "";
  for (let i = 1; i <= lines.length; i++) {
    const t = lines[i - 1]!;
    if (!open) {
      if (i > line) break;
      if (i === 1 && /^---\s*$/.test(t)) [open, close] = [1, "yaml"];
      else if (/^\s*(`{3,}|~{3,})\s*\{/.test(t)) [open, close] = [i, t.trim().match(/^(`{3,}|~{3,})/)![1]!];
    } else if (close === "yaml" ? /^(---|\.\.\.)\s*$/.test(t) : t.trim().startsWith(close) && t.trim().replace(/[`~]/g, "") === "") {
      if (i >= line) return i;
      open = 0;
    }
  }
  return line;
}

/** `base`, or `base-2`, `base-3`… when a chunk in the document already has that label (Quarto refuses duplicates). */
export function uniqueLabel(doc: string, base: string): string {
  const used = new Set([...doc.matchAll(/^\s*#\|\s*label:\s*(\S+)/gm)].map((m) => m[1]!));
  for (const m of doc.matchAll(/^\s*```+\s*\{r[ ,]+([A-Za-z][\w.-]*)/gm)) used.add(m[1]!);
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/** Whether the document creates a data frame of this name (an assignment or a read in a chunk). */
export function definesData(doc: string, name: string): boolean {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w.])${n}\\s*(<<?-|=(?!=))|(->>?)\\s*${n}(?![\\w.])|assign\\(\\s*["']${n}["']`, "m").test(doc);
}
