// Hint cards (e.g. 탐색 안내): open a suggested analysis with its options, or
// hand a card to the assistant.

import type { AnalysisHint, AnalysisInstance, AnalysisSuggestion } from "@rsage/shared";
import { host } from "./host/client";
import { useStore } from "./store";
import { allCommands } from "./commands";
import { send, useAssistant } from "./assistant";
import { findDef, openAnalysisTab, useAnalyses } from "./analysis";

const notify = (msg: string, kind?: "error") => useStore.getState().notify(msg, kind);

/** Whether the app has the analysis a suggestion names (otherwise it is planned). */
export function suggestionAvailable(s: AnalysisSuggestion): boolean {
  return !!findDef(s.analysis);
}

/** A new analysis tab on the same data, with the suggestion's options. */
export async function openSuggestion(inst: AnalysisInstance, s: AnalysisSuggestion) {
  try {
    const created = await host.call("analysis.create", { analysis: s.analysis, dataset: inst.dataset, options: s.options, title: s.title, reuse: true });
    useAnalyses.setState((st) => ({ instances: { ...st.instances, [created.id]: created } }));
    openAnalysisTab(created.id);
  } catch (e: any) {
    notify(e?.message ?? String(e), "error");
  }
}

/** Asks the assistant how to follow up one card. */
export async function askAboutHint(inst: AnalysisInstance, h: AnalysisHint) {
  const parts = [
    "탐색 안내의 이 카드를 더 살펴보고 싶어요.",
    "",
    `분석: ${inst.title} (analysis_id ${inst.id}, 데이터 ${inst.dataset})`,
    `카드: ${h.title}${h.evidence ? ` (${h.evidence})` : ""}`,
    h.text,
    "",
    "get_analysis_result로 결과를 읽고, 이 신호가 무엇을 뜻할 수 있는지와 어떻게 확인하면 좋을지 알려 주세요. 탐색 결과이므로 원인이라고 말하지 말고, 필요하면 맞는 분석을 run_analysis로 제안해 주세요.",
  ];
  allCommands().find((x) => x.id === "view.assistant")?.run();
  if (!useAssistant.getState().model) return notify("AI 조수에서 모델을 먼저 고르세요.", "error");
  await send(parts.join("\n"));
}
