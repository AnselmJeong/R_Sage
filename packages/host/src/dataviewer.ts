// Helpers for the data viewer that need R itself, beyond Ark's dataExplorer
// comm: the distinct values of a column (or its factor levels, in level
// order), which the comm's frequency tables sort by count instead.

/** A JS string as an R string literal (JSON escapes are valid in R). */
export const rString = (s: string) => JSON.stringify(s);

export function columnValuesCode(object: string, column: string, limit: number): string {
  return [
    "local({",
    `  .x <- get(${rString(object)}, envir = globalenv())[[${rString(column)}]]`,
    "  .f <- is.factor(.x)",
    "  .v <- if (.f) levels(.x) else sort(unique(.x[!is.na(.x)]))",
    "  .n <- length(.v)",
    `  .v <- head(.v, ${Math.max(1, Math.floor(limit))})`,
    '  cat(.f, is.ordered(.x), is.numeric(.x) || is.logical(.x), .n, sep = "\\t"); cat("\\n")',
    '  if (length(.v)) cat(encodeString(as.character(.v), quote = "\\""), sep = "\\n")',
    "})",
  ].join("\n");
}

export function parseColumnValues(out: string) {
  const lines = out.replace(/\r/g, "").split("\n");
  const [f, o, num, n] = (lines.shift() ?? "").split("\t");
  const values = lines.filter((l) => l.startsWith('"')).map((l) => {
    try {
      return JSON.parse(l) as string;
    } catch {
      return l.slice(1, -1);
    }
  });
  return { factor: f === "TRUE", ordered: o === "TRUE", numeric: num === "TRUE", total: Number(n) || values.length, values };
}
