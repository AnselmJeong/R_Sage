// Analysis modules: registry, option schema, R code, and a full run of the
// missing-data module in a live R session. The live part needs Ark (or, with
// RSAGE_TEST_IRKERNEL=1, IRkernel standing in for it) and an R with the
// module's CRAN dependencies installed.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverR, findArk } from "@rsage/kernel";
import { fillDefaults, validateOptions } from "@rsage/shared";
import { loadModules, descriptionImports, formProblems, columnsUsed } from "../src/analysis/registry";
import { analysisCode, toR } from "../src/analysis/rcode";
import { formatResult, leavesOutput, runAnalysisTool } from "../src/assistant/analysis-tools";

const missing = loadModules().find((m) => m.id === "org.rsage.missing")!;
const def = missing.analyses[0]!;

describe("module registry", () => {
  test("finds the missing-data module with its schema, form and guide", () => {
    expect(def.key).toBe("org.rsage.missing/missing");
    expect(missing.rPackage).toBe("rsageMissing");
    expect(missing.requires).toEqual(["dplyr", "tibble", "ggplot2", "rlang"]);
    expect(def.form.sections.length).toBeGreaterThan(0);
    expect(def.guide).toContain("MCAR");
    expect(missing.backends.map((b) => b.package)).toContain("naniar");
  });

  test("every form control binds to an option in the schema", () => {
    expect(formProblems(def.form, def.schema)).toEqual([]);
    expect(formProblems({ formVersion: 2, sections: [{ title: "x", controls: [{ type: "checkbox", bind: "plots.nope", label: "n" }] }] }, def.schema)).toEqual([
      'x > n refers to unknown option "plots.nope"',
    ]);
  });

  test("R imports come from DESCRIPTION without base packages", () => {
    expect(descriptionImports(missing.rSource)).toEqual(["rsage", "dplyr", "tibble", "ggplot2", "rlang"]);
  });
});

const integrity = loadModules().find((m) => m.id === "org.rsage.integrity")!;
const idef = integrity.analyses[0]!;

describe("data integrity module", () => {
  test("loads with dlookr required and a consistent form", () => {
    expect(idef.key).toBe("org.rsage.integrity/integrity");
    expect(integrity.requires).toContain("dlookr");
    expect(formProblems(idef.form, idef.schema)).toEqual([]);
    expect(validateOptions(idef.schema, fillDefaults(idef.schema, {}))).toEqual([]);
    expect(idef.form.about?.showcase?.length).toBeGreaterThan(5);
  });

  test("rule rows: field checks, defaults, validation and the columns they use", () => {
    const bad = { formVersion: 2, sections: [{ title: "x", controls: [{ type: "rows", bind: "values.ranges", label: "범위", fields: [{ key: "lo", label: "lo", type: "text" }] }] }] } as any;
    expect(formProblems(bad, idef.schema)).toEqual(['x > 범위 field "lo" is not in the option\'s item schema']);
    const o = fillDefaults(idef.schema, {
      keys: ["id"],
      values: { ranges: [{ variable: "age", min: "0", max: "120" }], order: [{ first: "start", op: "<=", second: "end" }] },
      text: { synonyms: [{ variable: null, values: "a, b", to: "a" }] },
    });
    expect(o.values.allowed).toEqual([]);
    expect(validateOptions(idef.schema, o)).toEqual([]);
    expect(validateOptions(idef.schema, { ...o, values: { ...o.values, order: [{ first: "a", op: "=>", second: "b" }] } }).map((i) => i.path)).toEqual(["values.order[0].op"]);
    expect(columnsUsed(idef.form, o).sort()).toEqual(["age", "end", "id", "start"]);
  });

  test("saving cleaned data or writing a report needs the user's approval", () => {
    const o = fillDefaults(idef.schema, {});
    expect(leavesOutput(o)).toBe(false);
    expect(leavesOutput({ ...o, clean: { ...o.clean, enabled: true } })).toBe(true);
    expect(leavesOutput({ ...o, clean: { ...o.clean, enabled: true, saveAs: "" } })).toBe(false);
    expect(leavesOutput({ ...o, report: { ...o.report, enabled: true } })).toBe(true);
    expect(leavesOutput(fillDefaults(def.schema, { impute: { enabled: true, saveAs: "imp" } }))).toBe(true);
  });
});

describe("option schema", () => {
  test("fills nested defaults", () => {
    const o = fillDefaults(def.schema, { plots: { upset: true } });
    expect(o.variables).toEqual([]);
    expect(o.group).toBeNull();
    expect(o.plots).toMatchObject({ upset: true, variables: true, matrix: true, byGroup: true, spanVariable: null, upsetSets: 5 });
    expect(o.relations).toEqual({ scatter: false, x: null, y: null, shadowDensity: false, variable: null, by: null });
    expect(o.impute.method).toBe("pmm");
  });

  test("reports each problem with its path", () => {
    const o = fillDefaults(def.schema, { maxPatterns: 0, impute: { method: "magic", saveAs: "1x" }, colour: "red" });
    const issues = validateOptions(def.schema, o).map((i) => i.path);
    expect(issues).toEqual(["maxPatterns", "impute.method", "impute.saveAs", "colour"]);
    expect(validateOptions(def.schema, fillDefaults(def.schema, {}))).toEqual([]);
  });
});

describe("R code", () => {
  test("writes JSON options as R literals", () => {
    expect(toR({ a: ["x", "y"], b: null, c: true, n: 5, f: 0.5, e: [], s: 'say "hi"' })).toBe(
      'list(\n  a = c("x", "y"),\n  b = NULL,\n  c = TRUE,\n  n = 5L,\n  f = 0.5,\n  e = character(),\n  s = "say \\"hi\\""\n)',
    );
    expect(analysisCode("rsageMissing", "analyse", "내 데이터", { m: 1 })).toContain("rsageMissing::analyse(\n  `내 데이터`,");
    expect(analysisCode("rsageMissing", "analyse", "aq", {}, { variables: { width: 9, height: 3 } })).toContain(
      "res <- rsage::rs_resize(res, list(variables = c(9, 3)))",
    );
  });
});

const useShim = process.env.RSAGE_TEST_IRKERNEL === "1";
const arkPath = useShim ? join(import.meta.dir, "fixtures", "irkernel-ark.sh") : findArk();
const rs = await discoverR();
const r = rs.find((x) => !x.tooOld) ?? rs[0];
const live = arkPath && r ? describe : describe.skip;

live("missing-data analysis in a live session", async () => {
  const home = mkdtempSync(join(tmpdir(), "rsage-home-"));
  const proj = mkdtempSync(join(tmpdir(), "rsage-proj-"));
  const prevArk = process.env.RSAGE_ARK_PATH;
  const prevHome = process.env.RSAGE_HOME;
  process.env.RSAGE_ARK_PATH = arkPath!;
  process.env.RSAGE_HOME = home;
  const { Host } = await import("../src/host");
  const host = new Host({ shell: "browser" });
  const events: any[] = [];
  host.subscribe((type, payload) => type.startsWith("analysis.") && events.push({ type, payload }));
  const call = (m: string, p: any = {}) => host.dispatch(m, p) as Promise<any>;
  afterAll(async () => {
    await host.dispose();
    if (prevArk === undefined) delete process.env.RSAGE_ARK_PATH;
    else process.env.RSAGE_ARK_PATH = prevArk;
    if (prevHome === undefined) delete process.env.RSAGE_HOME;
    else process.env.RSAGE_HOME = prevHome;
  });

  test("runs on airquality and stores a result", async () => {
    await call("project.open", { path: proj });
    await call("session.start", {});
    const prep = await call("analysis.prepare", { moduleId: "org.rsage.missing" });
    if (!prep.ready) {
      console.warn(`skipping: R packages missing: ${prep.missing.join(", ")}`);
      return;
    }
    await host.session.evalText("aq <- airquality; aq$Month <- factor(aq$Month); invisible(NULL)");
    const ds = await call("analysis.datasets");
    expect(ds.find((d: any) => d.name === "aq")).toMatchObject({ rows: 153 });

    const inst = await call("analysis.create", { analysis: "org.rsage.missing/missing", dataset: "aq" });
    const done = await call("analysis.run", { id: inst.id });
    expect(done.lastRun.status).toBe("ok");
    const vars = done.result.tables.find((t: any) => t.id === "variables");
    const ozone = vars.rows.find((row: any) => row.variable === "Ozone");
    expect(ozone.n_miss).toBe(37);
    expect(done.result.plots.length).toBeGreaterThan(0);
    expect(done.result.plots[0].src).toStartWith("data:image/png;base64,");
    expect(done.result.dataInfo.rows).toBe(153);
    expect(existsSync(join(proj, ".rsage", "analyses", `${inst.id}.json`))).toBe(true);
    expect(readFileSync(join(proj, ".rsage", ".gitignore"), "utf8")).toContain("analysis-runs/");
    expect(events.some((e) => e.type === "analysis.changed" && e.payload.lastRun?.status === "ok")).toBe(true);
    expect(formatResult(done, done.result)).toContain("Ozone");

    // A changed option makes a new revision; the R session's data is untouched.
    const upd = await call("analysis.update", { id: inst.id, options: { variables: ["Ozone", "Solar.R"], group: "Month", plots: { matrix: false } } });
    expect(upd.revision).toBe(2);
    const again = await call("analysis.run", { id: inst.id });
    expect(again.resultRevision).toBe(2);
    expect(again.result.tables.find((t: any) => t.id === "variables").rows.length).toBe(10);
    expect((await host.session.evalText("cat(sum(is.na(aq$Ozone)))")).trim()).toBe("37");

    // Errors come back as a failed run, not a thrown request.
    await call("analysis.update", { id: inst.id, options: { variables: ["nope"] } });
    const bad = await call("analysis.run", { id: inst.id });
    expect(bad.lastRun.status).toBe("error");
    expect(bad.lastRun.error.message).toContain("nope");
    expect(bad.resultRevision).toBe(2);

    const code = await call("analysis.code", { id: inst.id });
    expect(code).toContain("rsageMissing::analyse(");

    // A size the user picks for one figure redraws that figure only, and travels with the code.
    await call("analysis.update", { id: inst.id, options: { variables: ["Ozone", "Solar.R"] } });
    const sized0 = await call("analysis.run", { id: inst.id });
    const auto = sized0.result.plots.find((p: any) => p.id === "variables");
    await call("analysis.update", { id: inst.id, figures: { variables: { width: 9, height: 3 } } });
    const sized = await call("analysis.run", { id: inst.id });
    const v = sized.result.plots.find((p: any) => p.id === "variables");
    expect([v.width, v.height, v.autoWidth, v.autoHeight]).toEqual([9, 3, auto.width, auto.height]);
    expect(v.rds).toEndWith("plot-variables.rds");
    expect(await call("analysis.code", { id: inst.id })).toContain("rs_resize(res, list(variables = c(9, 3)))");
    await call("analysis.update", { id: inst.id, figures: { variables: null } });
    expect((await call("analysis.run", { id: inst.id })).result.plots.find((p: any) => p.id === "variables").width).toBe(auto.width);
  }, 240_000);

  test("the assistant runs it through run_analysis", async () => {
    if (!(await call("analysis.prepare", { moduleId: "org.rsage.missing" })).ready) return;
    const opened: string[] = [];
    const item = { kind: "tool" as const, id: "t1", name: "run_analysis", input: {}, status: "running" as const, at: "" };
    const env = {
      analyses: host.analyses,
      openAnalysis: (id: string) => opened.push(id),
      autoRunR: () => false,
      approve: async () => false,
      update: () => {},
      signal: new AbortController().signal,
    };
    const listed = await runAnalysisTool("list_analyses", {}, item, env);
    expect(listed.output).toContain("org.rsage.missing/missing");
    const bad = await runAnalysisTool("run_analysis", { analysis: "org.rsage.missing/missing", dataset: "aq", options: { maxPatterns: "ten" } }, item, env);
    expect(bad.isError).toBe(true);
    expect(bad.output).toContain("maxPatterns: expected integer");
    const datasets = await runAnalysisTool("list_datasets", {}, item, env);
    expect(datasets.output).toMatch(/^aq: 153 rows × 6 columns; Ozone <integer>/m);
    const unknown = await runAnalysisTool("run_analysis", { analysis: "missing", dataset: "nope" }, item, env);
    expect(unknown.isError).toBe(true);
    expect(unknown.output).toContain("No data frame named nope");
    expect(unknown.output).toContain("aq");
    // Saving an object in the session needs the user's approval (declined here).
    const declined = await runAnalysisTool("run_analysis", { analysis: "org.rsage.missing/missing", dataset: "aq", options: { impute: { enabled: true, saveAs: "imp" } } }, item, env);
    expect(declined.output).toContain("declined");
    const ok = await runAnalysisTool("run_analysis", { analysis: "missing", dataset: "aq", options: { variables: ["Ozone", "Solar.R"] }, title: "AQ 결측" }, item, env);
    expect(ok.isError).toBe(false);
    expect(ok.output).toContain("Ozone\t연속형\t116\t37");
    expect(opened.length).toBe(1);
    const again = await runAnalysisTool("get_analysis_result", { analysis_id: opened[0] }, item, env);
    expect(again.output).toContain("Little");
  }, 120_000);

  test("opening the same analysis twice reuses the untouched one", async () => {
    const a = await call("analysis.create", { analysis: "org.rsage.missing/missing", dataset: "never_run" });
    const b = await call("analysis.create", { analysis: "org.rsage.missing/missing", dataset: "never_run" });
    expect(b.id).toBe(a.id);
    const c = await call("analysis.create", { analysis: "org.rsage.missing/missing", dataset: "never_run", options: { plots: { matrix: false } } });
    expect(c.id).toBe(a.id);
    expect(c.options.plots.matrix).toBe(false);
    const d = await call("analysis.create", { analysis: "org.rsage.missing/missing", dataset: "never_run" });
    expect(d.id).not.toBe(a.id);
    await call("analysis.delete", { id: a.id });
    await call("analysis.delete", { id: d.id });
  });

  test("a missing data set is reported", async () => {
    if (!(await call("analysis.prepare", { moduleId: "org.rsage.missing" })).ready) return;
    const inst = await call("analysis.create", { analysis: "org.rsage.missing/missing", dataset: "no_such_df" });
    const done = await call("analysis.run", { id: inst.id });
    expect(done.lastRun.error.code).toBe("dataset_missing");
  }, 60_000);

  test("the integrity check runs on a messy data frame", async () => {
    const prep = await call("analysis.prepare", { moduleId: "org.rsage.integrity" });
    if (!prep.ready) {
      console.warn(`skipping: R packages missing: ${prep.missing.join(", ")}`);
      return;
    }
    await host.session.evalText(
      'sheet <- data.frame(id = c("01234", "1234", "01234", "00007"), 금액 = c("1,000원", "2000", "N/A", "300"), 성별 = c("남", "X", " 남", "여"), check.names = FALSE); invisible(NULL)',
    );
    const inst = await call("analysis.create", {
      analysis: "org.rsage.integrity/integrity",
      dataset: "sheet",
      options: { keys: ["id"], values: { allowed: [{ variable: "성별", values: "남, 여" }] }, clean: { enabled: true, saveAs: "sheet_clean" } },
    });
    const done = await call("analysis.run", { id: inst.id });
    expect(done.lastRun.status).toBe("ok");
    expect(done.result.tables[0].id).toBe("summary");
    const rules = done.result.tables.find((t: any) => t.id === "rules");
    expect(rules.rows[0].n).toBe(1);
    expect(done.result.tables.find((t: any) => t.id === "duplicateKeys").rows[0].copies).toBe(2);
    expect((await host.session.evalText("cat(class(sheet_clean$금액), sum(is.na(sheet_clean$금액)))")).trim()).toBe("numeric 1");
    expect((await host.session.evalText('cat("package:dlookr" %in% search())')).trim()).toBe("FALSE");
    expect(formatResult(done, done.result)).toContain("점검 요약");
  }, 240_000);

  // R ignores an interrupt that lands inside C code such as saveRDS; it must be retried.
  test.skipIf(useShim)("a private run stops even when interrupted inside C code", async () => {
    await host.session.evalText("big2 <- airquality[rep(1:153, 40000), ]; invisible(NULL)");
    const ctl = new AbortController();
    const t0 = Date.now();
    const p = host.session.runPrivate("for (i in 1:20) saveRDS(big2, tempfile())", ctl.signal);
    await Bun.sleep(1500);
    ctl.abort();
    expect((await p).status).toBe("aborted");
    expect((await host.session.evalText("rm(big2); cat(1 + 1)")).trim()).toBe("2");
    expect(Date.now() - t0).toBeLessThan(20_000);
  }, 60_000);

  // IRkernel only takes interrupts as signals, not as Jupyter interrupt requests.
  test.skipIf(useShim)("cancel interrupts a running analysis", async () => {
    if (!(await call("analysis.prepare", { moduleId: "org.rsage.missing" })).ready) return;
    // Without mice the analysis finishes before the cancel arrives, so there is nothing to interrupt.
    if ((await host.session.evalText("cat(requireNamespace('mice', quietly = TRUE))")).trim() !== "TRUE") {
      console.warn("skipping: the cancel test needs the mice package");
      return;
    }
    await host.session.evalText("big <- airquality[rep(1:153, 400), ]; invisible(NULL)");
    const inst = await call("analysis.create", {
      analysis: "org.rsage.missing/missing",
      dataset: "big",
      options: { impute: { enabled: true, m: 50, maxit: 50 } },
    });
    const p = call("analysis.run", { id: inst.id });
    await Bun.sleep(2500);
    await call("analysis.cancel", { id: inst.id });
    const done = await p;
    expect(done.lastRun.status).toBe("cancelled");
    expect((await host.session.evalText("cat(1 + 1)")).trim()).toBe("2");
  }, 120_000);
});
