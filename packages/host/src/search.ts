// Project-wide text search and replace. Uses ripgrep when installed,
// otherwise a plain recursive scan.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SearchMatch } from "@rsage/shared";
import { writeFileAtomic } from "./config";

const MAX_MATCHES = 2000;
const SKIP = new Set([".git", ".rsage", "node_modules", ".Rproj.user", "renv", ".quarto"]);
const TEXT_EXT = /\.(r|rmd|qmd|md|txt|csv|tsv|json|ya?ml|bib|tex|html|css|js|ts|py|sql|sh|toml|lua|csl)$/i;

export interface SearchOptions {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  /** Comma-separated globs to include, e.g. "*.R, *.qmd". */
  glob?: string;
  /** Comma-separated globs to leave out. */
  exclude?: string;
}

const globs = (s?: string) => (s ?? "").split(",").map((g) => g.trim()).filter(Boolean);

function globRegex(g: string): RegExp {
  const body = g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\0").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\0/g, ".*");
  // A pattern without a slash matches the file name anywhere, as in ripgrep.
  return new RegExp(g.includes("/") ? `^${body}$` : `(^|/)${body}$`, "i");
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildRegex(o: SearchOptions): RegExp {
  const src = o.regex ? o.query : escapeRegex(o.query);
  // \b only knows ASCII word characters, so use Unicode-aware lookarounds.
  const body = o.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])` : src;
  return new RegExp(body, o.caseSensitive ? "gu" : "giu");
}

export async function searchText(root: string, o: SearchOptions): Promise<{ matches: SearchMatch[]; truncated: boolean }> {
  if (!o.query) return { matches: [], truncated: false };
  const rg = Bun.which("rg");
  if (rg) {
    const args = [rg, "--json", "--max-columns", "400", "--glob", "!.rsage", "--glob", "!.git"];
    if (!o.regex) args.push("--fixed-strings");
    if (!o.caseSensitive) args.push("--ignore-case");
    if (o.wholeWord) args.push("--word-regexp");
    for (const g of globs(o.glob)) args.push("--glob", g);
    for (const g of globs(o.exclude)) args.push("--glob", `!${g}`);
    args.push("--", o.query, root);
    const p = Bun.spawn(args, { stdout: "pipe", stderr: "ignore" });
    const text = await new Response(p.stdout).text();
    const matches: SearchMatch[] = [];
    for (const row of text.split("\n")) {
      if (!row.startsWith('{"type":"match"')) continue;
      const d = JSON.parse(row).data;
      const line: string = d.lines.text?.replace(/\n$/, "") ?? "";
      // ripgrep reports byte offsets; editors want UTF-16 columns.
      const bytes = Buffer.from(line);
      for (const sm of d.submatches) {
        matches.push({
          path: d.path.text,
          line: d.line_number,
          column: bytes.subarray(0, sm.start).toString().length + 1,
          length: bytes.subarray(sm.start, sm.end).toString().length,
          text: line,
        });
        if (matches.length >= MAX_MATCHES) return { matches, truncated: true };
      }
    }
    return { matches, truncated: false };
  }

  const re = buildRegex(o);
  const include = globs(o.glob).map(globRegex);
  const exclude = globs(o.exclude).map(globRegex);
  const matches: SearchMatch[] = [];
  const walk = (dir: string): boolean => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(d.name)) continue;
      const p = join(dir, d.name);
      if (d.isDirectory()) {
        if (walk(p)) return true;
        continue;
      }
      if (!TEXT_EXT.test(d.name) || statSync(p).size > 5_000_000) continue;
      const rel = p.slice(root.length + 1);
      if (include.length && !include.some((r) => r.test(rel))) continue;
      if (exclude.some((r) => r.test(rel))) continue;
      const lines = readFileSync(p, "utf8").split("\n");
      lines.forEach((text, i) => {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) && matches.length < MAX_MATCHES) {
          matches.push({ path: p, line: i + 1, column: m.index + 1, length: m[0].length, text });
          if (!m[0]) re.lastIndex++;
        }
      });
      if (matches.length >= MAX_MATCHES) return true;
    }
    return false;
  };
  const truncated = walk(root);
  return { matches, truncated };
}

export function replaceInFiles(paths: string[], o: SearchOptions & { replacement: string }) {
  const re = buildRegex(o);
  let files = 0;
  let replacements = 0;
  for (const p of paths) {
    const before = readFileSync(p, "utf8");
    const n = before.match(re)?.length ?? 0;
    // Regex mode honours $1-style groups; literal mode inserts the text as is.
    const after = o.regex ? before.replace(re, o.replacement) : before.replace(re, () => o.replacement);
    if (n) {
      writeFileAtomic(p, after);
      files++;
      replacements += n;
    }
  }
  return { files, replacements };
}

const MAX_FILES = 20000;

/** All project files as relative paths (ripgrep respects .gitignore). */
export async function listFiles(root: string): Promise<{ files: string[]; truncated: boolean }> {
  const rg = Bun.which("rg");
  if (rg) {
    const p = Bun.spawn([rg, "--files", "--hidden", "--glob", "!.git", "--glob", "!.rsage"], { cwd: root, stdout: "pipe", stderr: "ignore" });
    const files = (await new Response(p.stdout).text()).split("\n").filter(Boolean).sort();
    return { files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES };
  }
  const files: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(d.name) || files.length >= MAX_FILES) continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(join(dir, d.name), r);
      else files.push(r);
    }
  };
  walk(root, "");
  return { files: files.sort(), truncated: files.length >= MAX_FILES };
}
