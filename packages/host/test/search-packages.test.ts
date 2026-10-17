import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchText } from "../src/search";
import { listPackages, parsePackageList, rankCran } from "../src/packages";

test("search reports UTF-16 columns, match length and whole words", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rsage-search-"));
  writeFileSync(join(dir, "a.qmd"), "사후 검정력 대신 power 분석, powered\n");
  writeFileSync(join(dir, "b.R"), "power <- 1\n");
  const r = await searchText(dir, { query: "power" });
  const a = r.matches.filter((m) => m.path.endsWith("a.qmd"));
  expect(a.length).toBe(2);
  expect(a[0]!.text.slice(a[0]!.column - 1, a[0]!.column - 1 + a[0]!.length!)).toBe("power");
  const w = await searchText(dir, { query: "power", wholeWord: true, glob: "*.qmd" });
  expect(w.matches.length).toBe(1);
  const ex = await searchText(dir, { query: "power", exclude: "*.qmd" });
  expect(ex.matches.every((m) => m.path.endsWith("b.R"))).toBe(true);
});

test("package list parsing and CRAN ranking", () => {
  const SEP = "\x1f";
  const l = parsePackageList(`##LIB${SEP}/lib/a\n##LIB${SEP}/lib/b\nzoo${SEP}1.8${SEP}/lib/a${SEP}S3 Infrastructure\nabind${SEP}1.4${SEP}/lib/b${SEP}NA\n`);
  expect(l.libPaths).toEqual(["/lib/a", "/lib/b"]);
  expect(l.packages.map((p) => p.name)).toEqual(["abind", "zoo"]);
  expect(l.packages[0]!.title).toBeUndefined();
  const idx = [
    { name: "ggplot2movies", version: "1" },
    { name: "ggplot2", version: "3" },
    { name: "plotly", version: "4", title: "Create Interactive Web Graphics via ggplot2" },
    { name: "aggplot2x", version: "1" },
  ];
  expect(rankCran(idx, "ggplot2").map((p) => p.name)).toEqual(["ggplot2", "ggplot2movies", "aggplot2x", "plotly"]);
});

const R_HOME = ["/usr/lib/R", "/Library/Frameworks/R.framework/Resources"].find((h) => existsSync(join(h, "bin", "Rscript")));
(R_HOME ? test : test.skip)("lists installed packages with the real R", async () => {
  const l = await listPackages(R_HOME!);
  expect(l.libPaths.length).toBeGreaterThan(0);
  expect(l.packages.find((p) => p.name === "stats")?.title).toBeTruthy();
});
