// tidyplots conversion from the Plots pane: rsageFigures is installed into
// the session's library on first use, the conversion runs privately and the
// user's objects are untouched. Needs Ark (or RSAGE_TEST_IRKERNEL=1) and an R
// with tidyplots installed.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverR, findArk } from "@rsage/kernel";

const useShim = process.env.RSAGE_TEST_IRKERNEL === "1";
const arkPath = useShim ? join(import.meta.dir, "fixtures", "irkernel-ark.sh") : findArk();
const rs = await discoverR();
const r = rs.find((x) => !x.tooOld) ?? rs[0];
const live = arkPath && r ? describe : describe.skip;

live("figure conversion in a live session", async () => {
  const home = mkdtempSync(join(tmpdir(), "rsage-home-"));
  const proj = mkdtempSync(join(tmpdir(), "rsage-proj-"));
  const prev = { ark: process.env.RSAGE_ARK_PATH, home: process.env.RSAGE_HOME, libs: process.env.R_LIBS_USER };
  process.env.RSAGE_ARK_PATH = arkPath!;
  process.env.RSAGE_HOME = home;
  const { Host } = await import("../src/host");
  const host = new Host({ shell: "browser" });
  const call = (m: string, p: any = {}) => host.dispatch(m, p) as Promise<any>;
  afterAll(async () => {
    await host.dispose();
    for (const [k, v] of [["RSAGE_ARK_PATH", prev.ark], ["RSAGE_HOME", prev.home]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test("converts a mean bar chart and leaves the session alone", async () => {
    await call("project.open", { path: proj });
    await call("session.start", {});
    await host.session.evalText("library(ggplot2); tg <- ToothGrowth; invisible(NULL)");
    const code = 'tg <- subset(tg, dose > 0.5)\nggplot(tg, aes(supp, len, fill = supp)) +\n  stat_summary(fun = mean, geom = "bar") +\n  labs(y = "치아 길이")';
    const res = await call("figures.convert", { code, options: { colors: "okabeito" } });
    if (res.status === "missing") {
      console.warn(`skipping: R packages missing: ${res.missing.join(", ")}`);
      return;
    }
    expect(res.status).toBe("rule");
    expect(res.code).toContain("tidyplot(x = supp, y = len, color = supp)");
    expect(res.code).toContain("adjust_colors(new_colors = colors_discrete_okabeito)");
    expect(res.code).toContain('adjust_y_axis_title("치아 길이")');
    expect(res.target).toMatchObject({ first_line: 2, last_line: 4 });
    expect(res.checks.every((c: any) => c.ok)).toBe(true);
    expect(res.previewExecutionId).toBeString();
    // The chunk's own assignment ran in a child environment.
    expect((await host.session.evalText("cat(nrow(tg))")).trim()).toBe("60");
    expect((await host.session.evalText("cat('tidyplots' %in% .packages())")).trim()).toBe("FALSE");
  }, 240_000);

  test("reports base graphics as work for the assistant", async () => {
    const res = await call("figures.convert", { code: "hist(airquality$Temp)" });
    if (res.status === "missing") return;
    expect(res.status).toBe("ai");
    expect(res.kind).toBe("base");
    expect(res.previewExecutionId).toBeUndefined();
  }, 60_000);
});
