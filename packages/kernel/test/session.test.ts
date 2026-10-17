// Integration test against a real Ark + R. Skipped when either is missing.
import { afterAll, describe, expect, test } from "bun:test";
import { discoverR, findArk, KernelSession, type OutputEvent } from "../src/index";

const ark = findArk();
const rs = await discoverR();
const r = rs.find((x) => !x.tooOld) ?? rs[0];
const maybe = ark && r ? describe : describe.skip;

maybe("KernelSession with Ark", () => {
  const s = new KernelSession();
  const outputs: OutputEvent[] = [];
  s.on("output", (o) => outputs.push(o));
  afterAll(() => s.shutdown());

  const waitDone = (id: string) =>
    new Promise<string>((res) => {
      const f = (o: OutputEvent) => {
        if (o.kind === "done" && o.executionId === id) {
          s.off("output", f);
          res(o.status);
        }
      };
      s.on("output", f);
    });

  test("starts and reports R version", async () => {
    const info = await s.start({ arkPath: ark!, rHome: r!.home, cwd: process.cwd() });
    expect(info.state).toBe("idle");
    expect(info.rVersion).toBe(r!.version);
  }, 60000);

  test("runs summary(lm()) and links output to the execution", async () => {
    const rec = s.execute("summary(lm(mpg ~ wt, mtcars))");
    expect(await waitDone(rec.id)).toBe("ok");
    // In console mode autoprinted values arrive as execute_result.
    const text = outputs
      .filter((o) => (o.kind === "stream" || o.kind === "result") && o.executionId === rec.id)
      .map((o: any) => o.text ?? o.data["text/plain"])
      .join("");
    expect(text).toContain("Coefficients");
  }, 30000);

  test("errors are reported", async () => {
    const rec = s.execute("stop('boom')");
    expect(await waitDone(rec.id)).toBe("error");
    expect(outputs.some((o) => o.kind === "error" && o.executionId === rec.id)).toBe(true);
  }, 30000);

  test("infinite loop can be interrupted", async () => {
    const rec = s.execute("while (TRUE) {}");
    const done = waitDone(rec.id);
    await Bun.sleep(500);
    await s.interrupt();
    expect(["ok", "error", "aborted"]).toContain(await done);
    const after = s.execute("1 + 1");
    expect(await waitDone(after.id)).toBe("ok");
  }, 30000);

  test("evalText returns stdout without echo", async () => {
    const out = await s.evalText("cat(.libPaths(), sep='\\n')");
    expect(out.trim().length).toBeGreaterThan(0);
  }, 30000);

  test("restart bumps the generation", async () => {
    const g = s.state.generation;
    const info = await s.restart();
    expect(info.generation).toBe(g + 1);
    expect(info.state).toBe("idle");
  }, 60000);
});
