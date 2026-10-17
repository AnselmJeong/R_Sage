// .qmd <-> visual editor document (ProseMirror JSON, Tiptap node names).
//
// The source text is the truth. Each top-level block keeps the exact text it
// came from (`src`) and how it serialized when loaded (`ser0`); a block whose
// serialization is unchanged is written back as its original text, so
// switching to the visual editor and back never rewrites what the user did
// not touch. Anything the editor does not model (fenced divs, raw HTML,
// footnotes, non-R chunks, ...) becomes a raw block that keeps its source.

import type { Root, RootContent, PhrasingContent, List, Table, Code } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export interface PMMark {
  type: string;
  attrs?: Record<string, any>;
}
export interface PMNode {
  type: string;
  attrs?: Record<string, any>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
}

/** Attributes every top-level block carries for the round trip. */
export const ROUNDTRIP_ATTRS = ["src", "ser0", "before"] as const;

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

class Unsupported extends Error {}

export interface ParsedQmd {
  doc: PMNode;
  /** Whitespace after the last block. */
  trailing: string;
}

/** Text → document. Never throws: what it cannot model becomes raw blocks. */
export function parseQmd(text: string): ParsedQmd {
  const blocks: PMNode[] = [];
  let pos = 0;
  const fm = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?=\r?\n|$)/.exec(text);
  if (fm) {
    blocks.push(top({ type: "frontMatter", attrs: { yaml: fm[1] } }, fm[0], ""));
    pos = fm[0].length;
  }
  // Fenced divs (::: {.callout-note} ... :::) span several blocks: keep them whole.
  for (const region of splitDivs(text, pos)) {
    if (region.kind === "div") {
      const lead = /^\s*/.exec(region.text)![0];
      blocks.push(top({ type: "rawBlock", attrs: { text: region.text.slice(lead.length).replace(/\s+$/, "") } }, region.text.slice(lead.length).replace(/\s+$/, ""), lead));
      // Whitespace after the div belongs to the next block's gap.
      const tail = region.text.slice(lead.length + blocks[blocks.length - 1]!.attrs!.src.length);
      pendingGap = tail;
    } else parseMarkdown(region.text, region.start, text, blocks);
  }
  // The gap carried past the last block is trailing text.
  const trailing = pendingGap;
  pendingGap = "";
  return { doc: { type: "doc", content: blocks.length ? blocks : [{ type: "paragraph" }] }, trailing };
}

// Whitespace left over between regions, prepended to the next block's `before`.
let pendingGap = "";

function top(node: PMNode, src: string, before: string): PMNode {
  const gap = pendingGap + before;
  pendingGap = "";
  return { ...node, attrs: { ...(node.attrs ?? {}), src, before: gap } };
}

function splitDivs(text: string, from: number): { kind: "md" | "div"; text: string; start: number }[] {
  const out: { kind: "md" | "div"; text: string; start: number }[] = [];
  const lines = text.slice(from).split(/(?<=\n)/);
  let offset = from;
  let mdStart = from;
  let fence: string | null = null;
  let depth = 0;
  let divStart = 0;
  for (const line of lines) {
    const bare = line.replace(/\r?\n$/, "");
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(bare);
    if (depth === 0 && fence) {
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length && bare.trim() === f[1]) fence = null;
    } else if (depth === 0 && f) fence = f[1]!;
    else if (/^:{3,}\s*\S/.test(bare) && !/^:{3,}\s*$/.test(bare)) {
      if (depth === 0) {
        if (offset > mdStart) out.push({ kind: "md", text: text.slice(mdStart, offset), start: mdStart });
        divStart = offset;
      }
      depth++;
    } else if (depth > 0 && /^:{3,}\s*$/.test(bare)) {
      depth--;
      if (depth === 0) {
        out.push({ kind: "div", text: text.slice(divStart, offset + line.length), start: divStart });
        mdStart = offset + line.length;
      }
    }
    offset += line.length;
  }
  if (depth > 0) out.push({ kind: "div", text: text.slice(divStart), start: divStart });
  else if (offset > mdStart) out.push({ kind: "md", text: text.slice(mdStart, offset), start: mdStart });
  return out;
}

function parseMarkdown(md: string, base: number, full: string, blocks: PMNode[]) {
  const tree = parser.parse(md) as Root;
  let last = 0;
  for (const child of tree.children) {
    const s = child.position!.start.offset!;
    const e = child.position!.end.offset!;
    const src = md.slice(s, e);
    const before = md.slice(last, s);
    last = e;
    let node: PMNode;
    try {
      node = block(child, src);
    } catch (err) {
      if (!(err instanceof Unsupported)) console.warn("qmd: raw block", err);
      node = { type: "rawBlock", attrs: { text: src } };
    }
    blocks.push(top(node, src, before));
  }
  pendingGap += md.slice(last);
  void base;
  void full;
}

function block(n: RootContent, src: string): PMNode {
  switch (n.type) {
    case "paragraph":
      return para(n.children);
    case "heading":
      return { type: "heading", attrs: { level: n.depth }, content: inline(n.children) };
    case "thematicBreak":
      return { type: "horizontalRule" };
    case "blockquote":
      return { type: "blockquote", content: n.children.map((c) => block(c, "")) };
    case "list":
      return list(n);
    case "code":
      return code(n, src);
    case "math":
      return { type: "mathBlock", attrs: { tex: n.value } };
    case "table":
      return table(n);
    default:
      throw new Unsupported(n.type);
  }
}

function para(children: PhrasingContent[]): PMNode {
  const content = inline(children);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

function list(n: List): PMNode {
  if (n.children.some((i) => i.checked !== null && i.checked !== undefined)) throw new Unsupported("task list");
  const items = n.children.map((item) => {
    const content = item.children.map((c) => block(c, ""));
    if (!content.length) content.push({ type: "paragraph" });
    if (content[0]!.type !== "paragraph") throw new Unsupported("list item without a paragraph");
    return { type: "listItem", content };
  });
  return n.ordered
    ? { type: "orderedList", attrs: { start: n.start ?? 1, tight: !n.spread }, content: items }
    : { type: "bulletList", attrs: { tight: !n.spread }, content: items };
}

function code(n: Code, src: string): PMNode {
  const info = [n.lang, n.meta].filter(Boolean).join(" ");
  const fenced = /^\s*(`{3,}|~{3,})/.exec(src);
  if (!fenced) return { type: "codeBlock", attrs: { language: null }, content: n.value ? [{ type: "text", text: n.value }] : undefined };
  if (info.startsWith("{")) {
    if (/^\{r[\s,}]/i.test(info)) return { type: "rCell", attrs: { header: info, code: n.value, fence: fenced[1] } };
    throw new Unsupported("non-R chunk");
  }
  return { type: "codeBlock", attrs: { language: info || null }, content: n.value ? [{ type: "text", text: n.value }] : undefined };
}

function table(n: Table): PMNode {
  const rows = n.children.map((row, r) => ({
    type: "tableRow",
    content: row.children.map((cell) => ({ type: r === 0 ? "tableHeader" : "tableCell", content: [para(cell.children)] })),
  }));
  return { type: "table", attrs: { align: JSON.stringify(n.align ?? []) }, content: rows };
}

function inline(children: PhrasingContent[], marks: PMMark[] = []): PMNode[] {
  const out: PMNode[] = [];
  const add = (node: PMNode) => {
    if (node.type === "text" && !node.text) return;
    out.push(marks.length ? { ...node, marks: [...marks, ...(node.marks ?? [])] } : node);
  };
  for (const c of children) {
    switch (c.type) {
      case "text":
        add({ type: "text", text: c.value });
        break;
      case "emphasis":
        out.push(...inline(c.children, [...marks, { type: "italic" }]));
        break;
      case "strong":
        out.push(...inline(c.children, [...marks, { type: "bold" }]));
        break;
      case "delete":
        out.push(...inline(c.children, [...marks, { type: "strike" }]));
        break;
      case "inlineCode":
        add({ type: "text", text: c.value, marks: [{ type: "code" }] });
        break;
      case "link":
        out.push(...inline(c.children, [...marks, { type: "link", attrs: { href: c.url, title: c.title ?? null } }]));
        break;
      case "image":
        add({ type: "image", attrs: { src: c.url, alt: c.alt ?? "", title: c.title ?? null } });
        break;
      case "break":
        add({ type: "hardBreak" });
        break;
      case "inlineMath":
        add({ type: "inlineMath", attrs: { tex: c.value } });
        break;
      default:
        throw new Unsupported(c.type);
    }
  }
  return out;
}

// ---------------------------------------------------------------- writing

/** Records how each top-level block serializes now, so unchanged blocks keep their source. */
export function withBaselines(doc: PMNode): PMNode {
  return { ...doc, content: (doc.content ?? []).map((n) => ({ ...n, attrs: { ...(n.attrs ?? {}), ser0: serializeBlock(n) } })) };
}

/** Document → text. */
export function toQmd(doc: PMNode, trailing = "\n"): string {
  let out = "";
  let first = true;
  for (const n of doc.content ?? []) {
    const ser = serializeBlock(n);
    const a = n.attrs ?? {};
    const same = typeof a.src === "string" && a.ser0 === ser;
    const text = same ? a.src : ser;
    if (!text && !same) continue; // an empty new paragraph
    let gap: string;
    if (first) gap = same || typeof a.before === "string" ? (a.before ?? "") : "";
    else gap = typeof a.before === "string" && /\n[ \t]*\n/.test(a.before) ? a.before : "\n\n";
    out += gap + text;
    first = false;
  }
  return out + (out ? trailing : "");
}

export function serializeBlock(n: PMNode, indent = ""): string {
  switch (n.type) {
    case "frontMatter":
      return `---\n${n.attrs?.yaml ?? ""}\n---`;
    case "paragraph":
      return prefixLines(serializeInline(n.content ?? []), indent);
    case "heading":
      return "#".repeat(n.attrs?.level ?? 1) + " " + serializeInline(n.content ?? []);
    case "horizontalRule":
      return "---";
    case "blockquote":
      return (n.content ?? [])
        .map((c) => serializeBlock(c))
        .join("\n\n")
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n");
    case "bulletList":
    case "orderedList": {
      const tight = n.attrs?.tight !== false;
      const start = n.attrs?.start ?? 1;
      return (n.content ?? [])
        .map((item, i) => {
          const marker = n.type === "orderedList" ? `${start + i}. ` : "- ";
          const pad = " ".repeat(marker.length);
          const body = (item.content ?? []).map((c) => serializeBlock(c)).join(tight ? "\n" : "\n\n");
          return marker + body.split("\n").map((l, j) => (j === 0 || !l ? l : pad + l)).join("\n");
        })
        .join(tight ? "\n" : "\n\n");
    }
    case "codeBlock": {
      const code = textOf(n);
      const fence = fenceFor(code, "```");
      return `${fence}${n.attrs?.language ?? ""}\n${code}\n${fence}`;
    }
    case "rCell": {
      const code = n.attrs?.code ?? "";
      const fence = fenceFor(code, n.attrs?.fence || "```");
      return `${fence}${n.attrs?.header || "{r}"}\n${code}\n${fence}`;
    }
    case "mathBlock":
      return `$$\n${n.attrs?.tex ?? ""}\n$$`;
    case "rawBlock":
      return n.attrs?.text ?? "";
    case "table":
      return serializeTable(n);
    default:
      return serializeInline(n.content ?? []);
  }
}

function prefixLines(s: string, indent: string) {
  return indent ? s.split("\n").map((l) => indent + l).join("\n") : s;
}

function textOf(n: PMNode): string {
  return (n.content ?? []).map((c) => c.text ?? "").join("");
}

function fenceFor(code: string, wanted: string) {
  const ch = wanted[0] === "~" ? "~" : "`";
  let longest = 0;
  for (const m of code.matchAll(ch === "`" ? /`{3,}/g : /~{3,}/g)) longest = Math.max(longest, m[0].length);
  return ch.repeat(Math.max(wanted.length, longest + 1, 3));
}

function serializeTable(n: PMNode): string {
  let align: (string | null)[] = [];
  try {
    align = JSON.parse(n.attrs?.align ?? "[]");
  } catch {}
  const rows = (n.content ?? []).map((row) => (row.content ?? []).map((cell) => (cell.content ?? []).map((p) => serializeInline(p.content ?? [])).join(" ").replace(/\|/g, "\\|").replace(/\n/g, " ")));
  if (!rows.length) return "";
  const cols = Math.max(...rows.map((r) => r.length));
  const line = (cells: string[]) => "| " + Array.from({ length: cols }, (_, i) => cells[i] ?? "").join(" | ") + " |";
  const sep = "|" + Array.from({ length: cols }, (_, i) => {
    const a = align[i];
    return a === "center" ? ":---:" : a === "right" ? "---:" : a === "left" ? ":---" : "---";
  }).join("|") + "|";
  return [line(rows[0]!), sep, ...rows.slice(1).map(line)].join("\n");
}

const MARK_ORDER = ["link", "bold", "italic", "strike"];
const OPEN: Record<string, string> = { bold: "**", italic: "*", strike: "~~" };

export function serializeInline(nodes: PMNode[]): string {
  let out = "";
  let open: PMMark[] = [];
  const closeTo = (keep: number) => {
    while (open.length > keep) {
      const m = open.pop()!;
      out += m.type === "link" ? `](${m.attrs?.href ?? ""}${m.attrs?.title ? ` "${m.attrs.title}"` : ""})` : OPEN[m.type] ?? "";
    }
  };
  nodes.forEach((n, idx) => {
    const marks = (n.marks ?? []).filter((m) => MARK_ORDER.includes(m.type)).sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
    let keep = 0;
    while (keep < open.length && keep < marks.length && sameMark(open[keep]!, marks[keep]!)) keep++;
    let text = "";
    if (n.type === "text") {
      const isCode = n.marks?.some((m) => m.type === "code");
      text = isCode ? codeSpan(n.text ?? "") : escapeText(n.text ?? "", idx === 0 && !out);
    } else if (n.type === "hardBreak") text = "\\\n";
    else if (n.type === "image") text = `![${n.attrs?.alt ?? ""}](${n.attrs?.src ?? ""}${n.attrs?.title ? ` "${n.attrs.title}"` : ""})`;
    else if (n.type === "inlineMath") text = `$${n.attrs?.tex ?? ""}$`;
    // Spaces cannot sit just inside emphasis markers; move them outside.
    const lead = keep < marks.length ? /^\s*/.exec(text)![0] : "";
    if (keep < open.length) {
      const trail = /\s*$/.exec(out)![0];
      if (trail && open.slice(keep).some((m) => m.type !== "link")) out = out.slice(0, out.length - trail.length);
      closeTo(keep);
      out += trail;
    }
    out += lead;
    text = text.slice(lead.length);
    for (const m of marks.slice(keep)) {
      out += m.type === "link" ? "[" : OPEN[m.type] ?? "";
      open.push(m);
    }
    out += text;
  });
  const trail = /\s*$/.exec(out)![0];
  if (open.length && trail) out = out.slice(0, out.length - trail.length);
  closeTo(0);
  return out + (open.length ? "" : trail && !out.endsWith(trail) ? trail : "");
}

function sameMark(a: PMMark, b: PMMark) {
  return a.type === b.type && (a.type !== "link" || (a.attrs?.href === b.attrs?.href && (a.attrs?.title ?? null) === (b.attrs?.title ?? null)));
}

function codeSpan(s: string) {
  let longest = 0;
  for (const m of s.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  const ticks = "`".repeat(longest + 1);
  const pad = s.startsWith("`") || s.endsWith("`") ? " " : "";
  return ticks + pad + s + pad + ticks;
}

/** Escapes what would otherwise turn into markup; leaves Quarto's [@cite] and {#id} alone. */
function escapeText(s: string, lineStart: boolean): string {
  let t = s.replace(/\\/g, "\\\\").replace(/([*`$])/g, "\\$1").replace(/~~/g, "\\~\\~");
  // _ only matters at word boundaries (pandoc treats intraword _ as text).
  t = t.replace(/(^|[^\p{L}\p{N}])_|_(?=$|[^\p{L}\p{N}])/gu, (m) => m.replace("_", "\\_"));
  t = t.replace(/\n/g, " ");
  if (lineStart) t = t.replace(/^(#{1,6}\s|>|[-+]\s|\d+[.)]\s)/, "\\$1");
  return t;
}
