// Terms and models of analyses that compare models (regression), kept in
// step with the predictor boxes. Pure functions, used by the form controls
// in components/AnalysisModels.tsx.

import type { AnalysisForm, AnalysisFormControl } from "@rsage/shared";
import { getPath, setPath } from "@rsage/shared";

export type ModelsControl = Extract<AnalysisFormControl, { type: "models" }>;

export interface Term {
  id: string;
  kind: "main" | "interaction";
  variable?: string;
  components?: string[];
}
export interface Model {
  id: string;
  label: string;
  termIds: string[];
  intercept?: boolean;
  [k: string]: unknown;
}

export const mainId = (v: string) => `m:${v}`;

/** Variables of a term, in the order it was built. */
export function termVars(t: Term, byId: Map<string, Term>): string[] {
  if (t.kind === "main") return t.variable ? [t.variable] : [];
  return (t.components ?? []).map((c) => byId.get(c)?.variable ?? "?");
}

export const termLabel = (t: Term, byId: Map<string, Term>) => termVars(t, byId).join(" × ");

export const predictorsOf = (c: ModelsControl, options: any): string[] => [
  ...new Set(c.predictors.flatMap((b) => (getPath(options, b) as string[] | null) ?? [])),
];

/** Every subset of the components, smaller than the whole, of size 1 or more. */
export function lowerParts(comps: string[]): string[][] {
  const out: string[][] = [];
  const n = comps.length;
  for (let mask = 1; mask < (1 << n) - 1; mask++) out.push(comps.filter((_, i) => mask & (1 << i)));
  return out;
}

export const keyOf = (ids: string[]) => [...ids].sort().join("*");

/**
 * Keeps terms and models in step with the predictors: main terms follow the
 * predictor boxes (a new predictor joins every model), terms of removed
 * predictors leave, and pickers drop ids that no longer exist. Selects with
 * `choicesBy` keep a value their choices allow. Called on every options
 * change.
 */
export function syncModels(form: AnalysisForm, options: any): any {
  const controls = allControls(form);
  // A select whose choices follow another option falls back to its first choice.
  for (const c of controls) {
    if (c.type !== "select" || !c.choicesBy) continue;
    const allowed = c.choicesBy.values[String(getPath(options, c.choicesBy.bind))];
    const v = getPath(options, c.bind);
    if (allowed?.length && !allowed.includes(v as string)) options = setPath(options, c.bind, allowed[0]);
  }
  const mc = controls.find((c): c is ModelsControl => c.type === "models");
  if (!mc) return options;
  const preds = predictorsOf(mc, options);
  const prevTerms = ((getPath(options, mc.terms) as Term[] | null) ?? []).filter((t) => t && t.id);
  const prevMains = new Set(prevTerms.filter((t) => t.kind === "main").map((t) => t.variable));
  const mains: Term[] = preds.map((v) => ({ id: mainId(v), kind: "main", variable: v }));
  const valid = new Set(mains.map((t) => t.id));
  const inter = prevTerms.filter((t) => t.kind === "interaction" && (t.components ?? []).every((c) => valid.has(c)));
  const added = preds.filter((v) => !prevMains.has(v)).map(mainId);
  const models = ((getPath(options, mc.bind) as Model[] | null) ?? []).map((m) => ({
    ...m,
    termIds: [...new Set([...(m.termIds ?? []).filter((id) => valid.has(id) || inter.some((t) => t.id === id)), ...added])],
  }));
  const used = new Set(models.flatMap((m) => m.termIds));
  const terms = [...mains, ...inter.filter((t) => used.has(t.id))];
  const termIds = new Set(terms.map((t) => t.id));
  const modelIds = new Set(models.map((m) => m.id));
  let o = setPath(setPath(options, mc.terms, terms), mc.bind, models);
  for (const c of controls) {
    if (c.type === "termChoice") o = setPath(o, c.bind, ((getPath(o, c.bind) as string[] | null) ?? []).filter((id) => termIds.has(id)));
    if (c.type === "model") {
      const v = getPath(o, c.bind) as string | null;
      if (v && !modelIds.has(v)) o = setPath(o, c.bind, null);
    }
  }
  return o;
}

function allControls(form: AnalysisForm): AnalysisFormControl[] {
  const out: AnalysisFormControl[] = [];
  const walk = (cs: AnalysisFormControl[]) => {
    for (const c of cs) {
      out.push(c);
      if (c.type === "group") walk(c.controls);
      if (c.type === "checkbox" && c.controls) walk(c.controls);
    }
  };
  walk(form.roles ?? []);
  for (const s of form.sections) walk(s.controls);
  return out;
}
