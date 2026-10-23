// Hint cards (e.g. 탐색 안내): open a suggested analysis with its options, or
// hand a card to the assistant.

import type { AnalysisHint, AnalysisInstance, AnalysisSuggestion } from "@rsage/shared";
import { host } from "./host/client";
import { useStore } from "./store";
import { allCommands } from "./commands";
import { send, useAssistant } from "./assistant";
import { findDef, insertText, openAnalysisTab, useAnalyses } from "./analysis";
import { explorationLog } from "./explorationLog";

const notify = (msg: string, kind?: "error") => useStore.getState().notify(msg, kind);

/** Whether the app has the analysis a suggestion names (otherwise it is planned). */
export function suggestionAvailable(s: AnalysisSuggestion): boolean {
  return !!findDef(s.analysis);
}

/** A new analysis tab on the same data, with the suggestion's options. */
export async function openSuggestion(inst: AnalysisInstance, s: AnalysisSuggestion, hint?: string) {
  try {
    const created = await host.call("analysis.create", {
      analysis: s.analysis,
      dataset: s.dataset ?? inst.dataset,
      options: s.options,
      title: s.title,
      reuse: true,
      from: { analysis: inst.id, hint },
    });
    useAnalyses.setState((st) => ({ instances: { ...st.instances, [created.id]: created } }));
    openAnalysisTab(created.id);
  } catch (e: any) {
    notify(e?.message ?? String(e), "error");
  }
}

/** Analyses whose tab offers assistant-written hints (질문 칸, 힌트 받기). */
const GUIDED = new Set(["org.rsage.explore/explore"]);

export const guideAvailable = (inst: AnalysisInstance) => GUIDED.has(inst.analysis) && !!inst.result;

export function showAssistant() {
  allCommands().find((x) => x.id === "view.assistant")?.run();
}

/** Asks the assistant to write hint cards for the user's question onto the tab. */
export async function requestGuide(inst: AnalysisInstance, question: string) {
  const q = question.trim();
  const parts = [
    q ? `탐색 안내 결과를 이 질문에 맞춰 정리해 주세요: ${q}` : "탐색 안내 결과를 보고 이 데이터에서 먼저 볼 것을 정리해 주세요.",
    "",
    `분석: ${inst.title} (analysis_id ${inst.id}, 데이터 ${inst.dataset})`,
    "",
    `get_analysis_result로 신호 표를 읽고 set_exploration_hints로 카드, 물어볼 만한 질문, 변수 뜻 추측을 탭에 써 주세요 (question에는 ${q ? "위 질문" : "빈 문자열"}). 다른 분석은 실행하지 마세요.`,
  ];
  showAssistant();
  if (!useAssistant.getState().model) return notify("AI 조수에서 모델을 먼저 고르세요.", "error");
  await send(parts.join("\n"));
}

export async function clearGuide(inst: AnalysisInstance) {
  try {
    const next = await host.call("analysis.clearGuide", { id: inst.id });
    useAnalyses.setState((st) => ({ instances: { ...st.instances, [next.id]: next } }));
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
  showAssistant();
  if (!useAssistant.getState().model) return notify("AI 조수에서 모델을 먼저 고르세요.", "error");
  await send(parts.join("\n"));
}

/** Writes the exploration log (cards, question, analyses opened from them, the R chunk) into the open .qmd. */
export async function insertExplorationLog(inst: AnalysisInstance) {
  try {
    const code = await host.call("analysis.code", { id: inst.id });
    const all = Object.values(useAnalyses.getState().instances);
    insertText((qmd, doc) => (qmd ? explorationLog(inst, all, code, new Date(), doc) : null), "탐색 기록을");
  } catch (e: any) {
    notify(e?.message ?? String(e), "error");
  }
}

/** Opens 탐색 안내 on a data frame (the same tab again if nothing changed). */
export async function exploreDataset(dataset: string) {
  try {
    const created = await host.call("analysis.create", { analysis: "org.rsage.explore/explore", dataset, reuse: true });
    useAnalyses.setState((st) => ({ instances: { ...st.instances, [created.id]: created } }));
    openAnalysisTab(created.id);
    if (!created.result && created.lastRun?.status !== "running") await host.call("analysis.run", { id: created.id });
  } catch (e: any) {
    notify(e?.message ?? String(e), "error");
  }
}
