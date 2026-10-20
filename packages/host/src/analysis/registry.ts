// Analysis modules shipped with the app: modules/<name>/manifest.json plus
// the R package sources in r-packages/. The packaged app points
// RSAGE_MODULES_PATH and RSAGE_RPKG_PATH at its resources; in a checkout
// both are found next to the packages/ folder.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import type { AnalysisDef, AnalysisForm, AnalysisFormControl, AnalysisModuleInfo } from "@rsage/shared";
import { fillDefaults, validateOptions } from "@rsage/shared";

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
          menu: a.entries?.[0]?.menu ?? a.menu ?? [a.title],
          entries: (a.entries ?? [{ menu: a.menu ?? [a.title] }]).map((e: any) => ({
            menu: e.menu,
            title: e.title ?? a.title,
            preset: e.preset,
          })),
          schema: JSON.parse(readFileSync(join(mdir, a.optionsSchema), "utf8")),
          form: JSON.parse(readFileSync(join(mdir, a.ui), "utf8")),
          summary: a.assistant?.summary ?? a.title,
          guide: a.assistant?.guide ? readText(join(mdir, a.assistant.guide)) : "",
          requiresDataset: a.requiresDataset !== false,
        };
      });
      for (const a of analyses) {
        for (const p of formProblems(a.form, a.schema)) console.warn(`[modules] ${a.key}: ${p}`);
        for (const e of a.entries)
          for (const i of e.preset ? validateOptions(a.schema, fillDefaults(a.schema, e.preset)) : [])
            console.warn(`[modules] ${a.key} menu ${e.menu.join(" › ")}: preset ${i.path}: ${i.message}`);
      }
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

/**
 * Places where a form refers to an option the schema doesn't have: control
 * binds, conditions and showcase switches. Module tests should expect none.
 */
export function formProblems(form: AnalysisForm, schema: any): string[] {
  const opts = fillDefaults(schema, {});
  const has = (path: string) => {
    let o: any = opts;
    for (const k of path.split(".")) {
      if (!o || typeof o !== "object" || !(k in o)) return false;
      o = o[k];
    }
    return true;
  };
  const out: string[] = [];
  const check = (path: string | undefined, where: string) => {
    if (path !== undefined && !has(path)) out.push(`${where} refers to unknown option "${path}"`);
  };
  const walk = (controls: AnalysisFormControl[], where: string) => {
    for (const c of controls) {
      if (c.type === "group") {
        check(c.visibleWhen?.bind, `${where} > ${c.label} visibleWhen`);
        walk(c.controls, `${where} > ${c.label}`);
        continue;
      }
      check(c.bind, `${where} > ${c.label}`);
      check(c.visibleWhen?.bind, `${where} > ${c.label} visibleWhen`);
      check(c.enabledWhen?.bind, `${where} > ${c.label} enabledWhen`);
      if (c.type === "checkbox" && c.controls) walk(c.controls, `${where} > ${c.label}`);
      if (c.type === "models") for (const b of [c.terms, ...c.predictors, c.outcome]) check(b, `${where} > ${c.label}`);
      if (c.type === "model") check(c.models, `${where} > ${c.label}`);
      if (c.type === "termChoice") check(c.terms, `${where} > ${c.label}`);
      if (c.type === "level") check(c.column, `${where} > ${c.label}`);
      if (c.type === "column") for (const b of c.from ?? []) check(b, `${where} > ${c.label}`);
      if (c.type === "select" && c.choicesBy) check(c.choicesBy.bind, `${where} > ${c.label} choicesBy`);
      if (c.type === "rows") {
        const item = c.bind.split(".").reduce((s: any, k) => s?.properties?.[k], schema)?.items;
        for (const f of c.fields) {
          if (!item?.properties?.[f.key]) out.push(`${where} > ${c.label} field "${f.key}" is not in the option's item schema`);
          if (f.type === "level" && (!f.column || !c.fields.some((g) => g.key === f.column))) out.push(`${where} > ${c.label} field "${f.key}" needs a column field`);
        }
      }
    }
  };
  walk(form.roles ?? [], "roles");
  for (const sec of form.sections ?? []) walk(sec.controls, sec.title);
  for (const sc of form.about?.showcase ?? []) for (const k of [...Object.keys(sc.enable), ...(sc.needsFilled ?? [])]) check(k, `showcase "${sc.title}"`);
  return out;
}

/** Column names the options point at: role boxes, column pickers and column fields of rule rows. */
export function columnsUsed(form: AnalysisForm, options: any): string[] {
  const binds: string[] = [];
  const walk = (controls: AnalysisFormControl[]) => {
    for (const c of controls) {
      if (c.type === "group") walk(c.controls);
      else {
        if (c.type === "variables" || c.type === "variable" || c.type === "column") binds.push(c.bind);
        if (c.type === "checkbox" && c.controls) walk(c.controls);
        if (c.type === "rows") for (const f of c.fields) if (f.type === "column") binds.push(`${c.bind}[].${f.key}`);
      }
    }
  };
  walk(form.roles ?? []);
  for (const sec of form.sections ?? []) walk(sec.controls);
  const out = new Set<string>();
  const at = (o: any, path: string): any[] => {
    const [head, ...rest] = path.split("[].");
    const v = head!.split(".").reduce((x: any, k) => x?.[k], o);
    if (!rest.length) return Array.isArray(v) ? v : [v];
    return Array.isArray(v) ? v.flatMap((row) => at(row, rest.join("[]."))) : [];
  };
  for (const b of binds) for (const n of at(options, b)) if (typeof n === "string" && n) out.add(n);
  return [...out];
}
