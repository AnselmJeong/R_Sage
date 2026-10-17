import { describe, expect, test } from "bun:test";
import { canModify, convertCode, factorCode, renameCode, rName } from "../src/dataviewer/rcode";

describe("data viewer R code", () => {
  test("backquotes names that are not syntactic", () => {
    expect(rName("age")).toBe("age");
    expect(rName("my col")).toBe("`my col`");
    expect(rName("if")).toBe("`if`");
    expect(rName("2nd")).toBe("`2nd`");
  });

  test("only bindings can be modified", () => {
    expect(canModify("df")).toBe(true);
    expect(canModify("head(df)")).toBe(false);
  });

  test("type conversions", () => {
    expect(convertCode("df", "x", "numeric", "dbl")).toBe("df$x <- as.numeric(df$x)");
    expect(convertCode("df", "my x", "character")).toBe("df$`my x` <- as.character(df$`my x`)");
    // Factors convert through their labels, not their codes.
    expect(convertCode("df", "g", "numeric", "fct")).toBe("df$g <- as.numeric(as.character(df$g))");
    expect(convertCode("df", "g", "factor", "chr")).toBe("df$g <- factor(df$g)");
  });

  test("factor with levels and labels", () => {
    const levels = [
      { value: "2", label: "female" },
      { value: "1", label: "male" },
    ];
    expect(factorCode("df", "sex", levels, { numeric: true, ordered: false })).toBe(
      'df$sex <- factor(df$sex, levels = c(2, 1), labels = c("female", "male"))',
    );
    expect(factorCode("df", "grade", [{ value: "low", label: "low" }, { value: "high", label: "high" }], { numeric: false, ordered: true })).toBe(
      'df$grade <- factor(df$grade, levels = c("low", "high"), ordered = TRUE)',
    );
  });

  test("rename", () => {
    expect(renameCode("df", "a b", "ab")).toBe('names(df)[names(df) == "a b"] <- "ab"');
  });
});
