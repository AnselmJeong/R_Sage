import { describe, expect, test } from "bun:test";
import { customPolicy, displayScale, fileStem, parseCustom, plotSize, toInches, fromInches } from "../src/plotSizing";

describe("plot sizing", () => {
  const v = { width: 800, height: 600 };
  test("fill and auto use the pane", () => {
    expect(plotSize("fill", v)).toEqual(v);
    expect(plotSize("auto", v)).toEqual(v);
  });
  test("auto keeps a sane aspect in very wide or tall panes", () => {
    expect(plotSize("auto", { width: 2000, height: 400 })).toEqual({ width: 647, height: 400 });
    expect(plotSize("auto", { width: 300, height: 1200 })).toEqual({ width: 300, height: 485 });
  });
  test("square, landscape, portrait fit inside", () => {
    expect(plotSize("square", v)).toEqual({ width: 600, height: 600 });
    expect(plotSize("landscape", { width: 1000, height: 600 })).toEqual({ width: 800, height: 600 });
    expect(plotSize("portrait", v)).toEqual({ width: 450, height: 600 });
  });
  test("intrinsic and custom sizes ignore the pane", () => {
    expect(plotSize("intrinsic", v, { width: 672, height: 480 })).toEqual({ width: 672, height: 480 });
    expect(plotSize("intrinsic", v)).toEqual(v);
    const c = customPolicy({ width: 1200, height: 900 });
    expect(parseCustom(c)).toEqual({ width: 1200, height: 900 });
    expect(plotSize(c, v)).toEqual({ width: 1200, height: 900 });
  });
  test("fit only shrinks; fixed zooms scale", () => {
    expect(displayScale("fit", { width: 1200, height: 900 }, v)).toBeCloseTo(2 / 3);
    expect(displayScale("fit", { width: 400, height: 300 }, v)).toBe(1);
    expect(displayScale(2, { width: 400, height: 300 }, v)).toBe(2);
  });
  test("units and file names", () => {
    expect(toInches(192, "px")).toBe(2);
    expect(fromInches(2, "cm")).toBeCloseTo(5.08);
    expect(fileStem("ggplot2 box plot 1")).toBe("ggplot2-box-plot-1");
    expect(fileStem(" a/b: c ")).toBe("a-b-c");
    expect(fileStem("  ")).toBe("plot");
  });
});
