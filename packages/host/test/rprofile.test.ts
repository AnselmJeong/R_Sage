// An error in the user's .Rprofile must not stop the R session, and the console
// explains that only the rest of the profile was skipped.

import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverR, findArk } from "@rsage/kernel";

const arkPath = process.env.RSAGE_TEST_IRKERNEL === "1" ? null : findArk();
const r = (await discoverR()).find((x) => !x.tooOld);

(arkPath && r ? test : test.skip)("a failing .Rprofile still gives a working session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rsage-rprofile-"));
  const profile = join(dir, ".Rprofile");
  writeFileSync(profile, 'options(rsage_before = TRUE)\nif (interactive()) source("/no/such/dir/init.R")\noptions(rsage_after = TRUE)\n');
  const prev = { ark: process.env.RSAGE_ARK_PATH, home: process.env.RSAGE_HOME, profile: process.env.R_PROFILE_USER };
  Object.assign(process.env, { RSAGE_ARK_PATH: arkPath!, RSAGE_HOME: mkdtempSync(join(tmpdir(), "rsage-home-")), R_PROFILE_USER: profile });
  const { Host } = await import("../src/host");
  const host = new Host({ shell: "browser" });
  const out: string[] = [];
  host.subscribe((type, payload: any) => type === "console.output" && payload.kind === "stream" && out.push(payload.text));
  try {
    await host.dispatch("project.open", { path: mkdtempSync(join(tmpdir(), "rsage-proj-")) });
    await host.dispatch("session.start", {});
    expect((await host.session.evalText("cat(1 + 1, isTRUE(getOption('rsage_before')), isTRUE(getOption('rsage_after')))")).trim()).toBe("2 TRUE FALSE");
    await Bun.sleep(200);
    expect(out.join("")).toContain("[R Sage] .Rprofile");
  } finally {
    await host.dispose();
    for (const [k, v] of [["RSAGE_ARK_PATH", prev.ark], ["RSAGE_HOME", prev.home], ["R_PROFILE_USER", prev.profile]] as const)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
}, 60_000);
