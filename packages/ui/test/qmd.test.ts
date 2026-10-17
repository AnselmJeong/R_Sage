import { expect, test } from "bun:test";
import { parseQmd, serializeBlock, toQmd, withBaselines, type PMNode } from "../src/quarto/qmd";

const SAMPLE = `---
title: "펭귄 분석"
format:
  html:
    toc: true
bibliography: refs.bib
---

## 데이터 {#sec-data}

이 보고서는 **palmerpenguins** 데이터를 *간단히* 살펴봅니다 [@horst2020].
변수는 \`species\`, \`bill_length_mm\` 등이고 snake_case 이름을 씁니다.

\`\`\`{r}
#| label: fig-bill
#| fig-cap: "부리 길이"
library(ggplot2)
ggplot(penguins, aes(bill_length_mm)) + geom_histogram()
\`\`\`

::: {.callout-note}
## 참고

콜아웃은 원문 그대로 둡니다.
:::

- 첫째 항목
- 둘째 항목
  - 안쪽 항목

1. 하나
2. 둘

| 종 | 수 |
|:---|---:|
| Adelie | 152 |
| Gentoo | 124 |

: 종별 개체 수 {#tbl-n}

$$
\\bar{x} = \\frac{1}{n}\\sum x_i
$$

인라인 수식 $x^2$ 과 [링크](https://quarto.org "Quarto")와 ![그림](fig.png){#fig-x}.

\`\`\`{python}
print("python stays raw")
\`\`\`

<div>raw html</div>

각주가 있는 문장[^1].

[^1]: 각주 내용.

> 인용문
> 둘째 줄

{{< pagebreak >}}

* * *

\`\`\`bash
echo plain code
\`\`\`
`;

const load = (text: string) => {
  const p = parseQmd(text);
  return { doc: withBaselines(p.doc), trailing: p.trailing };
};

test("an untouched document comes back byte for byte", () => {
  for (const text of [SAMPLE, SAMPLE.trimEnd(), "", "Just text", "\n\n# Title\n\n\n\nBody\n\n\n", "::: {.x}\nunclosed div\n"]) {
    const { doc, trailing } = load(text);
    expect(toQmd(doc, trailing)).toBe(text);
  }
});

test("blocks map to editor nodes; unsupported syntax stays raw", () => {
  const { doc } = load(SAMPLE);
  const types = doc.content!.map((n) => n.type);
  expect(types[0]).toBe("frontMatter");
  expect(types).toContain("rCell");
  expect(types).toContain("table");
  expect(types).toContain("mathBlock");
  expect(types).toContain("codeBlock");
  const raws = doc.content!.filter((n) => n.type === "rawBlock").map((n) => n.attrs!.text.split("\n")[0]);
  expect(raws).toEqual(["::: {.callout-note}", "```{python}", "<div>raw html</div>", "[^1]: 각주 내용."]);
  const cell = doc.content!.find((n) => n.type === "rCell")!;
  expect(cell.attrs!.header).toBe("{r}");
  expect(cell.attrs!.code.startsWith("#| label: fig-bill")).toBe(true);
});

test("editing one block rewrites only that block", () => {
  const { doc, trailing } = load(SAMPLE);
  const para = doc.content!.find((n) => n.type === "paragraph")!;
  para.content = [...para.content!, { type: "text", text: " 추가 문장." }];
  const out = toQmd(doc, trailing);
  expect(out).toContain("[@horst2020]");
  expect(out).toContain("추가 문장.");
  // Everything after the edited paragraph is untouched.
  const tailFrom = SAMPLE.indexOf("```{r}");
  expect(out.endsWith(SAMPLE.slice(tailFrom))).toBe(true);
  // And it parses back to the same content.
  const again = parseQmd(out).doc.content!.find((n) => n.type === "paragraph")!;
  expect(serializeBlock(again)).toBe(serializeBlock(para));
});

test("new blocks serialize as clean markdown", () => {
  const doc: PMNode = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "결과" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "평균은 " },
          { type: "text", text: "5.2", marks: [{ type: "bold" }] },
          { type: "text", text: " 입니다 ", marks: [{ type: "italic" }] },
          { type: "text", text: "(file_name, a*b)" },
          { type: "text", text: "링크", marks: [{ type: "link", attrs: { href: "https://x.org" } }, { type: "bold" }] },
        ],
      },
      { type: "rCell", attrs: { header: "{r}", code: "summary(x)" } },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }] },
    ],
  };
  expect(toQmd(doc)).toBe("## 결과\n\n평균은 **5.2** *입니다* (file_name, a\\*b)[**링크**](https://x.org)\n\n```{r}\nsummary(x)\n```\n\n- a\n");
});

test("inline notes and note references are inline nodes that round-trip", () => {
  const src = "본문에 각주가 있습니다.^[이것은 각주입니다.] 그리고 참조[^n1]도 있습니다.\n\n[^n1]: 정의된 각주.\n";
  const { doc, trailing } = parseQmd(src);
  const para = doc.content![0]!;
  expect(para.type).toBe("paragraph");
  expect(para.content!.map((n) => n.type)).toEqual(["text", "footnote", "text", "footnoteRef", "text"]);
  expect(para.content![1]!.attrs!.text).toBe("이것은 각주입니다.");
  expect(doc.content![1]!.type).toBe("rawBlock");
  expect(toQmd(withBaselines(doc), trailing)).toBe(src);
  // An edited paragraph still writes the notes back.
  para.content![0] = { type: "text", text: "바뀐 문장." };
  expect(toQmd(doc, trailing).split("\n")[0]).toBe("바뀐 문장.^[이것은 각주입니다.] 그리고 참조[^n1]도 있습니다.");
});
