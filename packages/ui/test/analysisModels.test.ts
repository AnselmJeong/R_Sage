import { describe, expect, test } from "bun:test";
import type { AnalysisForm } from "@rsage/shared";
import { syncModels } from "../src/analysisModels";

const form: AnalysisForm = {
  formVersion: 2,
  sections: [
    {
      title: "모형",
      controls: [
        { type: "select", bind: "family", label: "f" },
        { type: "select", bind: "link", label: "l", choicesBy: { bind: "family", values: { gaussian: ["default"], gamma: ["default", "inverse"] } } },
        { type: "models", bind: "models", label: "m", terms: "terms", predictors: ["cont", "cat"] },
        { type: "model", bind: "pick", label: "p", models: "models" },
        { type: "termChoice", bind: "forced", label: "t", terms: "terms" },
      ],
    },
  ],
};

const base = { family: "gaussian", link: "default", cont: [] as string[], cat: [] as string[], terms: [], models: [{ id: "m1", label: "모형 1", termIds: [] }], pick: null, forced: [] };

describe("syncModels", () => {
  test("a new predictor becomes a main term in every model", () => {
    const o = syncModels(form, { ...base, cont: ["x"], cat: ["g"] });
    expect(o.terms).toEqual([
      { id: "m:x", kind: "main", variable: "x" },
      { id: "m:g", kind: "main", variable: "g" },
    ]);
    expect(o.models[0].termIds).toEqual(["m:x", "m:g"]);
  });

  test("a main term the user took out stays out", () => {
    const o1 = syncModels(form, { ...base, cont: ["x"], cat: ["g"] });
    const o2 = syncModels(form, { ...o1, models: [{ ...o1.models[0], termIds: ["m:g"] }] });
    expect(o2.models[0].termIds).toEqual(["m:g"]);
  });

  test("removing a predictor removes its terms, interactions and picks", () => {
    const o1 = syncModels(form, { ...base, cont: ["x"], cat: ["g"] });
    const withInt = {
      ...o1,
      terms: [...o1.terms, { id: "i1", kind: "interaction", components: ["m:x", "m:g"] }],
      models: [{ ...o1.models[0], termIds: ["m:x", "m:g", "i1"] }],
      forced: ["i1", "m:g"],
      pick: "m9",
    };
    const o2 = syncModels(form, { ...withInt, cont: [] });
    expect(o2.terms).toEqual([{ id: "m:g", kind: "main", variable: "g" }]);
    expect(o2.models[0].termIds).toEqual(["m:g"]);
    expect(o2.forced).toEqual(["m:g"]);
    expect(o2.pick).toBeNull();
  });

  test("a select falls back to a choice its other option allows", () => {
    expect(syncModels(form, { ...base, family: "gamma", link: "inverse" }).link).toBe("inverse");
    expect(syncModels(form, { ...base, family: "gaussian", link: "inverse" }).link).toBe("default");
  });
});
