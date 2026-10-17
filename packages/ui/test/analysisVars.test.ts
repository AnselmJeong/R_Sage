import { describe, expect, test } from "bun:test";
import { accepts, lastUsed, varKind } from "../src/analysisVars";

describe("lastUsed", () => {
  const names = ["aq", "mt", "aq2"];
  test("picks the data frame used last in the code", () => {
    expect(lastUsed("aq <- airquality\nsummary(mt)", names)).toBe("mt");
    expect(lastUsed("x <- mt$mpg\nmodel <- lm(Ozone ~ Wind, data = aq)", names)).toBe("aq");
  });
  test("matches whole names only, not columns, strings or comments", () => {
    expect(lastUsed("aq2$x", names)).toBe("aq2");
    expect(lastUsed("df$aq + 1", names)).toBeNull();
    expect(lastUsed('print("mt")\n# mt is old', names)).toBeNull();
    expect(lastUsed("my.aq <- 1; aq_x <- 2", names)).toBeNull();
  });
  test("handles names with dots", () => {
    expect(lastUsed("summary(my.data)", ["my.data", "data"])).toBe("my.data");
  });
});

describe("variable types", () => {
  test("groups R classes", () => {
    expect(varKind("integer")).toBe("numeric");
    expect(varKind("ordered")).toBe("ordered");
    expect(varKind("POSIXct")).toBe("date");
  });
  test("role boxes accept their types", () => {
    expect(accepts(undefined, "character")).toBe(true);
    expect(accepts(["numeric"], "integer")).toBe(true);
    expect(accepts(["numeric"], "factor")).toBe(false);
    expect(accepts(["factor"], "ordered")).toBe(true);
    expect(accepts(["ordered"], "factor")).toBe(false);
  });
});
