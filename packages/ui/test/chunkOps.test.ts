import { expect, test } from "bun:test";
import { cellLabel, copyCell, mergeCellCode, readCellOptions, setCellOptions, splitCellCode, stripCellOptions } from "../src/quarto/chunkOps";

const code = "#| label: fig-a\n#| echo: false\nplot(x)\n# a comment\nsummary(x)";

test("reads leading #| options only", () => {
  expect(readCellOptions(code)).toEqual({ label: "fig-a", echo: "false" });
  expect(readCellOptions("x <- 1\n#| echo: false")).toEqual({});
  expect(readCellOptions("")).toEqual({});
});

test("sets, replaces and removes options in place", () => {
  expect(setCellOptions(code, { echo: "true" })).toBe("#| label: fig-a\n#| echo: true\nplot(x)\n# a comment\nsummary(x)");
  expect(setCellOptions(code, { echo: undefined, "fig-width": "6" })).toBe("#| label: fig-a\n#| fig-width: 6\nplot(x)\n# a comment\nsummary(x)");
  expect(setCellOptions("plot(x)", { label: "a" })).toBe("#| label: a\nplot(x)");
  expect(setCellOptions("", { echo: "false" })).toBe("#| echo: false");
  expect(setCellOptions("#| echo: false", { echo: "" })).toBe("");
  // Lines that are not key: value stay.
  expect(setCellOptions("#| fig-cap: |\n#|   long\nx", { echo: "false" })).toBe("#| fig-cap: |\n#|   long\n#| echo: false\nx");
});

test("strips options", () => {
  expect(stripCellOptions(code)).toBe("plot(x)\n# a comment\nsummary(x)");
});

test("finds the label in options or the knitr header", () => {
  expect(cellLabel("{r}", code)).toBe("fig-a");
  expect(cellLabel("{r setup, include=FALSE}", "x")).toBe("setup");
  expect(cellLabel("{r setup}", "x")).toBe("setup");
  expect(cellLabel("{r, echo=FALSE}", "x")).toBeUndefined();
  expect(cellLabel("{r echo=FALSE}", "x")).toBeUndefined();
});

test("a copy gets a fresh label", () => {
  expect(copyCell("{r}", code, new Set(["fig-a"])).code.split("\n")[0]).toBe("#| label: fig-a-2");
  expect(copyCell("{r}", code, new Set(["fig-a", "fig-a-2"])).code.split("\n")[0]).toBe("#| label: fig-a-3");
  expect(copyCell("{r setup, include=FALSE}", "x", new Set(["setup"])).header).toBe("{r setup-2, include=FALSE}");
  expect(copyCell("{r}", "x", new Set())).toEqual({ header: "{r}", code: "x" });
});

test("splits before a line, keeping options in the first part", () => {
  expect(splitCellCode(code, 4)).toEqual(["#| label: fig-a\n#| echo: false\nplot(x)", "# a comment\nsummary(x)"]);
  expect(splitCellCode("a\n\nb", 2)).toEqual(["a", "b"]);
  expect(splitCellCode(code, 3)).toBeNull(); // nothing but options above
  expect(splitCellCode("a\nb", 1)).toBeNull();
  expect(splitCellCode("a\n\n", 2)).toBeNull();
});

test("merges code, dropping the second chunk's options", () => {
  expect(mergeCellCode("#| echo: false\nx <- 1\n", "#| label: b\ny <- 2")).toBe("#| echo: false\nx <- 1\n\ny <- 2");
  expect(mergeCellCode("x", "#| echo: false")).toBe("x");
  expect(mergeCellCode("", "y")).toBe("y");
  expect(mergeCellCode("#| echo: false", "y")).toBe("#| echo: false\ny");
});
