import { describe, expect, test } from "bun:test";
import { columnValuesCode, parseColumnValues } from "../src/dataviewer";

const hasR = !!Bun.which("Rscript");

async function run(setup: string, column: string, limit = 1000) {
  const code = `${setup}\n${columnValuesCode("df", column, limit)}`;
  const p = Bun.spawn(["Rscript", "-e", code], { stdout: "pipe", stderr: "pipe", env: { ...process.env, LANG: "C.UTF-8" } });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return parseColumnValues(out);
}

describe("column values for the factor dialog", () => {
  test.skipIf(!hasR)("factor levels keep their order", async () => {
    const r = await run('df <- data.frame(g = factor(c("lo", "hi", "lo"), levels = c("lo", "hi")))', "g");
    expect(r).toEqual({ factor: true, ordered: false, numeric: false, total: 2, values: ["lo", "hi"] });
  });

  test.skipIf(!hasR)("numbers are sorted, NA dropped, quotes survive", async () => {
    const r = await run('df <- data.frame(x = c(3, 1, NA, 2, 1), s = c("a\\"b", "한글", "a\\"b", NA, "c"))', "x");
    expect(r).toEqual({ factor: false, ordered: false, numeric: true, total: 3, values: ["1", "2", "3"] });
    const s = await run('df <- data.frame(s = c("a\\"b", "한글", "a\\"b", NA, "c"))', "s");
    expect(s.values.sort()).toEqual(['a"b', "c", "한글"].sort());
  });

  test.skipIf(!hasR)("limit", async () => {
    const r = await run("df <- data.frame(x = 1:50)", "x", 10);
    expect(r.total).toBe(50);
    expect(r.values.length).toBe(10);
  });
});
