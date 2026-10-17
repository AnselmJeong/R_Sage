// R source for analysis requests and for the code a user copies into a
// Quarto chunk: JSON options written as R literals.

const SYNTACTIC = /^((([A-Za-z]|[.][A-Za-z._])[A-Za-z0-9._]*)|[.])$/;
const RESERVED = new Set(["if", "else", "repeat", "while", "function", "for", "next", "break", "TRUE", "FALSE", "NULL", "Inf", "NaN", "NA", "in"]);

export function rString(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
}

/** A name usable as an R symbol, backquoted when it is not syntactic. */
export function rName(s: string): string {
  return SYNTACTIC.test(s) && !RESERVED.has(s) ? s : "`" + s.replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "`";
}

function scalar(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isInteger(v) ? `${v}L` : String(v);
  return rString(String(v));
}

/** JSON value → R expression. Arrays of one scalar type become c(); objects become list(). */
export function toR(v: unknown, indent = ""): string {
  if (Array.isArray(v)) {
    if (!v.length) return "character()";
    const kinds = new Set(v.map((x) => typeof x));
    if (kinds.size === 1 && !v.some((x) => x === null || typeof x === "object")) return `c(${v.map(scalar).join(", ")})`;
    return `list(${v.map((x) => toR(x, indent)).join(", ")})`;
  }
  if (v && typeof v === "object") {
    const entries = Object.entries(v);
    if (!entries.length) return "list()";
    const inner = indent + "  ";
    return `list(\n${entries.map(([k, x]) => `${inner}${rName(k)} = ${toR(x, inner)}`).join(",\n")}\n${indent})`;
  }
  return scalar(v);
}

/**
 * Code that reproduces an analysis with the module's own function. Figure
 * sizes the user chose travel with it (rsage::rs_resize), so the console,
 * Quarto and the analysis tab draw the same figures.
 */
export function analysisCode(
  pkg: string,
  entrypoint: string,
  dataset: string,
  options: unknown,
  figures?: Record<string, { width: number; height: number }>,
  varName = "res",
): string {
  const call = `${pkg}::${entrypoint}(\n  ${rName(dataset)},\n  ${toR(options, "  ")}\n)`;
  const sizes = Object.entries(figures ?? {});
  if (!sizes.length) return `${varName} <- ${call}\n${varName}`;
  const list = `list(${sizes.map(([id, f]) => `${rName(id)} = c(${f.width}, ${f.height})`).join(", ")})`;
  return `${varName} <- ${call}\n# Figure sizes in inches (width, height)\n${varName} <- rsage::rs_resize(${varName}, ${list})\n${varName}`;
}
