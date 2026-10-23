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
