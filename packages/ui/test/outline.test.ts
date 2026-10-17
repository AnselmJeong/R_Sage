import { expect, test } from "bun:test";
import { blockAtLine, qmdOutline, rOutline } from "../src/outline";

const QMD = `---
title: "분석 보고서"
---

\`\`\`{r}
library(dplyr)
\`\`\`

## 1. 데이터 준비 {#sec-data}

본문.

\`\`\`{r}
#| label: load
d <- read.csv("a.csv")
\`\`\`

### 1.1 정리

\`\`\`{r}
x <- 1
\`\`\`

::: {.callout-note}
### 참고
:::

## 2. 결과
`;

test("qmd outline nests cells under headings and keeps lines", () => {
  const o = qmdOutline(QMD);
  expect(o.map((i) => [i.kind, i.label])).toEqual([
    ["meta", "문서 정보"],
    ["cell", "코드 셀"],
    ["heading", "1. 데이터 준비"],
    ["heading", "2. 결과"],
  ]);
  expect(o[0]!.detail).toBe("분석 보고서");
  expect(o[1]!.line).toBe(5);
  const sec1 = o[2]!;
  expect(sec1.line).toBe(9);
  expect(sec1.children.map((c) => [c.kind, c.label, c.detail])).toEqual([
    ["cell", "코드 셀", "load"],
    ["heading", "1.1 정리", undefined],
    ["heading", "참고", undefined],
  ]);
  expect(sec1.children[1]!.children[0]!.detail).toBe("x <- 1");
  expect(o[3]!.line).toBe(28);
  // Block indexes line up with the visual editor's top-level nodes.
  expect(blockAtLine(QMD, sec1.line)).toBe(sec1.block!);
  expect(blockAtLine(QMD, 16)).toBe(sec1.children[0]!.block!);
});

test("R outline finds sections and functions", () => {
  const o = rOutline("# Load ----\nf <- function(x) x\n## Sub ====\ng = function() 1\n# Plot ####\n");
  expect(o.map((i) => i.label)).toEqual(["Load", "Plot"]);
  expect(o[0]!.children.map((c) => [c.kind, c.label])).toEqual([
    ["function", "f"],
    ["section", "Sub"],
  ]);
  expect(o[0]!.children[1]!.children[0]!.label).toBe("g");
});

test("cross-reference targets", async () => {
  const { xrefTargets } = await import("../src/quarto/xref");
  const t = xrefTargets(`## 방법 {#sec-methods}

\`\`\`{r}
#| label: fig-mpg
#| fig-cap: "연비 분포"
hist(1)
\`\`\`

![산점도](a.png){#fig-scatter}

$$
y = x
$$ {#eq-line}

\`\`\`{r}
#| label: setup
\`\`\`
`);
  expect(t.map((x) => [x.id, x.context])).toEqual([
    ["sec-methods", "방법"],
    ["fig-mpg", "연비 분포"],
    ["fig-scatter", "산점도"],
    ["eq-line", "y = x"],
  ]);
});
