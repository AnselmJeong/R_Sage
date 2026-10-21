import { describe, expect, test } from "bun:test";
import { applyFigureConversion } from "@rsage/shared";

const doc = [
  "---",
  "title: t",
  "---",
  "",
  "```{r}",
  "#| label: setup",
  "library(ggplot2)",
  "```",
  "",
  "```{r}",
  "#| label: fig-a",
  "d <- head(mtcars)",
  "ggplot(d, aes(wt, mpg)) +",
  "  geom_point()",
  "```",
].join("\n");

const run = "d <- head(mtcars)\nggplot(d, aes(wt, mpg)) +\n  geom_point()";
const tp = "d |>\n  tidyplot(x = wt, y = mpg) |>\n  add_data_points()";

describe("applyFigureConversion", () => {
  test("replaces the target lines and loads tidyplots in the setup chunk", () => {
    const r = applyFigureConversion(doc, run, { first_line: 2, last_line: 3 }, tp)!;
    expect(r.addedLibrary).toBe(true);
    const lines = r.text.split("\n");
    expect(lines.slice(5, 8)).toEqual(["#| label: setup", "library(ggplot2)", "library(tidyplots)"]);
    expect(r.text).toContain("#| label: fig-a\nd <- head(mtcars)\nd |>\n  tidyplot(x = wt, y = mpg) |>\n  add_data_points()\n```");
    expect(lines[r.line - 1]).toBe("d |>");
  });

  test("works when the run code included the chunk options", () => {
    const r = applyFigureConversion(doc, "#| label: fig-a\n" + run, { first_line: 3, last_line: 4 }, tp)!;
    expect(r.text).toContain("d <- head(mtcars)\nd |>");
    expect(r.text).not.toContain("geom_point");
  });

  test("leaves an existing library(tidyplots) alone", () => {
    const withLib = doc.replace("library(ggplot2)", "library(ggplot2)\nlibrary(tidyplots)");
    const r = applyFigureConversion(withLib, run, { first_line: 2, last_line: 3 }, tp)!;
    expect(r.addedLibrary).toBe(false);
    expect(r.text.match(/library\(tidyplots\)/g)!.length).toBe(1);
  });

  test("returns null when the code is gone", () => {
    expect(applyFigureConversion(doc, "plot(1)", { first_line: 1, last_line: 1 }, tp)).toBeNull();
  });
});
