// R package listing, update checks and CRAN search. These run in a separate
// Rscript (same R, project folder as working directory, so .Rprofile and renv
// apply) to keep working while the console session is busy. Installing and
// removing go through the console instead, where the user sees progress.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CranPackage, PackageList, RPackage } from "@rsage/shared";
import { appDir, readJson, writeFileAtomic } from "./config";

const SEP = "\x1f";

// CRAN unless the user's options already name a repository.
const REPOS = `local({ r <- getOption("repos"); if (is.null(r) || !length(r) || identical(unname(r["CRAN"]), "@CRAN@")) options(repos = c(CRAN = "https://cloud.r-project.org")) })`;

export function rscriptPath(rHome: string): string {
  const p = join(rHome, "bin", "Rscript");
  return existsSync(p) ? p : "Rscript";
}

export async function runRscript(rHome: string, code: string, cwd?: string, timeoutMs = 120_000): Promise<string> {
  const p = Bun.spawn([rscriptPath(rHome), "--no-echo", "--no-restore", "-e", code], {
    cwd: cwd && existsSync(cwd) ? cwd : undefined,
    env: { ...process.env, LANG: process.env.LANG?.includes("UTF-8") ? process.env.LANG : "en_US.UTF-8", R_HOME: rHome },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => p.kill(), timeoutMs);
  const [out, err, code_] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  clearTimeout(timer);
  if (code_ !== 0) throw new Error(err.trim().split("\n").slice(-3).join("\n") || `Rscript exited with ${code_}`);
  return out;
}

const clean = (s: string | undefined) => (s && s !== "NA" ? s.replace(/\s+/g, " ").trim() : undefined);

export function parsePackageList(out: string): Omit<PackageList, "attached" | "loaded"> {
  const libPaths: string[] = [];
  const packages: RPackage[] = [];
  for (const line of out.split("\n")) {
    if (line.startsWith("##LIB" + SEP)) libPaths.push(line.slice(6));
    else if (line.includes(SEP)) {
      const [name, version, libPath, title] = line.split(SEP);
      if (name && version) packages.push({ name, version, libPath: libPath ?? "", title: clean(title) });
    }
  }
  packages.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return { packages, libPaths };
}

export async function listPackages(rHome: string, cwd?: string): Promise<Omit<PackageList, "attached" | "loaded">> {
  // The first library on .libPaths() wins when a package is installed twice, as in library().
  const code = `
    s <- "${SEP}"
    cat(paste0("##LIB", s, .libPaths()), sep = "\\n"); cat("\\n")
    ip <- installed.packages(fields = "Title")
    ip <- ip[!duplicated(ip[, "Package"]), , drop = FALSE]
    if (nrow(ip)) cat(paste(ip[, "Package"], ip[, "Version"], ip[, "LibPath"], gsub("[\\r\\n\\t]+", " ", ip[, "Title"]), sep = s), sep = "\\n")
  `;
  return parsePackageList(await runRscript(rHome, code, cwd));
}

export async function outdatedPackages(rHome: string, cwd?: string): Promise<{ name: string; installed: string; latest: string }[]> {
  const code = `${REPOS}
    o <- old.packages()
    if (!is.null(o) && nrow(o)) cat(paste(o[, "Package"], o[, "Installed"], o[, "ReposVer"], sep = "${SEP}"), sep = "\\n")`;
  const out = await runRscript(rHome, code, cwd);
  const seen = new Set<string>();
  return out
    .split("\n")
    .map((l) => l.split(SEP))
    .filter((f) => f.length === 3 && !seen.has(f[0]!) && seen.add(f[0]!))
    .map(([name, installed, latest]) => ({ name: name!, installed: installed!, latest: latest! }));
}

const CRAN_TTL = 24 * 3600_000;

export function cranCachePath() {
  return join(appDir(), "cache", "cran-packages.json");
}

let cranMemo: CranPackage[] | undefined;

async function cranIndex(rHome: string): Promise<CranPackage[]> {
  const file = cranCachePath();
  if (cranMemo && existsSync(file) && Date.now() - statSync(file).mtimeMs < CRAN_TTL) return cranMemo;
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < CRAN_TTL) {
    cranMemo = readJson<CranPackage[]>(file, []);
    if (cranMemo.length) return cranMemo;
  }
  // CRAN_package_db() has titles; available.packages() is the smaller fallback.
  const code = `${REPOS}
    db <- tryCatch(tools::CRAN_package_db(), error = function(e) NULL)
    if (is.null(db)) { a <- available.packages(); db <- data.frame(Package = a[, "Package"], Version = a[, "Version"], Title = NA) }
    db <- db[!duplicated(db$Package), ]
    cat(paste(db$Package, db$Version, gsub("[\\r\\n\\t]+", " ", db$Title), sep = "${SEP}"), sep = "\\n")`;
  const out = await runRscript(rHome, code, undefined, 180_000);
  const list = out
    .split("\n")
    .map((l) => l.split(SEP))
    .filter((f) => f.length >= 2 && f[0])
    .map(([name, version, title]) => ({ name: name!, version: version!, title: clean(title) }));
  if (!list.length) throw new Error("CRAN 목록을 받지 못했습니다.");
  writeFileAtomic(file, JSON.stringify(list));
  cranMemo = list;
  return list;
}

/** Exact name first, then name prefix, then name substring, then title words. */
export function rankCran(index: CranPackage[], query: string, limit = 50): CranPackage[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: [number, CranPackage][] = [];
  for (const p of index) {
    const n = p.name.toLowerCase();
    const s = n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : p.title?.toLowerCase().includes(q) ? 3 : -1;
    if (s >= 0) scored.push([s, p]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, limit).map((x) => x[1]);
}

export async function searchCran(rHome: string, query: string, limit?: number) {
  return rankCran(await cranIndex(rHome), query, limit);
}
