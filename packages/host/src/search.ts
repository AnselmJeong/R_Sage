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
  glob?: string;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildRegex(o: SearchOptions): RegExp {
  return new RegExp(o.regex ? o.query : escapeRegex(o.query), o.caseSensitive ? "g" : "gi");
}

export async function searchText(root: string, o: SearchOptions): Promise<{ matches: SearchMatch[]; truncated: boolean }> {
  if (!o.query) return { matches: [], truncated: false };
  const rg = Bun.which("rg");
  if (rg) {
    const args = [rg, "--json", "--max-columns", "400", "--glob", "!.rsage", "--glob", "!.git"];
    if (!o.regex) args.push("--fixed-strings");
    if (!o.caseSensitive) args.push("--ignore-case");
    if (o.glob) args.push("--glob", o.glob);
    args.push("--", o.query, root);
    const p = Bun.spawn(args, { stdout: "pipe", stderr: "ignore" });
    const text = await new Response(p.stdout).text();
    const matches: SearchMatch[] = [];
    for (const line of text.split("\n")) {
      if (!line.startsWith('{"type":"match"')) continue;
      const d = JSON.parse(line).data;
      for (const sm of d.submatches) {
        matches.push({
          path: d.path.text,
          line: d.line_number,
          column: sm.start + 1,
          text: d.lines.text?.replace(/\n$/, "") ?? "",
        });
        if (matches.length >= MAX_MATCHES) return { matches, truncated: true };
      }
    }
    return { matches, truncated: false };
  }

  const re = buildRegex(o);
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
      const lines = readFileSync(p, "utf8").split("\n");
      lines.forEach((text, i) => {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) && matches.length < MAX_MATCHES) {
          matches.push({ path: p, line: i + 1, column: m.index + 1, text });
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
