// Checks on assistant-written exploration hints: numbers must come from the
// cited signals, signals and variables must exist, suggestions must be valid.
import { describe, expect, test } from "bun:test";
import { GuideError, buildGuide, numberAllowed, numbersIn } from "../src/analysis/guide";

const cols = (ids: string[]) => ids.map((id) => ({ id, label: id }));

const inst: any = {
  id: "a-1",
  analysis: "org.rsage.explore/explore",
  options: { holdout: { enabled: false } },
  result: {
    runId: "a-1--r1",
    hints: [
      {
        id: "s01",
        title: "'sleep_h'와 'phq_total'은 함께 움직입니다",
        text: "ρ = -0.48",
        evidence: "Spearman ρ = -0.48, n = 118 (중간)",
        signal: "s01",
        plot: "hint-s01",
        variables: [],
        suggestions: [{ label: "선형 회귀 열기", analysis: "org.rsage.regression/regression", options: { outcome: { variable: "phq_total" } } }],
      },
    ],
    plots: [],
    tables: [
      {
        id: "signals",
        columns: cols(["id", "kind", "title", "variables", "measure", "value", "n", "size"]),
        rows: [
          { id: "s01", kind: "목표 변수와의 관계", title: "수면", variables: "phq_total, sleep_h", measure: "Spearman ρ", value: -0.4812, n: 118, size: "중간" },
          { id: "s02", kind: "결측", title: "결측", variables: "crp", measure: "결측 비율(%)", value: 23.5, n: 120, size: "" },
        ],
      },
      { id: "variables", columns: cols(["variable", "mean"]), rows: [{ variable: "phq_total", mean: 9.31 }, { variable: "sleep_h", mean: 6.4 }, { variable: "crp", mean: 2.2 }, { variable: "phq9", mean: 1.1 }] },
      { id: "overview", columns: cols(["item", "value"]), rows: [{ item: "행", value: "1,200" }] },
    ],
  },
};

const ok = () => {};

describe("numbers in a sentence", () => {
  test("names with digits and thousands separators", () => {
    expect(numbersIn("PHQ-9 총점과 phq9 문항, T1 시점은 숫자가 아닙니다")).toEqual([]);
    expect(numbersIn("1,200명 중 23.5%가 빠졌고 ρ = −0.48입니다")).toEqual(["1200", "23.5", "-0.48"]);
    expect(numbersIn("x2_total 평균 9.3", ["x2_total"])).toEqual(["9.3"]);
  });

  test("a rounded value matches, a new one does not", () => {
    expect(numberAllowed("0.48", [-0.4812])).toBe(true);
    expect(numberAllowed("0.5", [-0.4812])).toBe(true);
    expect(numberAllowed("0.61", [-0.4812])).toBe(false);
    expect(numberAllowed("24", [23.5])).toBe(true);
    expect(numberAllowed("3", [])).toBe(true);
    expect(numberAllowed("45", [])).toBe(false);
  });
});

describe("buildGuide", () => {
  test("keeps cards that cite signals and quote their numbers", () => {
    const g = buildGuide(
      inst,
      {
        question: "우울과 관련된 것",
        hints: [{ title: "잠이 짧을수록 우울 점수가 높은 편입니다", text: "ρ = -0.48, 118명. 평균 점수는 9.3점입니다. 전체 1,200행 중입니다.", signals: ["s01"] }],
        questions: ["수면이 우울과 관련 있나?"],
        variables: [{ name: "sleep_h", meaning: "하루 수면 시간", role: "노출" }],
      },
      ok,
    );
    expect(g.runId).toBe("a-1--r1");
    expect(g.hints[0]!.evidence).toBe("Spearman ρ = -0.48, n = 118 (중간)");
    expect(g.hints[0]!.plot).toBe("hint-s01");
    expect(g.hints[0]!.variables).toEqual(["phq_total", "sleep_h"]);
    // No suggestions of its own: it keeps the rule card's next analysis.
    expect(g.hints[0]!.suggestions.map((s) => s.label)).toEqual(["선형 회귀 열기"]);
  });

  test("names every problem at once", () => {
    try {
      buildGuide(
        inst,
        {
          hints: [
            { title: "결측이 많습니다", text: "결측이 41%입니다.", signals: ["s02"] },
            { title: "근거 없음", text: "", signals: [] },
            { title: "없는 신호", text: "", signals: ["s99"] },
          ],
          variables: [{ name: "nope", meaning: "?" }],
        },
        () => {
          throw new Error("unused");
        },
      );
      throw new Error("expected a GuideError");
    } catch (e: any) {
      expect(e).toBeInstanceOf(GuideError);
      expect(e.problems.join("\n")).toContain("hint 1: 41");
      expect(e.problems.join("\n")).toContain("hint 2: name the signal ids");
      expect(e.problems.join("\n")).toContain("no signal s99");
      expect(e.problems.join("\n")).toContain("no column nope");
    }
  });

  test("checks suggestions and opens them on held-out rows", () => {
    const held = { ...inst, options: { holdout: { enabled: true, saveAs: "check_set" } } };
    const sug = { label: "회귀", analysis: "org.rsage.regression/regression", options: {} };
    const g = buildGuide(held, { hints: [{ title: "수면", text: "", signals: ["s01"], suggestions: [sug] }] }, ok);
    expect(g.hints[0]!.suggestions[0]!.dataset).toBe("check_set");
    expect(() =>
      buildGuide(inst, { hints: [{ title: "수면", text: "", signals: ["s01"], suggestions: [sug] }] }, () => {
        throw new Error("outcome.variable: required");
      }),
    ).toThrow("suggestion 1: outcome.variable: required");
  });

  test("a question for the user is enough", () => {
    const g = buildGuide(inst, { ask: "한 행이 한 환자인가요, 한 방문인가요?", hints: [] }, ok);
    expect(g.ask).toContain("한 행");
    expect(() => buildGuide({ ...inst, analysis: "org.rsage.missing/missing" }, { ask: "?" }, ok)).toThrow("not 탐색 안내");
  });
});
