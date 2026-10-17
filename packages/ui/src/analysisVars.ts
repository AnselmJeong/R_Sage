// Pure helpers for analysis data: which data frame a piece of R code uses,
// and the type groups of data frame columns.

import type { AnalysisVarType } from "@rsage/shared";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The name used last in the code (comments and strings aside), if any. */
export function lastUsed(code: string, names: string[]): string | null {
  const clean = code
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""')
    .replace(/#.*$/gm, "");
  let best: string | null = null;
  let bestAt = -1;
  for (const n of names) {
    // A whole R name: not part of a longer name, and not a column (x$name, x@name).
    const re = new RegExp(`(?<![A-Za-z0-9._$@])${escape(n)}(?![A-Za-z0-9._])`, "g");
    let m: RegExpExecArray | null;
    let at = -1;
    while ((m = re.exec(clean))) at = m.index;
    if (at > bestAt) {
      bestAt = at;
      best = n;
    }
  }
  return best;
}

export type VarKind = "numeric" | "factor" | "ordered" | "character" | "logical" | "date" | "other";

export function varKind(rClass: string): VarKind {
  if (["numeric", "integer", "double"].includes(rClass)) return "numeric";
  if (rClass === "ordered") return "ordered";
  if (rClass === "factor") return "factor";
  if (rClass === "character") return "character";
  if (rClass === "logical") return "logical";
  if (["Date", "POSIXct", "POSIXlt", "difftime", "hms"].includes(rClass)) return "date";
  return "other";
}

export const KIND_LABEL: Record<VarKind, string> = {
  numeric: "수치",
  factor: "범주",
  ordered: "순서 범주",
  character: "문자",
  logical: "논리",
  date: "날짜·시각",
  other: "기타",
};

/** Whether a role box that takes `types` accepts a column of this R class. */
export function accepts(types: AnalysisVarType[] | undefined, rClass: string): boolean {
  if (!types?.length) return true;
  const k = varKind(rClass);
  return types.some((t) => t === k || (t === "factor" && k === "ordered"));
}
