import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findAir, formatDocument } from "../src/format";

(findAir() ? test : test.skip)("formats R chunks of a qmd and leaves the prose alone", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rsage-fmt-"));
  const qmd = ["# 제목", "", "x<-1 이라는 문장은 그대로", "", "```{r}", "#| label: a", "x<-c(1,2,3)", "```", "", "```{r}", "y <- (", "```", ""].join("\n");
  const r = await formatDocument(join(dir, "a.qmd"), qmd);
  expect(r.text).toBe(qmd.replace("x<-c(1,2,3)", "x <- c(1, 2, 3)"));
  expect(r.failed).toBe(1);
  const R = await formatDocument(join(dir, "a.R"), "f<-function(a,b){a+b}\n");
  expect(R.text).toBe("f <- function(a, b) {\n  a + b\n}\n");
});
