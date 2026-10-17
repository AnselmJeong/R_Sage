// Rendering with the installed Quarto (skipped when it is missing).
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PreviewServer, QuartoService } from "../src/quarto";

const svc = new QuartoService({ log: () => {}, done: () => {} });
const maybe = svc.find() ? test : test.skip;

maybe("renders a document and serves the result", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rsage-quarto-"));
  writeFileSync(join(dir, "doc.qmd"), "---\ntitle: 시험\nformat: html\n---\n\n## 안녕\n\n본문입니다.\n");
  let log = "";
  const done = new Promise<{ ok: boolean; output?: string; error?: string }>((resolve) => {
    const q = new QuartoService({ log: (_id, t) => (log += t), done: (_id, r) => resolve(r) });
    q.render(join(dir, "doc.qmd"), {});
  });
  const r = await done;
  expect(r.error).toBeUndefined();
  expect(r).toMatchObject({ ok: true, output: join(dir, "doc.html") });
  expect(log).toContain("quarto render doc.qmd");

  const preview = new PreviewServer(() => dir);
  try {
    const url = preview.url(r.output!);
    const html = await (await fetch(url)).text();
    expect(html).toContain("본문입니다.");
    // Nothing outside the project.
    expect((await fetch(url.replace(/doc\.html$/, "..%2F..%2Fetc%2Fpasswd"))).status).toBe(404);
    expect(() => preview.url("/etc/passwd")).toThrow();
  } finally {
    preview.dispose();
  }
}, 120_000);
