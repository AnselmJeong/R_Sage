// Analysis modules shipped with the app: modules/<name>/manifest.json plus
// the R package sources in r-packages/. The packaged app points
// RSAGE_MODULES_PATH and RSAGE_RPKG_PATH at its resources; in a checkout
// both are found next to the packages/ folder.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import type { AnalysisDef, AnalysisModuleInfo } from "@rsage/shared";

export interface LoadedModule extends AnalysisModuleInfo {
  dir: string;
  entrypoints: Record<string, string>;
  /** Source folder of the module's R package. */
  rSource: string;
}

function findUp(name: string): string | undefined {
  let dir = import.meta.dir;
  for (let i = 0; i < 8; i++) {
    const p = join(dir, name);
    if (existsSync(p) && statSync(p).isDirectory()) return p;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return undefined;
}

const existing = (p: string | undefined) => (p && existsSync(p) ? p : undefined);

export function modulesDir(): string | undefined {
  return existing(process.env.RSAGE_MODULES_PATH) ?? findUp("modules");
}

export function rPackagesDir(): string | undefined {
  return existing(process.env.RSAGE_RPKG_PATH) ?? findUp("r-packages");
}

/** Imports of an R package's DESCRIPTION, without version ranges or base packages. */
export function descriptionImports(pkgDir: string): string[] {
  const fields: Record<string, string> = {};
  let key = "";
  for (const line of readFileSync(join(pkgDir, "DESCRIPTION"), "utf8").split("\n")) {
    if (/^\s/.test(line) && key) fields[key] += " " + line.trim();
    else {
      const m = line.match(/^([\w.@-]+):\s*(.*)$/);
      if (m) fields[(key = m[1]!)] = m[2]!;
    }
  }
  const base = new Set(["stats", "utils", "tools", "grDevices", "graphics", "methods", "grid", "parallel"]);
  return (fields.Imports ?? "")
    .split(",")
    .map((x) => x.replace(/\(.*?\)/g, "").trim())
    .filter((x) => x && !base.has(x));
}

/** Content hash of a package source folder, so the app reinstalls it only when it changed. */
export function sourceHash(dir: string): string {
  const h = createHash("sha256");
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        h.update(relative(dir, p));
        h.update(readFileSync(p));
      }
    }
  };
  walk(dir);
  return h.digest("hex").slice(0, 16);
}

function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function loadModules(dir = modulesDir(), rpkg = rPackagesDir()): LoadedModule[] {
  if (!dir || !existsSync(dir)) return [];
  const out: LoadedModule[] = [];
  for (const name of readdirSync(dir).sort()) {
    const mdir = join(dir, name);
    const file = join(mdir, "manifest.json");
    if (!existsSync(file)) continue;
    try {
      const m = JSON.parse(readFileSync(file, "utf8"));
      if (m.runtime?.kind !== "r-package") continue;
      const rSource = join(rpkg ?? "", m.runtime.source ?? m.runtime.package);
      const entrypoints: Record<string, string> = {};
      const analyses: AnalysisDef[] = (m.analyses ?? []).map((a: any) => {
        entrypoints[a.id] = a.entrypoint;
        return {
          key: `${m.id}/${a.id}`,
          moduleId: m.id,
          id: a.id,
          title: a.title,
          menu: a.menu ?? [a.title],
          schema: JSON.parse(readFileSync(join(mdir, a.optionsSchema), "utf8")),
          form: JSON.parse(readFileSync(join(mdir, a.ui), "utf8")),
          summary: a.assistant?.summary ?? a.title,
          guide: a.assistant?.guide ? readText(join(mdir, a.assistant.guide)) : "",
          requiresDataset: a.requiresDataset !== false,
        };
      });
      const requires = existsSync(join(rSource, "DESCRIPTION")) ? descriptionImports(rSource) : (m.runtime.requires ?? []);
      out.push({
        id: m.id,
        version: m.version,
        title: m.title,
        description: m.description ?? "",
        rPackage: m.runtime.package,
        requires: requires.filter((p: string) => p !== "rsage"),
        backends: m.runtime.backends ?? [],
        analyses,
        dir: mdir,
        entrypoints,
        rSource,
      });
    } catch (err: any) {
      console.warn(`[modules] ${file}: ${err.message}`);
    }
  }
  return out;
}
