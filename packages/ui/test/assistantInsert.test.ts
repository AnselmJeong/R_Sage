import { describe, expect, test } from "bun:test";
import { aroundRun, piecesForRun, piecesForTurn, renderPieces, runsInTurn, turnOf } from "../src/assistantInsert";

const at = "2026-11-20T00:00:00Z";
const user = (id: string, text: string): any => ({ kind: "user", id, text, at });
const say = (id: string, text: string): any => ({ kind: "assistant", id, text, model: "m", at });
const run = (id: string, code: string, status = "done"): any => ({ kind: "tool", id, name: "run_r", input: { code, purpose: "p" }, status, at });
const other = (id: string): any => ({ kind: "tool", id, name: "get_variables", input: {}, status: "done", at });

const items = [
  user("u1", "이전 질문"),
  say("a0", "이전 답"),
  run("r0", "old()"),
  user("u2", "그래프를 그려 줘"),
  say("a1", "왼쪽에 막대를 그리겠습니다."),
  other("g1"),
  run("r1", "bad(", "error"),
  say("a2", "고쳐서 다시 실행합니다."),
  run("r2", "p <- plot(x)\n"),
  say("a3", "**막대그래프**를 그렸습니다."),
  run("r3", "summary(x)"),
  say("a4", "요약입니다."),
  user("u3", "고마워"),
];

describe("assistant run → document", () => {
  test("the answer holding a run stops at user messages", () => {
    expect(turnOf(items, "r2").map((i) => i.id)).toEqual(["a1", "g1", "r1", "a2", "r2", "a3", "r3", "a4"]);
    expect(runsInTurn(items, "r2")).toBe(2);
  });

  test("explanation around a run goes up to the neighbouring successful runs; failed tries are crossed", () => {
    expect(aroundRun(items, "r2")).toEqual({ before: "왼쪽에 막대를 그리겠습니다.\n\n고쳐서 다시 실행합니다.", after: "**막대그래프**를 그렸습니다." });
    // Text between two runs is only the earlier run's "after".
    expect(aroundRun(items, "r3")).toEqual({ before: "", after: "요약입니다." });
  });

  test("one run as a qmd chunk with text", () => {
    const text = renderPieces(piecesForRun(items, "r2", { before: false, after: true }), true);
    expect(text).toBe("\n\n```{r}\np <- plot(x)\n```\n\n**막대그래프**를 그렸습니다.");
  });

  test("whole answer leaves failed runs out", () => {
    const text = renderPieces(piecesForTurn(items, "r3"), true);
    expect(text).not.toContain("bad(");
    expect(text.indexOf("plot(x)")).toBeLessThan(text.indexOf("summary(x)"));
    expect(text).toContain("요약입니다.");
  });

  test("an R script gets the explanation as comments", () => {
    const text = renderPieces(piecesForRun(items, "r3", { before: true, after: true }), false);
    expect(text).toBe("\n\nsummary(x)\n\n# 요약입니다.");
  });
});
