// R code the data viewer runs in the console for changes to the data itself
// (type conversion, factor levels). The code is visible and lands in the
// history, so the analysis stays reproducible; Ark then refreshes the view.

const SYNTACTIC = /^((([A-Za-z]|[.][A-Za-z._])[A-Za-z0-9._]*)|[.])$/;
const RESERVED = new Set([
  "if", "else", "repeat", "while", "function", "for", "next", "break", "TRUE", "FALSE", "NULL",
  "Inf", "NaN", "NA", "NA_integer_", "NA_real_", "NA_character_", "NA_complex_", "in",
]);

export const isSyntactic = (name: string) => SYNTACTIC.test(name) && !RESERVED.has(name);

/** A name usable in code, backquoted when needed. */
export const rName = (name: string) => (isSyntactic(name) ? name : "`" + name.replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "`");

/** A JS string as an R string literal. */
export const rString = (s: string) => JSON.stringify(s);

/** Data viewers opened as View(df) carry the binding's name as their title. */
export const canModify = (object: string) => isSyntactic(object);

export const columnRef = (object: string, column: string) => `${rName(object)}$${rName(column)}`;

export type ConvertTarget = "numeric" | "integer" | "character" | "logical" | "factor" | "Date" | "POSIXct";

export const CONVERT_TARGETS: { target: ConvertTarget; label: string }[] = [
  { target: "numeric", label: "숫자 (numeric)" },
  { target: "integer", label: "정수 (integer)" },
  { target: "character", label: "문자 (character)" },
  { target: "logical", label: "논리 (logical)" },
  { target: "factor", label: "범주 (factor)" },
  { target: "Date", label: "날짜 (Date)" },
  { target: "POSIXct", label: "날짜시간 (POSIXct)" },
];

/** `type_name` comes from Ark's schema, e.g. "factor", "character", "double". */
export function convertCode(object: string, column: string, target: ConvertTarget, typeName = ""): string {
  const ref = columnRef(object, column);
  const isFactor = /factor|ordered|^<?(fct|ord)/.test(typeName);
  // A factor's codes are not its values: go through the labels.
  const src = isFactor && target !== "factor" && target !== "character" ? `as.character(${ref})` : ref;
  const expr =
    target === "numeric" ? `as.numeric(${src})`
    : target === "integer" ? `as.integer(${src})`
    : target === "character" ? `as.character(${src})`
    : target === "logical" ? `as.logical(${src})`
    : target === "factor" ? `factor(${src})`
    : target === "Date" ? `as.Date(${src})`
    : `as.POSIXct(${src})`;
  return `${ref} <- ${expr}`;
}

export interface FactorLevel {
  value: string;
  label: string;
}

/** factor() with explicit levels (and labels where they differ from the values). */
export function factorCode(object: string, column: string, levels: FactorLevel[], opts: { numeric: boolean; ordered: boolean }): string {
  const ref = columnRef(object, column);
  const lit = (v: string) => (opts.numeric && /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(v) ? v : v === "TRUE" || v === "FALSE" ? (opts.numeric ? v : rString(v)) : rString(v));
  const values = `c(${levels.map((l) => lit(l.value)).join(", ")})`;
  const relabel = levels.some((l) => l.label !== l.value);
  const labels = relabel ? `, labels = c(${levels.map((l) => rString(l.label || l.value)).join(", ")})` : "";
  const ordered = opts.ordered ? ", ordered = TRUE" : "";
  return `${ref} <- factor(${ref}, levels = ${values}${labels}${ordered})`;
}

export function renameCode(object: string, column: string, to: string): string {
  return `names(${rName(object)})[names(${rName(object)}) == ${rString(column)}] <- ${rString(to)}`;
}
