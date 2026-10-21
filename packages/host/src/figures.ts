// Converting a figure to tidyplots from the Plots pane. The R side is the
// rsageFigures package (r-packages/rsageFigures): it reruns the code that
// drew the figure in a child of the global environment, rewrites the ggplot
// as tidyplots, checks the numbers and saves the new figure. The host
// installs that package when its source changed, runs the conversion
// silently in the session and draws the result so it appears in the Plots
// pane. Writing the code back into a .qmd is the UI's job (it owns the
// editor model and the approval).

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FigureConversion, FigureOptions } from "@rsage/shared";
import type { KernelSession } from "@rsage/kernel";
import { runRscript } from "./packages";
import { rPackagesDir, sourceHash } from "./analysis/registry";
import { rString } from "./analysis/rcode";

const PKG = "rsageFigures";
const SEP = "\x1f";

export interface FigureDeps {
  session: KernelSession;
  ensureSession: () => Promise<void>;
  rHome: () => Promise<string>;
  cwd: () => string | undefined;
}

export class FigureService {
  /** The library rsageFigures is installed in, once checked for this R and source. */
  private ready?: { rHome: string; hash: string; lib: string };
  private dir = mkdtempSync(join(tmpdir(), "rsage-figures-"));
  private seq = 0;

  constructor(private deps: FigureDeps) {}

  async convert(code: string, options: FigureOptions = {}): Promise<FigureConversion> {
    await this.deps.ensureSession();
    const prep = await this.prepare();
    if (prep.missing.length) return { kind: "none", status: "missing", missing: prep.missing, notes: [], kept: [] };
    const rds = join(this.dir, `figure-${++this.seq}.rds`);
    const unload = prep.installed ? `if ("${PKG}" %in% loadedNamespaces()) unloadNamespace("${PKG}")\n` : "";
    const r = `local({
      .libPaths(unique(c(${rString(prep.lib)}, .libPaths())))
      ${unload}cat(rsageFigures::convert_json(${rString(code)}, jsonlite::fromJSON(${rString(JSON.stringify(options))}), globalenv(), plot_file = ${rString(rds)}))
    })`;
    const out = await this.deps.session.evalText(r, 120_000);
    let res: FigureConversion;
    try {
      res = JSON.parse(out.slice(out.indexOf("{")));
    } catch {
      return { kind: "error", status: "error", message: out.trim() || "변환 결과를 읽지 못했습니다.", notes: [], kept: [] };
    }
    res.notes = arr(res.notes);
    res.kept = arr(res.kept);
    if (existsSync(rds)) {
      // Drawn by the session so Ark sends it to the Plots pane like any plot.
      const rec = this.deps.session.execute(`print(readRDS(${rString(rds)}))`, { origin: "app" });
      res.previewExecutionId = rec.id;
    }
    return res;
  }

  /** Installs rsageFigures when its source changed; reports CRAN packages to install. */
  private async prepare(): Promise<{ lib: string; missing: string[]; installed: boolean }> {
    const rHome = await this.deps.rHome();
    const src = rPackagesDir() && join(rPackagesDir()!, PKG);
    if (!src || !existsSync(join(src, "DESCRIPTION"))) throw new Error("rsageFigures 패키지 소스를 찾지 못했습니다.");
    const hash = sourceHash(src);
    if (this.ready?.rHome === rHome && this.ready.hash === hash) return { lib: this.ready.lib, missing: [], installed: false };
    const probe = await runRscript(
      rHome,
      `lib <- .libPaths()[1]
       if (file.access(lib, 2) != 0) { lib <- Sys.getenv("R_LIBS_USER"); dir.create(lib, recursive = TRUE, showWarnings = FALSE) }
       cat("LIB", normalizePath(lib), sep = "${SEP}"); cat("\\n")
       for (p in c("ggplot2", "rlang", "jsonlite", "tidyplots", "dplyr")) if (!nzchar(system.file(package = p))) cat("MISSING", p, "\\n", sep = "${SEP}")
       h <- suppressWarnings(utils::packageDescription("${PKG}", lib.loc = lib, fields = "RSageHash"))
       cat("HASH", h, "\\n", sep = "${SEP}")`,
      this.deps.cwd(),
      60_000,
    );
    let lib = "";
    let have = "";
    const missing: string[] = [];
    for (const line of probe.split("\n")) {
      const f = line.split(SEP);
      if (f[0] === "LIB") lib = f[1]!;
      else if (f[0] === "MISSING") missing.push(f[1]!);
      else if (f[0] === "HASH") have = f[1]!;
    }
    if (missing.length) return { lib, missing, installed: false };
    if (have === hash) {
      this.ready = { rHome, hash, lib };
      return { lib, missing, installed: false };
    }
    const tmp = mkdtempSync(join(tmpdir(), "rsage-pkg-"));
    try {
      const dir = join(tmp, PKG);
      cpSync(src, dir, { recursive: true, filter: (p) => !/\/tests(\/|$)|\.Rcheck/.test(p.slice(src.length)) });
      const desc = join(dir, "DESCRIPTION");
      writeFileSync(desc, readFileSync(desc, "utf8").replace(/\s*$/, "\n") + `RSageHash: ${hash}\n`);
      await runRscript(
        rHome,
        `install.packages(${rString(dir)}, repos = NULL, type = "source", lib = ${rString(lib)}, quiet = TRUE)
         if (!identical(utils::packageDescription("${PKG}", lib.loc = ${rString(lib)}, fields = "RSageHash"), ${rString(hash)})) stop("${PKG} 설치에 실패했습니다.")`,
        this.deps.cwd(),
        180_000,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    this.ready = { rHome, hash, lib };
    return { lib, missing, installed: true };
  }

  dispose() {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null || v === "" ? [] : [String(v)]);
