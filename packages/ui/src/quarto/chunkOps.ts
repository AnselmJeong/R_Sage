// Text operations behind the visual editor's chunk tools: reading and writing
// the chunk's `#| key: value` options, renaming a copied chunk's label, and
// splitting or merging chunk code. Pure functions so they can be tested.

const OPT_LINE = /^#\|\s*([\w.-]+)\s*:\s*(.*?)\s*$/;

/** The leading `#|` option lines of a chunk's code, as key → raw value. */
export function readCellOptions(code: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of code.split("\n")) {
    if (!line.startsWith("#|")) break;
    const m = OPT_LINE.exec(line);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

/** Number of leading `#|` lines. */
function optionLineCount(lines: string[]) {
  let n = 0;
  while (n < lines.length && lines[n]!.startsWith("#|")) n++;
  return n;
}

/**
 * Sets or removes `#| key: value` options. A value of undefined or "" removes
 * the option. Existing options keep their place; new ones go after the others.
 */
export function setCellOptions(code: string, updates: Record<string, string | undefined>): string {
  const lines = code === "" ? [] : code.split("\n");
  const n = optionLineCount(lines);
  const head = lines.slice(0, n);
  const body = lines.slice(n);
  const done = new Set<string>();
  const next: string[] = [];
  for (const line of head) {
    const key = OPT_LINE.exec(line)?.[1];
    if (key && key in updates) {
      done.add(key);
      const v = updates[key];
      if (v !== undefined && v !== "") next.push(`#| ${key}: ${v}`);
    } else next.push(line);
  }
  for (const [key, v] of Object.entries(updates)) if (!done.has(key) && v !== undefined && v !== "") next.push(`#| ${key}: ${v}`);
  return [...next, ...body].join("\n");
}

/** The chunk's code without its leading `#|` option lines. */
export function stripCellOptions(code: string): string {
  const lines = code.split("\n");
  return lines.slice(optionLineCount(lines)).join("\n");
}

/** The label from `#| label:` or the knitr header `{r name, ...}`. */
export function cellLabel(header: string, code: string): string | undefined {
  return readCellOptions(code).label ?? /^\{r[ ,]+([^,}=\s]+)\s*(?:[,}])/.exec(header)?.[1];
}

/**
 * Header and code for a copy of a chunk, with its label renamed so the
 * document keeps unique labels (`fig-a` → `fig-a-2`, keeping the prefix
 * Quarto uses for cross references).
 */
export function copyCell(header: string, code: string, taken: Set<string>): { header: string; code: string } {
  const label = cellLabel(header, code);
  if (!label) return { header, code };
  let i = 2;
  while (taken.has(`${label}-${i}`)) i++;
  const fresh = `${label}-${i}`;
  if (readCellOptions(code).label !== undefined) return { header, code: setCellOptions(code, { label: fresh }) };
  return { header: header.replace(/^(\{r[ ,]+)([^,}=\s]+)/, `$1${fresh}`), code };
}

/**
 * Splits chunk code before the given 1-based line. The first part keeps the
 * options; returns null when either part would hold no code.
 */
export function splitCellCode(code: string, line: number): [string, string] | null {
  const lines = code.split("\n");
  const n = optionLineCount(lines);
  if (line <= n + 1 || line > lines.length) return null;
  const a = lines.slice(0, line - 1);
  const b = lines.slice(line - 1);
  while (a.length > n && a[a.length - 1]!.trim() === "") a.pop();
  while (b.length && b[0]!.trim() === "") b.shift();
  if (a.length <= n || !b.length) return null;
  return [a.join("\n"), b.join("\n")];
}

/** Code of two chunks joined into one; the second chunk's options are dropped. */
export function mergeCellCode(a: string, b: string): string {
  const tail = stripCellOptions(b).replace(/^\n+/, "");
  const head = a.replace(/\n+$/, "");
  if (!tail.trim()) return head;
  if (!stripCellOptions(head).trim()) return head ? `${head}\n${tail}` : tail;
  return `${head}\n\n${tail}`;
}
