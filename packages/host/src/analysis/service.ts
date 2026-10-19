// Saved analyses and their runs. An analysis instance (module analysis +
// data set + options) lives in <project>/.rsage/analyses/<id>.json and
// every run writes into <project>/.rsage/analysis-runs/<runId>/. A run is a
// single private request in the user's R session: rsage::rs_run() reads
// the request, calls the module's analyse() and writes result.json.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { KernelSession } from "@rsage/kernel";
import type { AnalysisDataset, AnalysisDef, AnalysisFigureSize, AnalysisInstance, AnalysisResult, AnalysisRuntimeStatus } from "@rsage/shared";
import { fillDefaults, validateOptions } from "@rsage/shared";
import { readJson, writeFileAtomic } from "../config";
import type { Project } from "../project";
import { columnsUsed, loadModules, rPackagesDir, type LoadedModule } from "./registry";
import { prepareModule } from "./runtime";
import { analysisCode, rString } from "./rcode";

const SEP = "\x1f";
const REC = "\x1e";

/** Instance as stored on disk: the result is read from its run folder. */
type Stored = Omit<AnalysisInstance, "result"> & { resultRunId?: string };

export interface AnalysisDeps {
  project: () => Project | undefined;
  session: KernelSession;
  ensureSession: () => Promise<void>;
  rHome: () => Promise<string>;
  emit: (inst: AnalysisInstance) => void;
  emitDeleted: (id: string) => void;
}

export class AnalysisError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export class AnalysisService {
  private modules?: LoadedModule[];
  private running = new Map<string, AbortController>();
  /** Per R home and session generation: modules whose R packages are known to be installed. */
  private prepared = new Map<string, { status: AnalysisRuntimeStatus; generation: number; unload: boolean }>();

  constructor(private deps: AnalysisDeps) {}

  loadedModules(): LoadedModule[] {
    return (this.modules ??= loadModules());
  }

  defs(): AnalysisDef[] {
    return this.loadedModules().flatMap((m) => m.analyses);
  }

  def(key: string): { mod: LoadedModule; def: AnalysisDef } {
    for (const mod of this.loadedModules()) {
      const def = mod.analyses.find((a) => a.key === key || a.id === key || (mod.analyses.length === 1 && mod.id === key));
      if (def) return { mod, def };
    }
    throw new AnalysisError(`Unknown analysis: ${key}. Use list_analyses to see the available analyses.`, "unknown_analysis");
  }

  private project(): Project {
    const p = this.deps.project();
    if (!p) throw new AnalysisError("No project is open", "no_project");
    return p;
  }

  private file(id: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new AnalysisError(`Bad analysis id: ${id}`, "bad_id");
    return this.project().meta("analyses", `${id}.json`);
  }

  private runDir(runId: string) {
    return this.project().meta("analysis-runs", runId);
  }

  private read(id: string): Stored | null {
    const f = this.file(id);
    return existsSync(f) ? readJson<Stored | null>(f, null) : null;
  }

  private save(s: Stored): AnalysisInstance {
    this.project().ensureMeta();
    s.updatedAt = new Date().toISOString();
    writeFileAtomic(this.file(s.id), JSON.stringify(s, null, 2));
    const inst = this.withResult(s);
    this.deps.emit(inst);
    return inst;
  }

  private withResult(s: Stored): AnalysisInstance {
    const { resultRunId, ...rest } = s;
    const result = resultRunId ? this.readResult(resultRunId) : undefined;
    return { ...rest, result };
  }

  /** result.json with plot images inlined. */
  readResult(runId: string): AnalysisResult | undefined {
    const dir = this.runDir(runId);
    const raw = readJson<any>(join(dir, "result.json"), null);
    if (!raw) return undefined;
    const plots = (raw.plots ?? []).map((p: any) => {
      const f = join(dir, p.file);
      const src = existsSync(f) ? `data:image/png;base64,${readFileSync(f).toString("base64")}` : "";
      const rds = join(dir, `plot-${p.id}.rds`);
      return {
        id: p.id,
        title: p.title,
        alt: p.alt ?? p.title,
        width: p.width,
        height: p.height,
        autoWidth: p.autoWidth ?? p.width,
        autoHeight: p.autoHeight ?? p.height,
        src,
        rds: existsSync(rds) ? rds : undefined,
        description: p.description ?? undefined,
        section: p.section ?? undefined,
      };
    });
    return {
      runId,
      title: raw.title,
      // result.json keeps rows as arrays in column order; the UI and the assistant get objects.
      tables: (raw.tables ?? []).map((t: any) => ({
        ...t,
        rows: (t.rows ?? []).map((r: any) => (Array.isArray(r) ? Object.fromEntries(t.columns.map((c: any, i: number) => [c.id, r[i] ?? null])) : r)),
        notes: t.notes ?? [],
        description: t.description ?? undefined,
        section: t.section ?? undefined,
      })),
      plots,
      sections: raw.sections ?? [],
      notes: raw.notes ?? [],
      dataInfo: raw.dataInfo ?? {},
      exports: raw.exports ?? [],
      provenance: raw.provenance ?? {},
    };
  }

  list(): AnalysisInstance[] {
    const p = this.deps.project();
    if (!p) return [];
    const dir = p.meta("analyses");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson<Stored | null>(join(dir, f), null))
      .filter((s): s is Stored => !!s && !!s.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((s) => this.withResult(s));
  }

  get(id: string): AnalysisInstance | null {
    const s = this.read(id);
    return s ? this.withResult(s) : null;
  }

  /** Options with defaults filled in, or an error that names every problem. */
  checkOptions(def: AnalysisDef, options: unknown): any {
    const full = fillDefaults(def.schema, options ?? {});
    const issues = validateOptions(def.schema, full);
    if (issues.length) {
      throw new AnalysisError(`Invalid options for ${def.key}: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`, "invalid_options");
    }
    return full;
  }

  create(p: { analysis: string; dataset?: string; options?: any; title?: string; createdBy?: "user" | "assistant" }): AnalysisInstance {
    const { def } = this.def(p.analysis);
    // An untouched analysis of the same kind and data (opened from the menu,
    // never changed or run) is reused, so repeated opens don't pile up copies.
    const blank = this.list().find(
      (i) => i.analysis === def.key && i.dataset === (p.dataset ?? "") && i.revision === 1 && !i.lastRun && !i.result,
    );
    if (blank) {
      if (p.options === undefined && p.title === undefined) return this.save(this.read(blank.id)!);
      return this.update({ id: blank.id, options: p.options, title: p.title });
    }
    const now = new Date().toISOString();
    const s: Stored = {
      id: `a-${randomUUID().slice(0, 8)}`,
      analysis: def.key,
      title: p.title || def.title,
      dataset: p.dataset ?? "",
      options: this.checkOptions(def, p.options),
      revision: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: p.createdBy ?? "user",
    };
    return this.save(s);
  }

  update(p: { id: string; dataset?: string; options?: any; title?: string; figures?: Record<string, AnalysisFigureSize | null> }): AnalysisInstance {
    const s = this.read(p.id);
    if (!s) throw new AnalysisError(`No analysis ${p.id}`, "not_found");
    const { def } = this.def(s.analysis);
    if (p.title !== undefined) s.title = p.title;
    if (p.dataset !== undefined || p.options !== undefined) {
      if (p.dataset !== undefined) s.dataset = p.dataset;
      if (p.options !== undefined) s.options = this.checkOptions(def, p.options);
      s.revision += 1;
    }
    if (p.figures !== undefined) {
      const figs: Record<string, AnalysisFigureSize> = {};
      for (const [k, v] of Object.entries(p.figures)) {
        if (v && v.width > 0 && v.height > 0) figs[k] = { width: Math.min(30, v.width), height: Math.min(30, v.height) };
      }
      s.figures = Object.keys(figs).length ? figs : undefined;
      s.revision += 1;
    }
    return this.save(s);
  }

  delete(id: string) {
    this.running.get(id)?.abort();
    const s = this.read(id);
    if (!s) return;
    rmSync(this.file(id), { force: true });
    for (const runId of this.runIds(id)) rmSync(this.runDir(runId), { recursive: true, force: true });
    this.deps.emitDeleted(id);
  }

  private runIds(id: string): string[] {
    const dir = this.project().meta("analysis-runs");
    return existsSync(dir) ? readdirSync(dir).filter((r) => r.startsWith(`${id}--`)) : [];
  }

  code(id: string): string {
    const s = this.read(id);
    if (!s) throw new AnalysisError(`No analysis ${id}`, "not_found");
    const { mod, def } = this.def(s.analysis);
    return analysisCode(mod.rPackage, mod.entrypoints[def.id]!, s.dataset || "data", s.options, s.figures);
  }

  /** Draws a result plot in the session; Ark sends it to the Plots pane. */
  async showPlot(id: string, plotId: string) {
    const inst = this.get(id);
    const plot = inst?.result?.plots.find((p) => p.id === plotId);
    if (!plot?.rds) throw new AnalysisError("이 그림은 다시 그릴 수 없습니다. 분석을 다시 실행하세요.", "no_plot");
    await this.deps.ensureSession();
    const s = this.read(id)!;
    const { mod } = this.def(s.analysis);
    const status = await this.prepare(mod.id);
    const lib = status.libPath ? `.libPaths(unique(c(${rString(status.libPath)}, .libPaths()))); ` : "";
    this.deps.session.execute(`${lib}rsage::rs_show_plot(${rString(plot.rds)})`, { origin: "app" });
  }

  cancel(id: string) {
    this.running.get(id)?.abort();
  }

  async datasets(): Promise<AnalysisDataset[]> {
    await this.deps.ensureSession();
    const code = `local({
      for (n in ls(globalenv())) {
        x <- get(n, envir = globalenv())
        if (is.data.frame(x)) {
          ty <- vapply(x, function(c) class(c)[1], "")
          cat(n, nrow(x), paste(names(x), ty, sep = "${SEP}", collapse = "${SEP}"), sep = "${REC}")
          cat("\\n")
        }
      }
    })`;
    const out = await this.deps.session.evalText(code, 15_000);
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, rows, cols = ""] = line.split(REC);
        const f = cols ? cols.split(SEP) : [];
        const columns = [];
        for (let i = 0; i + 1 < f.length; i += 2) columns.push({ name: f[i]!, type: f[i + 1]! });
        return { name: name!, rows: Number(rows), columns };
      });
  }

  /** Checks the module's R packages, installing the app's own ones when needed. */
  async prepare(moduleId: string, force = false): Promise<AnalysisRuntimeStatus> {
    const mod = this.loadedModules().find((m) => m.id === moduleId);
    if (!mod) throw new AnalysisError(`Unknown module: ${moduleId}`, "unknown_module");
    const rHome = await this.deps.rHome();
    const key = `${rHome}\n${mod.id}`;
    const gen = this.deps.session.state.generation;
    const cached = this.prepared.get(key);
    if (cached && cached.status.ready && !force) return cached.status;
    const runtime = join(rPackagesDir() ?? "", "rsage");
    const r = await prepareModule(rHome, this.deps.project()?.root, mod, runtime);
    const { installed, ...status } = r;
    // A package reinstalled while the session has it loaded must be unloaded before the next run.
    this.prepared.set(key, { status, generation: gen, unload: installed.length > 0 || !!cached?.unload });
    return status;
  }

  async run(id: string, by: "user" | "assistant" = "user"): Promise<AnalysisInstance> {
    let s = this.read(id);
    if (!s) throw new AnalysisError(`No analysis ${id}`, "not_found");
    const { mod, def } = this.def(s.analysis);
    if (def.requiresDataset && !s.dataset) throw new AnalysisError("Choose a data set first.", "no_dataset");
    // Only the latest revision matters: a newer run replaces one in flight.
    this.running.get(id)?.abort();
    const ctl = new AbortController();
    this.running.set(id, ctl);
    const runId = `${id}--${Date.now().toString(36)}`;
    const revision = s.revision;
    s.lastRun = { runId, revision, status: "running", startedAt: new Date().toISOString() };
    this.save(s);
    const end = (patch: Partial<NonNullable<Stored["lastRun"]>>, resultRunId?: string) => {
      const cur = this.read(id);
      if (!cur) return null;
      if (cur.lastRun?.runId !== runId) return this.withResult(cur);
      cur.lastRun = { ...cur.lastRun, ...patch, finishedAt: new Date().toISOString() };
      if (resultRunId) {
        const old = cur.resultRunId;
        cur.resultRunId = resultRunId;
        cur.resultRevision = revision;
        if (old && old !== resultRunId) rmSync(this.runDir(old), { recursive: true, force: true });
      }
      return this.save(cur);
    };
    try {
      await this.deps.ensureSession();
      const rHome = await this.deps.rHome();
      const status = await this.prepare(mod.id);
      if (!status.ready) {
        const msg = status.error ?? `R packages needed by ${mod.title}: ${status.missing.join(", ")}. Install them first.`;
        return end({ status: "error", error: { code: "missing_packages", message: msg } })!;
      }
      const prep = this.prepared.get(`${rHome}\n${mod.id}`)!;
      const unload = prep.unload ? [mod.rPackage, "rsage"].map((p) => `if (${rString(p)} %in% loadedNamespaces()) try(unloadNamespace(${rString(p)}), silent = TRUE)`).join("\n") : "";
      const dir = this.runDir(runId);
      mkdirSync(dir, { recursive: true });
      const req = join(dir, "request.json");
      writeFileAtomic(
        req,
        JSON.stringify({
          runId,
          package: mod.rPackage,
          entrypoint: mod.entrypoints[def.id],
          dataset: s.dataset,
          options: s.options,
          figures: s.figures ?? {},
          // Columns the options name (roles and column pickers), kept in the input snapshot.
          columns: columnsUsed(def.form, s.options),
          outDir: dir,
          by,
        }),
      );
      // Cancelled while packages were being checked: don't start R at all.
      if (ctl.signal.aborted) return end({ status: "cancelled" })!;
      const code = `local({\n.libPaths(unique(c(${rString(status.libPath!)}, .libPaths())))\n${unload}\nrsage::rs_run(${rString(req)})\n})`;
      const r = await this.deps.session.runPrivate(code, ctl.signal);
      if (r.status === "ok" && prep.unload) prep.unload = false;
      if (r.status === "aborted") return end({ status: "cancelled" })!;
      const err = readJson<{ code?: string; message?: string } | null>(join(dir, "error.json"), null);
      if (err) return end({ status: "error", error: { code: err.code ?? "error", message: err.message ?? "분석이 실패했습니다." } })!;
      if (r.status === "error" || !existsSync(join(dir, "result.json"))) {
        return end({ status: "error", error: { code: "r_error", message: r.error ?? "결과를 만들지 못했습니다." } })!;
      }
      return end({ status: "ok" }, runId)!;
    } catch (e: any) {
      return end({ status: "error", error: { code: e.code ?? "error", message: e.message } }) ?? this.get(id)!;
    } finally {
      if (this.running.get(id) === ctl) this.running.delete(id);
      for (const r of this.runIds(id)) {
        const cur = this.read(id);
        if (r !== cur?.resultRunId && r !== cur?.lastRun?.runId) rmSync(this.runDir(r), { recursive: true, force: true });
      }
    }
  }

  dispose() {
    for (const c of this.running.values()) c.abort();
  }
}
