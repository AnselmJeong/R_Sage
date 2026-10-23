import { describe, expect, test } from "bun:test";
import { definesData, insertLineAfter, uniqueLabel } from "../src/docInsert";
import { explorationLog, shownHints } from "../src/explorationLog";

const card = (id: string, title: string, extra: any = {}) => ({ id, title, text: `${title} 설명`, evidence: "ρ = 0.48, n = 118", variables: [], suggestions: [], ...extra });
const inst: any = {
  id: "a-x1",
  analysis: "org.rsage.explore/explore",
  dataset: "study",
  createdAt: "2026-10-23T00:00:00Z",
  result: { runId: "r1", hints: [card("s01", "수면과 우울")], tables: [], plots: [] },
};
const follow = (id: string, from: any, status = "ok", createdAt = "2026-10-23T01:00:00Z"): any => ({ id, title: `회귀 ${id}`, analysis: "org.rsage.regression/regression", dataset: "study", createdAt, from, lastRun: { status } });

describe("exploration log", () => {
  test("rule cards, analyses opened from them, and the chunk", () => {
    const all = [inst, follow("a-2", { analysis: "a-x1", hint: "s01" }), follow("a-3", { analysis: "a-other" }), follow("a-4", { analysis: "a-x1" }, "error", "2026-10-23T02:00:00Z")];
    const md = explorationLog(inst, all, 'res <- rsageExplore::analyse(study)', new Date("2026-10-23T05:00:00Z"));
    expect(md).toContain("## 탐색 기록: study");
    expect(md).toContain("> 2026-10-23 탐색 안내로");
    expect(md).toContain("확인할 가설");
    expect(md).toContain("1. **수면과 우울** (ρ = 0.48, n = 118). 수면과 우울 설명");
    expect(md).toContain("- 회귀 a-2 (카드: 수면과 우울), 실행함\n- 회귀 a-4, 실행 실패");
    expect(md).not.toContain("a-3");
    expect(md).toContain("```{r}\n#| label: explore-x1\n");
    expect(md).toContain("res <- rsageExplore::analyse(study)\n```");
  });

  test("the assistant's cards and question when they match the result", () => {
    const g = { runId: "r1", question: "우울 요인", questions: [], variables: [], hints: [card("g1", "잠이 짧으면")], createdAt: "" };
    expect(shownHints({ ...inst, guide: g }).hints[0]!.id).toBe("g1");
    expect(explorationLog({ ...inst, guide: g }, [], "x")).toContain("**질문**: 우울 요인");
    // A guide for an older run is not what the tab shows first.
    expect(shownHints({ ...inst, guide: { ...g, runId: "r0" } }).hints[0]!.id).toBe("s01");
  });
});

describe("where text goes in a .qmd", () => {
  const doc = ["---", "title: 보고서", "---", "", "본문", "```{r}", "x <- 1", "```", "끝"];
  test("past the YAML header and the chunk the cursor is in", () => {
    expect(insertLineAfter(doc, 1)).toBe(3);
    expect(insertLineAfter(doc, 2)).toBe(3);
    expect(insertLineAfter(doc, 5)).toBe(5);
    expect(insertLineAfter(doc, 7)).toBe(8);
    expect(insertLineAfter(doc, 9)).toBe(9);
    expect(insertLineAfter(["본문", "---", "x"], 2)).toBe(2);
  });
});

describe("a log that renders", () => {
  test("a second log gets its own chunk label", () => {
    const first = explorationLog(inst, [], "x", new Date(), "");
    expect(uniqueLabel(first, "explore-x1")).toBe("explore-x1-2");
    expect(explorationLog(inst, [], "x", new Date(), first + first.replace("explore-x1", "explore-x1-2"))).toContain("#| label: explore-x1-3");
    expect(uniqueLabel("```{r explore-x1}\n```", "explore-x1")).toBe("explore-x1-2");
  });

  test("says where the data must come from when the document does not make it", () => {
    expect(explorationLog(inst, [], "x", new Date(), "")).toContain("R 세션의 데이터 `study`를 씁니다");
    expect(explorationLog(inst, [], "x", new Date(), '```{r}\nstudy <- read.csv("s.csv")\n```')).not.toContain("R 세션의 데이터");
    expect(definesData("study2 <- x", "study")).toBe(false);
    expect(definesData("my.study <- x", "study")).toBe(false);
    expect(definesData("study = readRDS(f)", "study")).toBe(true);
    expect(definesData("study == 1", "study")).toBe(false);
    expect(definesData("x |> filter() -> study", "study")).toBe(true);
  });
});
