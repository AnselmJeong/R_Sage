// Makes sure the R packages an analysis module needs are installed in the
// R the project uses. Following the module library policy, the app's own
// packages (rsage and the module's package) go into the first writable
// library on .libPaths(), the same one the package pane, the console and
// Quarto see. CRAN dependencies are never installed silently: they are
// reported, and the UI offers to install them in the console.

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnalysisRuntimeStatus } from "@rsage/shared";
import { runRscript } from "../packages";
import { descriptionImports, sourceHash, type LoadedModule } from "./registry";
import { rString } from "./rcode";

const SEP = "\x1f";

interface Probe {
  lib: string;
  have: Set<string>;
  hashes: Map<string, string>;
}

async function probe(rHome: string, cwd: string | undefined, pkgs: string[], own: string[]): Promise<Probe> {
  const code = `
    lib <- .libPaths()[1]
    if (file.access(lib, 2) != 0) {
      lib <- Sys.getenv("R_LIBS_USER")
      dir.create(lib, recursive = TRUE, showWarnings = FALSE)
    }
    cat("LIB", normalizePath(lib), sep = "${SEP}"); cat("\\n")
    for (p in c(${pkgs.map(rString).join(", ")})) if (nzchar(system.file(package = p, lib.loc = unique(c(lib, .libPaths()))))) cat("HAVE", p, "\\n", sep = "${SEP}")
    for (p in c(${own.map(rString).join(", ")})) {
      h <- suppressWarnings(utils::packageDescription(p, lib.loc = lib, fields = "RSageHash"))
      if (!is.na(h)) cat("HASH", p, h, "\\n", sep = "${SEP}")
    }`;
  const out = await runRscript(rHome, code, cwd, 60_000);
  const r: Probe = { lib: "", have: new Set(), hashes: new Map() };
  for (const line of out.split("\n")) {
    const f = line.split(SEP);
    if (f[0] === "LIB") r.lib = f[1]!;
    else if (f[0] === "HAVE") r.have.add(f[1]!);
    else if (f[0] === "HASH") r.hashes.set(f[1]!, f[2]!);
  }
  return r;
}

/** Copies the source with its hash stamped into DESCRIPTION and installs it into lib. */
async function installOwn(rHome: string, cwd: string | undefined, src: string, pkg: string, hash: string, lib: string) {
  const tmp = mkdtempSync(join(tmpdir(), "rsage-pkg-"));
  try {
    const dir = join(tmp, pkg);
    cpSync(src, dir, { recursive: true, filter: (p) => !/\/tests(\/|$)|\.Rcheck/.test(p.slice(src.length)) });
    const desc = join(dir, "DESCRIPTION");
    writeFileSync(desc, readFileSync(desc, "utf8").replace(/\s*$/, "\n") + `RSageHash: ${hash}\n`);
    await runRscript(
      rHome,
      `install.packages(${rString(dir)}, repos = NULL, type = "source", lib = ${rString(lib)}, quiet = TRUE)
       h <- utils::packageDescription(${rString(pkg)}, lib.loc = ${rString(lib)}, fields = "RSageHash")
       if (!identical(h, ${rString(hash)})) stop("${pkg} 설치에 실패했습니다.")`,
      cwd,
      180_000,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export interface PrepareResult extends AnalysisRuntimeStatus {
  /** Packages (re)installed by this call: a running session must unload them. */
  installed: string[];
}

export async function prepareModule(rHome: string, cwd: string | undefined, mod: LoadedModule, runtimeSource: string): Promise<PrepareResult> {
  if (!existsSync(join(runtimeSource, "DESCRIPTION")) || !existsSync(join(mod.rSource, "DESCRIPTION"))) {
    return { ready: false, missing: [], missingOptional: [], installed: [], error: "모듈의 R 패키지 소스를 찾지 못했습니다." };
  }
  const required = [...new Set([...descriptionImports(runtimeSource), ...mod.requires])];
  const optional = mod.backends.map((b) => b.package);
  const own: [string, string, string][] = [
    ["rsage", runtimeSource, sourceHash(runtimeSource)],
    [mod.rPackage, mod.rSource, sourceHash(mod.rSource)],
  ];
  const p = await probe(rHome, cwd, [...required, ...optional], own.map((o) => o[0]));
  const missing = required.filter((x) => !p.have.has(x));
  const missingOptional = optional.filter((x) => !p.have.has(x));
  if (missing.length) return { ready: false, libPath: p.lib, missing, missingOptional, installed: [] };
  const installed: string[] = [];
  for (const [pkg, src, hash] of own) {
    if (p.hashes.get(pkg) === hash) continue;
    await installOwn(rHome, cwd, src, pkg, hash, p.lib);
    installed.push(pkg);
  }
  return { ready: true, libPath: p.lib, missing, missingOptional, installed };
}
