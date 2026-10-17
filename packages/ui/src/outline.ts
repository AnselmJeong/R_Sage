// Document outlines for the Outline view: headings and code cells of a .qmd,
// sections (`# Name ----`) and functions of an R script.

import { parseQmd, type PMNode } from "./quarto/qmd";

export interface OutlineItem {
  kind: "meta" | "heading" | "cell" | "section" | "function";
  label: string;
  /** A hint shown after the label (a cell's label or first line). */
  detail?: string;
  /** Heading level; cells and functions sit under the heading before them. */
  level: number;
  /** 1-based line in the source text. */
  line: number;
  /** Index of the top-level block in the visual editor, for .qmd files. */
  block?: number;
  children: OutlineItem[];
}

const textOf = (n: PMNode): string =>
  n.type === "text" ? (n.text ?? "") : n.type === "inlineMath" ? `$${n.attrs?.tex ?? ""}$` : (n.content ?? []).map(textOf).join("");

/** Drops Pandoc attributes such as {#sec-intro .unnumbered}. */
const headingLabel = (s: string) => s.replace(/\s*\{[^}]*\}\s*$/, "").trim() || "(제목 없음)";

function cellDetail(code: string, header = ""): string | undefined {
  const label = /#\|\s*label:\s*(.+)/.exec(code)?.[1] ?? /^\{\s*\w+[\s,]+([^\s,=}]+)\s*[,}]/.exec(header)?.[1];
  if (label) return label.trim();
  const first = code.split("\n").find((l) => l.trim() && !/^\s*#/.test(l));
  return first?.trim().slice(0, 60);
}

/** Nests a flat list: headings by level, everything else under the heading before it. */
function nest(flat: OutlineItem[]): OutlineItem[] {
  const roots: OutlineItem[] = [];
  const stack: OutlineItem[] = [];
  for (const it of flat) {
    const isHead = it.kind === "heading" || it.kind === "section";
    if (isHead) while (stack.length && stack[stack.length - 1]!.level >= it.level) stack.pop();
    (stack.length ? stack[stack.length - 1]!.children : roots).push(it);
    if (isHead) stack.push(it);
  }
  return roots;
}

/** Headings written inside a raw block (a ::: div, for example), skipping code fences. */
function headingsIn(text: string): { level: number; label: string; offset: number }[] {
  const out: { level: number; label: string; offset: number }[] = [];
  let fence: string | null = null;
  text.split("\n").forEach((line, i) => {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && line.trim().startsWith(fence)) fence = null;
      return;
    }
    if (f) {
      fence = f[1]!;
      return;
    }
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) out.push({ level: h[1]!.length, label: headingLabel(h[2]!), offset: i });
  });
  return out;
}

export function qmdOutline(text: string): OutlineItem[] {
  const blocks = parseQmd(text).doc.content ?? [];
  const flat: OutlineItem[] = [];
  let line = 1;
  blocks.forEach((b, i) => {
    const before = (b.attrs?.before as string | undefined) ?? "";
    const src = (b.attrs?.src as string | undefined) ?? "";
    line += before.split("\n").length - 1;
    const at = line;
    line += src.split("\n").length - 1;
    const base = { line: at, block: i, children: [] as OutlineItem[] };
    if (b.type === "frontMatter") {
      const title = /^title:\s*["']?(.+?)["']?\s*$/m.exec(b.attrs?.yaml ?? "")?.[1];
      flat.push({ ...base, kind: "meta", label: "문서 정보", detail: title, level: 99 });
    } else if (b.type === "heading") {
      flat.push({ ...base, kind: "heading", label: headingLabel(textOf(b)), level: b.attrs?.level ?? 1 });
    } else if (b.type === "rCell") {
      flat.push({ ...base, kind: "cell", label: "코드 셀", detail: cellDetail(b.attrs?.code ?? "", b.attrs?.header), level: 99 });
    } else if (b.type === "rawBlock") {
      const raw: string = b.attrs?.text ?? src;
      const chunk = /^(`{3,}|~{3,})\s*\{(\w+)/.exec(raw);
      if (chunk) {
        const code = raw.split("\n").slice(1, -1).join("\n");
        flat.push({ ...base, kind: "cell", label: `코드 셀 (${chunk[2]})`, detail: cellDetail(code), level: 99 });
      } else
        for (const h of headingsIn(raw))
          flat.push({ ...base, line: at + h.offset, kind: "heading", label: h.label, level: h.level });
    }
  });
  return nest(flat);
}

export function rOutline(text: string): OutlineItem[] {
  const flat: OutlineItem[] = [];
  text.split("\n").forEach((l, i) => {
    // RStudio-style sections: "# Title ----", "## Title ====", "# Title ####"
    const s = /^\s*(#+)\s*(.*?)\s*(?:-{4,}|={4,}|#{4,})\s*$/.exec(l);
    if (s && s[2]) {
      flat.push({ kind: "section", label: s[2], level: s[1]!.length, line: i + 1, children: [] });
      return;
    }
    const f = /^\s*([A-Za-z.][\w.]*|`[^`]+`)\s*(?:<<?-|=)\s*function\s*\(/.exec(l);
    if (f) flat.push({ kind: "function", label: f[1]!, level: 99, line: i + 1, children: [] });
  });
  return nest(flat);
}

export function outlineFor(path: string, text: string): OutlineItem[] | null {
  if (/\.(qmd|rmd|md)$/i.test(path)) return qmdOutline(text);
  if (/\.r$/i.test(path)) return rOutline(text);
  return null;
}

/** The top-level block of a .qmd that holds a 1-based source line. */
export function blockAtLine(text: string, line: number): number | undefined {
  const blocks = parseQmd(text).doc.content ?? [];
  let at = 1;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    at += ((b.attrs?.before as string | undefined) ?? "").split("\n").length - 1;
    const end = at + ((b.attrs?.src as string | undefined) ?? "").split("\n").length - 1;
    if (line <= end) return i;
    at = end;
  }
  return blocks.length ? blocks.length - 1 : undefined;
}
