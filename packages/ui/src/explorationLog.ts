// The exploration log (탐색 기록): what 탐색 안내 found and which analyses
// were opened from it, written into the user's .qmd as Markdown with the
// analysis chunk, so the report keeps the path from exploration to the
// analyses that followed and says plainly that the cards are hypotheses.

import type { AnalysisHint, AnalysisInstance } from "@rsage/shared";
import { definesData, uniqueLabel } from "./docInsert";

/** The cards the tab shows first: the assistant's for this result, else the rule cards. */
export function shownHints(inst: AnalysisInstance): { hints: AnalysisHint[]; question?: string } {
  const g = inst.guide;
  if (g?.hints.length && g.runId === inst.result?.runId) return { hints: g.hints, question: g.question || undefined };
  return { hints: inst.result?.hints ?? [] };
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function explorationLog(inst: AnalysisInstance, all: AnalysisInstance[], code: string, date = new Date(), doc = ""): string {
  const { hints, question } = shownHints(inst);
  const day = date.toISOString().slice(0, 10);
  // Starts with a blank line: the text goes at the end of the cursor's line.
  const out = [
    "",
    "",
    `## 탐색 기록: ${inst.dataset}`,
    "",
    // A quote, not a callout: the visual editor shows callouts only as raw blocks.
    `> ${day} 탐색 안내로 살펴본 결과입니다. 여러 변수와 조합을 한꺼번에 본 탐색이므로, 아래 내용은 확인할 가설입니다.`,
    "",
  ];
  // The chunk uses the data frame from the R session; a rendered document must make it itself.
  if (!definesData(doc, inst.dataset))
    out.splice(out.length - 1, 0, ">", `> 아래 청크는 R 세션의 데이터 \`${inst.dataset}\`를 씁니다. 문서를 렌더하려면 이 앞의 청크에서 \`${inst.dataset}\`를 읽어 들이세요.`);
  if (question) out.push(`**질문**: ${oneLine(question)}`, "");
  if (hints.length) {
    out.push("**살펴볼 만한 것**", "");
    hints.forEach((h, i) => out.push(`${i + 1}. **${oneLine(h.title)}**${h.evidence ? ` (${oneLine(h.evidence)})` : ""}. ${oneLine(h.text)}`));
    out.push("");
  }
  const followed = all.filter((a) => a.from?.analysis === inst.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (followed.length) {
    out.push("**이어서 연 분석**", "");
    for (const a of followed) {
      const card = a.from?.hint ? hints.find((h) => h.id === a.from!.hint) : undefined;
      const state = a.lastRun?.status === "ok" ? "실행함" : a.lastRun?.status === "error" ? "실행 실패" : "아직 실행 안 함";
      out.push(`- ${oneLine(a.title)}${card ? ` (카드: ${oneLine(card.title)})` : ""}, ${state}`);
    }
    out.push("");
  }
  out.push("```{r}", `#| label: ${uniqueLabel(doc, `explore-${inst.id.replace(/^a-/, "")}`)}`, "# 탐색 결과: 확인할 가설로 읽으세요", code, "```", "");
  return out.join("\n");
}
