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

const regression = loadModules().find((m) => m.id === "org.rsage.regression")!;
const rdef = regression.analyses[0]!;

describe("regression module", () => {
  test("loads with four menu commands under 회귀 and a consistent form", () => {
    expect(rdef.key).toBe("org.rsage.regression/regression");
    expect(regression.requires).toEqual(expect.arrayContaining(["parameters", "performance", "insight", "ggplot2"]));
    expect(formProblems(rdef.form, rdef.schema)).toEqual([]);
    expect(validateOptions(rdef.schema, fillDefaults(rdef.schema, {}))).toEqual([]);
    expect(rdef.entries.map((e) => e.menu)).toEqual([
      ["회귀", "선형 회귀"],
      ["회귀", "로지스틱 회귀"],
      ["회귀", "개수 회귀"],
      ["회귀", "일반화선형모형"],
    ]);
    expect(rdef.entries[1]!.preset).toEqual({ model: { family: "binomial" } });
    expect(rdef.form.about?.showcase?.some((s) => s.planned)).toBe(true);
  });

  test("terms and models are structured options, checked by the schema", () => {
    const o = fillDefaults(rdef.schema, {
      terms: [
        { id: "m:x", kind: "main", variable: "x" },
        { id: "m:g", kind: "main", variable: "g" },
        { id: "i1", kind: "interaction", components: ["m:x", "m:g"] },
      ],
      models: [{ id: "m1", label: "M", termIds: ["m:x", "m:g", "i1"], intercept: true }],
    });
    expect(validateOptions(rdef.schema, o)).toEqual([]);
    expect(validateOptions(rdef.schema, { ...o, terms: [{ id: "t", kind: "formula", variable: "x" }] }).length).toBeGreaterThan(0);
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
    // Without entries the menu path is the one command, under its category.
    expect(idef.entries).toEqual([{ menu: ["데이터 준비", "데이터 점검"], title: idef.title, preset: undefined }]);
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

const explore = loadModules().find((m) => m.id === "org.rsage.explore")!;
const edef = explore.analyses[0]!;

describe("exploration guide module", () => {
  test("loads under 데이터 준비 with a consistent form", () => {
    expect(edef.key).toBe("org.rsage.explore/explore");
    expect(edef.entries.map((e) => e.menu)).toEqual([["데이터 준비", "탐색 안내"]]);
    expect(explore.requires).toEqual(expect.arrayContaining(["datawizard", "ggplot2"]));
    expect(formProblems(edef.form, edef.schema)).toEqual([]);
    expect(validateOptions(edef.schema, fillDefaults(edef.schema, {}))).toEqual([]);
    expect(edef.guide).toContain("hint cards");
    expect(columnsUsed(edef.form, { target: "y", variables: ["a"], exclude: ["b"] })).toEqual(expect.arrayContaining(["y", "a", "b"]));
  });

  test("hint cards reach the assistant with their next analyses", () => {
    const inst: any = { id: "a-1", revision: 1, resultRevision: 1, dataset: "d" };
    const text = formatResult(inst, {
      runId: "r",
      title: "탐색 안내",
      tables: [],
      plots: [],
      notes: [],
      dataInfo: {},
      exports: [],
      provenance: {},
      hints: [
        {
          id: "s01",
          title: "'y'는 'x'와 관련이 큽니다",
          text: "확인해 보세요.",
          evidence: "Spearman ρ = 0.6, n = 50",
          variables: ["y", "x"],
          suggestions: [{ label: "선형 회귀 열기", analysis: "org.rsage.regression/regression", options: { outcome: { variable: "y" } } }],
        },
      ],
    });
    expect(text).toContain("1. [s01] 'y'는 'x'와 관련이 큽니다 (Spearman ρ = 0.6, n = 50)");
    expect(text).toContain('analysis=org.rsage.regression/regression options={"outcome":{"variable":"y"}}');
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

  test("opening the same analysis again brings back the earlier one", async () => {
    const make = (options?: any) => call("analysis.create", { analysis: "org.rsage.missing/missing", dataset: "aq", options, reuse: true });
    const a = await make();
    expect((await make()).id).toBe(a.id);
    // Still the same one after it has run.
    expect((await call("analysis.run", { id: a.id })).lastRun.status).toBe("ok");
    expect((await make()).id).toBe(a.id);
    // Different options, or changed ones, make a new analysis; the same preset again reuses it.
    const b = await make({ plots: { matrix: false } });
    expect(b.id).not.toBe(a.id);
    expect((await make({ plots: { matrix: false } })).id).toBe(b.id);
    await call("analysis.update", { id: a.id, options: { variables: ["Ozone"] } });
    const c = await make();
    expect(c.id).not.toBe(a.id);
    for (const id of [a.id, b.id, c.id]) await call("analysis.delete", { id });
  }, 60_000);

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

  test("a regression with two nested models runs on mtcars", async () => {
    const prep = await call("analysis.prepare", { moduleId: "org.rsage.regression" });
    if (!prep.ready) {
      console.warn(`skipping: R packages missing: ${prep.missing.join(", ")}`);
      return;
    }
    await host.session.evalText("cars <- mtcars; invisible(NULL)");
    const inst = await call("analysis.create", {
      analysis: "org.rsage.regression/regression",
      dataset: "cars",
      options: {
        outcome: { variable: "mpg" },
        predictors: { continuous: ["wt", "hp"] },
        terms: [
          { id: "m:wt", kind: "main", variable: "wt" },
          { id: "m:hp", kind: "main", variable: "hp" },
        ],
        models: [
          { id: "m1", label: "무게", termIds: ["m:wt"] },
          { id: "m2", label: "무게+마력", termIds: ["m:wt", "m:hp"] },
        ],
        comparison: { enabled: true },
      },
    });
    const done = await call("analysis.run", { id: inst.id });
    expect(done.lastRun.status).toBe("ok");
    const tests = done.result.tables.find((t: any) => t.id === "modelTests");
    expect(tests.rows[0].test).toBe("F");
    expect(tests.rows[0].p).toBeCloseTo(0.0014512, 6);
    expect(done.result.plots.some((p: any) => p.id === "coefficients")).toBe(true);
    await call("analysis.delete", { id: inst.id });
  }, 240_000);

  test("the exploration guide finds signals and its suggestions open as valid analyses", async () => {
    const prep = await call("analysis.prepare", { moduleId: "org.rsage.explore" });
    if (!prep.ready) {
      console.warn(`skipping: R packages missing: ${prep.missing.join(", ")}`);
      return;
    }
    await host.session.evalText("aq2 <- airquality; invisible(NULL)");
    const inst = await call("analysis.create", { analysis: "org.rsage.explore/explore", dataset: "aq2", options: { target: "Ozone" } });
    const done = await call("analysis.run", { id: inst.id });
    expect(done.lastRun.status).toBe("ok");
    const hints = done.result.hints;
    expect(hints.length).toBeGreaterThan(2);
    expect(hints[0].kind).toBe("target_model");
    expect(hints[0].evidence).toContain("n = ");
    // Plots on cards are inlined like any other plot.
    const plotIds = new Set(done.result.plots.map((p: any) => p.id));
    for (const h of hints) if (h.plot) expect(plotIds.has(h.plot)).toBe(true);
    expect(done.result.tables.find((t: any) => t.id === "target").rows[0].variable).toBe("Temp");
    // Every suggestion for an installed analysis passes that analysis's schema.
    const keys = new Set(host.analyses.defs().map((d: any) => d.key));
    const sugs = hints.flatMap((h: any) => h.suggestions).filter((s: any) => keys.has(s.analysis));
    expect(sugs.length).toBeGreaterThan(0);
    for (const s of sugs) {
      const made = await call("analysis.create", { analysis: s.analysis, dataset: "aq2", options: s.options, title: s.title });
      await call("analysis.delete", { id: made.id });
    }
    // The regression it suggests runs.
    const reg = sugs.find((s: any) => s.analysis === "org.rsage.regression/regression");
    if ((await call("analysis.prepare", { moduleId: "org.rsage.regression" })).ready) {
      const r = await call("analysis.create", { analysis: reg.analysis, dataset: "aq2", options: reg.options });
      const rr = await call("analysis.run", { id: r.id });
      expect(rr.lastRun.status).toBe("ok");
      await call("analysis.delete", { id: r.id });
    }
    expect(formatResult(done, done.result)).toContain("Hint cards shown to the user");

    // Hints the assistant writes are checked against the signals before they are saved.
    const item = { kind: "tool" as const, id: "t2", name: "set_exploration_hints", input: {}, status: "running" as const, at: "" };
    const env = { analyses: host.analyses, autoRunR: () => false, approve: async () => false, update: () => {}, signal: new AbortController().signal };
    const sig = done.result.tables.find((t: any) => t.id === "signals").rows;
    const temp = sig.find((r: any) => r.kind === "목표 변수와의 관계" && r.variables.includes("Temp"));
    const made = await runAnalysisTool(
      "set_exploration_hints",
      {
        analysis_id: inst.id,
        question: "오존 농도와 관련된 것",
        hints: [{ title: "기온이 높을수록 오존도 높습니다", text: `ρ는 약 ${Number(temp.value).toFixed(2)}입니다. 0.93이라는 숫자는 지어낸 것입니다.`, signals: [temp.id] }],
      },
      item,
      env,
    );
    expect(made.isError).toBe(true);
    expect(made.output).toContain("0.93");
    const good = await runAnalysisTool(
      "set_exploration_hints",
      {
        analysis_id: inst.id,
        question: "오존 농도와 관련된 것",
        hints: [{ title: "기온이 높을수록 오존도 높습니다", text: `ρ는 약 ${Number(temp.value).toFixed(2)}입니다.`, signals: [temp.id], suggestions: [reg] }],
        questions: ["바람이 셀수록 오존이 낮은가?"],
        variables: [{ name: "Ozone", meaning: "오존 농도(ppb)", role: "결과" }],
      },
      item,
      env,
    );
    expect(good.isError).toBeFalsy();
    const guided = await call("analysis.get", { id: inst.id });
    expect(guided.guide.hints[0].evidence).toContain("n = ");
    expect(guided.guide.runId).toBe(done.result.runId);
    expect(formatResult(guided, guided.result)).toContain("Hints you wrote");
    expect((await call("analysis.clearGuide", { id: inst.id })).guide).toBeUndefined();
    await call("analysis.delete", { id: inst.id });
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
