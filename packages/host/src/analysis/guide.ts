// Assistant-written hints for an exploration result (탐색 안내). The
// assistant picks signals from the result's signals table and explains them
// for the user's question; this checks that every card cites signals that
// exist, that every number it writes is one of theirs, and that suggested
// analyses have valid options, before the cards reach the tab.

import type { AnalysisHint, AnalysisInstance, AnalysisSuggestion, AnalysisTable, ExplorationGuide } from "@rsage/shared";

export const EXPLORE_KEY = "org.rsage.explore/explore";

const MAX_HINTS = 8;
const MAX_QUESTIONS = 6;

export interface GuideInput {
  question?: string;
  questions?: string[];
  variables?: { name: string; meaning: string; role?: string }[];
  hints?: { title: string; text: string; signals: string[]; suggestions?: AnalysisSuggestion[] }[];
  ask?: string;
}

export class GuideError extends Error {
  constructor(readonly problems: string[]) {
    super(`The hints were not saved. Fix these and call set_exploration_hints again:\n- ${problems.join("\n- ")}`);
  }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Name-like tokens that carry digits (phq9, PHQ-9, T1, hamd_17): words, not
 * numbers. Removed before numbers are read from a sentence.
 */
const NAME_WITH_DIGITS = /[A-Za-z]+[-_]?\d+[A-Za-z0-9_]*/g;
const NUMBER = /(?<![\p{L}\p{N}_.])[-−]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\p{L}\p{N}_.])[-−]?\d+(?:\.\d+)?/gu;

/** Numbers written in a text, as given (commas dropped, minus normalised). */
export function numbersIn(text: string, names: string[] = []): string[] {
  let t = text;
  // Longest first, so "age_group" goes before "age".
  for (const n of [...names].sort((a, b) => b.length - a.length)) if (n) t = t.split(n).join(" ");
  t = t.replace(NAME_WITH_DIGITS, " ");
  return (t.match(NUMBER) ?? []).map((x) => x.replace(/,/g, "").replace("−", "-"));
}

/** Whether a written number is one of the allowed values, as rounded in the text. */
export function numberAllowed(written: string, allowed: number[]): boolean {
  const x = Number(written);
  if (!Number.isFinite(x)) return true;
  const decimals = written.includes(".") ? written.split(".")[1]!.length : 0;
  // Small whole numbers count things ("두 집단", "3개 변수"); they need no source.
  if (decimals === 0 && Math.abs(x) <= 10) return true;
  const round = (v: number) => Math.round(v * 10 ** decimals) / 10 ** decimals;
  return allowed.some((v) => Math.abs(round(v) - x) < 1e-9 || Math.abs(round(Math.abs(v)) - Math.abs(x)) < 1e-9);
}

const table = (inst: AnalysisInstance, id: string): AnalysisTable | undefined => inst.result?.tables.find((t) => t.id === id);

const fmtValue = (v: number) => (Math.abs(v - Math.round(v)) < 1e-9 && Math.abs(v) >= 1 ? String(Math.round(v)) : v.toFixed(2));

/**
 * The guide to save, or a GuideError naming every problem.
 * `checkSuggestion` throws when a suggestion's analysis or options are invalid.
 */
export function buildGuide(inst: AnalysisInstance, input: GuideInput, checkSuggestion: (s: AnalysisSuggestion) => void): ExplorationGuide {
  const result = inst.result;
  if (inst.analysis !== EXPLORE_KEY) throw new GuideError([`analysis ${inst.id} is not 탐색 안내 (${EXPLORE_KEY}).`]);
  if (!result) throw new GuideError([`analysis ${inst.id} has no result yet; run it first.`]);
  const signals = table(inst, "signals")?.rows ?? [];
  const byId = new Map(signals.map((r) => [String(r.id), r]));
  const profile = table(inst, "variables")?.rows ?? [];
  const varNames = profile.map((r) => String(r.variable));
  const problems: string[] = [];

  const hintsIn = Array.isArray(input.hints) ? input.hints : [];
  const ask = str(input.ask);
  if (!hintsIn.length && !ask) problems.push("give at least one hint, or `ask` the user one question when the data are unclear.");
  if (hintsIn.length > MAX_HINTS) problems.push(`at most ${MAX_HINTS} hints (got ${hintsIn.length}); keep the ones that answer the question.`);

  // Numbers any card may use: the data's size and shape.
  const common: number[] = [];
  for (const r of table(inst, "overview")?.rows ?? []) for (const n of numbersIn(Object.values(r).join(" "))) common.push(Number(n));

  const hints: AnalysisHint[] = [];
  hintsIn.slice(0, MAX_HINTS).forEach((h, i) => {
    const at = `hint ${i + 1}`;
    const title = str(h?.title);
    const text = str(h?.text);
    if (!title) problems.push(`${at}: title is empty.`);
    const ids = (Array.isArray(h?.signals) ? h.signals : []).map(String);
    if (!ids.length) problems.push(`${at}: name the signal ids (column ID of the signals table) it is based on.`);
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length) problems.push(`${at}: no signal ${unknown.join(", ")} in the signals table.`);
    const rows = ids.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
    const vars = [...new Set(rows.flatMap((r) => String(r.variables ?? "").split(", ").filter(Boolean)))];

    // Numbers this card may quote: its signals, the rule cards and profiles of their variables, the target ranking.
    const allowed = [...common];
    const take = (s: unknown) => {
      for (const n of numbersIn(String(s ?? ""))) allowed.push(Number(n));
    };
    for (const r of rows) {
      for (const v of Object.values(r)) typeof v === "number" ? allowed.push(v) : take(v);
    }
    for (const card of result.hints ?? []) if (card.signal && ids.includes(card.signal)) [card.title, card.text, card.evidence].forEach(take);
    for (const r of profile) if (vars.includes(String(r.variable))) for (const v of Object.values(r)) typeof v === "number" ? allowed.push(v) : take(v);
    for (const r of table(inst, "target")?.rows ?? []) if (vars.includes(String(r.variable))) for (const v of Object.values(r)) typeof v === "number" ? allowed.push(v) : take(v);
    const bad = [...new Set(numbersIn(`${title} ${text}`, [...varNames, ...ids]).filter((n) => !numberAllowed(n, allowed)))];
    if (bad.length) {
      problems.push(
        `${at}: ${bad.join(", ")} ${bad.length > 1 ? "are" : "is"} not in signal${ids.length > 1 ? "s" : ""} ${ids.join(", ") || "(none)"}. Quote only numbers from the signals the card cites (rounded is fine), or cite the signal that has them.`,
      );
    }

    const suggestions: AnalysisSuggestion[] = [];
    (Array.isArray(h?.suggestions) ? h.suggestions : []).forEach((s, j) => {
      const sug: AnalysisSuggestion = {
        label: str(s?.label) || "분석 열기",
        analysis: str(s?.analysis),
        options: s?.options && typeof s.options === "object" && !Array.isArray(s.options) ? s.options : {},
        title: str(s?.title) || undefined,
        dataset: str(s?.dataset) || holdoutName(inst),
      };
      try {
        checkSuggestion(sug);
        suggestions.push(sug);
      } catch (e: any) {
        problems.push(`${at}, suggestion ${j + 1}: ${e?.message ?? e}`);
      }
    });

    const plot = (result.hints ?? []).find((c) => c.plot && c.signal && ids.includes(c.signal))?.plot;
    const evidence = rows
      .filter((r) => r.measure && typeof r.value === "number")
      .map((r) => `${r.measure} = ${fmtValue(r.value as number)}${r.n != null ? `, n = ${r.n}` : ""}${r.size ? ` (${r.size})` : ""}`)
      .join("; ");
    hints.push({ id: `g${i + 1}`, title, text, evidence: evidence || undefined, kind: "guide", variables: vars, plot, signal: ids[0], suggestions });
  });

  const variables = (Array.isArray(input.variables) ? input.variables : [])
    .map((v) => ({ name: str(v?.name), meaning: str(v?.meaning), role: str(v?.role) || undefined }))
    .filter((v) => v.name && v.meaning);
  const unknownVars = variables.filter((v) => !varNames.includes(v.name)).map((v) => v.name);
  if (unknownVars.length) problems.push(`variables: no column ${unknownVars.join(", ")} in the data.`);

  const questions = (Array.isArray(input.questions) ? input.questions : []).map(str).filter(Boolean);
  if (questions.length > MAX_QUESTIONS) problems.push(`at most ${MAX_QUESTIONS} questions (got ${questions.length}).`);

  if (problems.length) throw new GuideError(problems);
  return {
    runId: result.runId,
    question: str(input.question),
    questions,
    variables,
    hints,
    ask: ask || undefined,
    createdAt: new Date().toISOString(),
  };
}

/** The held-out data frame the exploration saved, if it kept rows back. */
function holdoutName(inst: AnalysisInstance): string | undefined {
  const h = inst.options?.holdout;
  return h?.enabled ? str(h.saveAs) || "explore_holdout" : undefined;
}
