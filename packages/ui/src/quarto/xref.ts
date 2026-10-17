// Cross-reference targets in a .qmd: labelled figures, tables, sections,
// equations and the like, which Quarto refers to as @fig-x, @tbl-x, ...

export interface XrefTarget {
  id: string;
  kind: string;
  /** What the target is about: its caption, heading or code line. */
  context: string;
  line: number;
}

export const XREF_KINDS: Record<string, string> = {
  fig: "그림",
  tbl: "표",
  sec: "절",
  eq: "수식",
  lst: "코드",
  thm: "정리",
  lem: "보조정리",
  cor: "따름정리",
  prp: "명제",
  def: "정의",
  exm: "예",
  exr: "연습",
};

const PREFIX = Object.keys(XREF_KINDS).join("|");

export function xrefTargets(text: string): XrefTarget[] {
  const lines = text.split("\n");
  const out: XrefTarget[] = [];
  const seen = new Set<string>();
  const add = (id: string, context: string, line: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, kind: id.split("-")[0]!, context: context.trim().slice(0, 80), line });
  };
  lines.forEach((l, i) => {
    // Chunk option: #| label: fig-mpg, with the caption from #| fig-cap / tbl-cap nearby.
    const opt = new RegExp(`^#\\|\\s*label:\\s*["']?((?:${PREFIX})-[\\w-]+)`).exec(l);
    if (opt) {
      let cap = "";
      for (let j = i - 5; j <= i + 8 && j < lines.length; j++) {
        const c = j >= 0 && /^#\|\s*(?:fig|tbl|lst)-cap:\s*["']?(.*?)["']?\s*$/.exec(lines[j]!);
        if (c) {
          cap = c[1]!;
          break;
        }
      }
      add(opt[1]!, cap || "코드 청크", i + 1);
      return;
    }
    // Attributes: ## Heading {#sec-x}, ![cap](a.png){#fig-x}, $$ ... $$ {#eq-x}, ::: {#fig-x}
    for (const m of l.matchAll(new RegExp(`\\{[^}]*#((?:${PREFIX})-[\\w-]+)[^}]*\\}`, "g"))) {
      const before = l.slice(0, m.index).trim();
      const ctx =
        /^#{1,6}\s+(.*)$/.exec(before)?.[1] ??
        /!\[([^\]]*)\]/.exec(before)?.[1] ??
        (before.startsWith("$$") || before.endsWith("$$") ? before.replace(/\$\$/g, "") : before.startsWith(":::") ? "블록" : before);
      add(m[1]!, ctx || (lines[i - 1] ?? ""), i + 1);
    }
  });
  return out;
}
