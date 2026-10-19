import { expect, test } from "bun:test";
import { qmdRChunks } from "../src/editor/rchunks";

test("finds R chunks and the line of their first code line", () => {
  const qmd = ["---", "title: x", "---", "", "```{r}", "x <- 1", "```", "", "```{python}", "y = 2", "```", "", "````{r, echo=FALSE}", "#| label: fig", "plot(x)", "summary(x)", "````", "``` {r}", "```"].join("\n");
  expect(qmdRChunks(qmd)).toEqual([
    { start: 5, code: "x <- 1" },
    { start: 13, code: "#| label: fig\nplot(x)\nsummary(x)" },
    { start: 18, code: "" },
  ]);
});
