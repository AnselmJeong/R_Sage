import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitService, gitBinary, parseStatus } from "../src/git";

Object.assign(process.env, {
  GIT_AUTHOR_NAME: "Tester",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "Tester",
  GIT_COMMITTER_EMAIL: "t@example.com",
});

test("parses porcelain status with renames, conflicts and upstream", () => {
  const out = ["## main...origin/main [ahead 2, behind 1]", "M  a.R", " M b.qmd", "MM c.R", "R  new.R", "old.R", "?? 분석.qmd", "UU d.R", ""].join("\0");
  const s = parseStatus(out, "/r");
  expect([s.branch, s.upstream, s.ahead, s.behind]).toEqual(["main", "origin/main", 2, 1]);
  expect(s.changes.map((c) => [c.path, c.status, c.staged])).toEqual([
    ["/r/a.R", "M", true],
    ["/r/b.qmd", "M", false],
    ["/r/c.R", "M", true],
    ["/r/c.R", "M", false],
    ["/r/new.R", "R", true],
    ["/r/분석.qmd", "?", false],
    ["/r/d.R", "U", false],
  ]);
  expect(s.changes[4]!.origPath).toBe("/r/old.R");
});

(gitBinary() ? test : test.skip)("init, stage, commit, diff, branch and history with a real git", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rsage-git-"));
  const g = new GitService(() => dir);
  expect((await g.status()).isRepo).toBe(false);
  await g.init();
  writeFileSync(join(dir, "분석.qmd"), "# 제목\n");
  let s = await g.status();
  expect(s.branch).toBe("main");
  expect(s.hasCommits).toBe(false);
  expect(s.changes).toEqual([{ path: join(dir, "분석.qmd"), status: "?", staged: false }]);
  await g.stage([join(dir, "분석.qmd")]);
  expect((await g.status()).changes[0]!.staged).toBe(true);
  await g.unstage([join(dir, "분석.qmd")], false);
  expect((await g.status()).changes[0]!.status).toBe("?");
  await g.stage([join(dir, "분석.qmd")]);
  await g.commit("첫 커밋");
  writeFileSync(join(dir, "분석.qmd"), "# 제목\n\n본문\n");
  s = await g.status();
  expect(s.changes.map((c) => [c.status, c.staged])).toEqual([["M", false]]);
  expect(await g.show("HEAD", join(dir, "분석.qmd"))).toBe("# 제목\n");
  await g.commit("둘째", { all: true });
  const log = await g.log();
  expect(log.map((c) => c.subject)).toEqual(["둘째", "첫 커밋"]);
  expect((await g.commitFiles(log[1]!.hash)).map((f) => [f.path, f.status])).toEqual([[join(dir, "분석.qmd"), "A"]]);
  await g.checkout("feature", { create: true });
  expect((await g.branches()).find((b) => b.current)?.name).toBe("feature");
  await g.checkout("main");
  expect((await g.status()).branch).toBe("main");
  await expect(g.push()).rejects.toThrow();
});
