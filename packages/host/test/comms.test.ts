// Integration test for the Positron comms against a real Ark + R. Skipped when either is missing.
import { afterAll, describe, expect, test } from "bun:test";
import { discoverR, findArk, KernelSession, type OutputEvent } from "@rsage/kernel";
import { CommManager, type OpenComm } from "../src/comms";
import { ARK_BASE_DPI, savePlot } from "../src/plots";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ark = findArk();
const rs = await discoverR();
const r = rs.find((x) => !x.tooOld) ?? rs[0];
const maybe = ark && r ? describe : describe.skip;

maybe("CommManager with Ark", () => {
  const s = new KernelSession();
  const cm = new CommManager(s);
  const opened: OpenComm[] = [];
  const events: { target: string; method: string; params: any }[] = [];
  cm.on("open", (c) => opened.push(c));
  cm.on("event", (e) => events.push(e));
  afterAll(() => s.shutdown());

  const run = (code: string) =>
    new Promise<string>((res) => {
      const rec = s.execute(code);
      const f = (o: OutputEvent) => {
        if (o.kind === "done" && o.executionId === rec.id) {
          s.off("output", f);
          res(rec.id);
        }
      };
      s.on("output", f);
    });
  const until = async (pred: () => boolean, ms = 5000) => {
    const t0 = Date.now();
    while (!pred() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 50));
    return pred();
  };

  test("opens the frontend comms", async () => {
    await s.start({ arkPath: ark!, rHome: r!.home, cwd: process.cwd() });
    cm.openFrontendComms();
    expect(cm.list().map((c) => c.target).sort()).toEqual(["positron.help", "positron.ui", "positron.variables"]);
    expect(await until(() => events.some((e) => e.target === "positron.variables" && e.method === "refresh"))).toBe(true);
  }, 60000);

  test("variables update and list", async () => {
    await run("rsage_x <- 1:10");
    expect(await until(() => events.some((e) => e.method === "update" && e.params.assigned?.some((v: any) => v.display_name === "rsage_x")))).toBe(true);
    const list: any = await cm.rpc(cm.byTarget("positron.variables")!.commId, "list");
    expect(list.variables.map((v: any) => v.display_name)).toContain("rsage_x");
  }, 30000);

  test("a plot opens a comm linked to its execution and renders", async () => {
    const execId = await run("plot(1:10)");
    expect(await until(() => opened.some((c) => c.target === "positron.plot"))).toBe(true);
    const plot = opened.find((c) => c.target === "positron.plot")!;
    expect(plot.executionId).toBe(execId);
    const out: any = await cm.rpc(plot.commId, "render", { size: { width: 300, height: 200 }, pixel_ratio: 1, format: "png" });
    expect(out.mime_type).toBe("image/png");
    expect(Buffer.from(out.data, "base64").subarray(1, 4).toString()).toBe("PNG");
  }, 30000);

  test("plots export at a physical size and DPI in every format", async () => {
    const plot = opened.find((c) => c.target === "positron.plot")!;
    const dir = mkdtempSync(join(tmpdir(), "rsage-plot-"));
    const png = join(dir, "sub", "p.png");
    expect(await savePlot(cm, { commId: plot.commId, path: png, format: "png", widthIn: 4, heightIn: 3, dpi: 300 })).toEqual({ ok: true, path: png });
    const b = readFileSync(png);
    expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([1200, 900]);
    // Refuses to overwrite unless asked.
    expect(await savePlot(cm, { commId: plot.commId, path: png, format: "png", widthIn: 4, heightIn: 3, dpi: 300 })).toEqual({ ok: false, exists: true });
    const magic: Record<string, (b: Buffer) => boolean> = {
      jpeg: (b) => b[0] === 0xff && b[1] === 0xd8,
      tiff: (b) => ["II", "MM"].includes(b.subarray(0, 2).toString()),
      svg: (b) => b.toString().includes("<svg"),
      pdf: (b) => b.subarray(0, 4).toString() === "%PDF",
    };
    for (const [format, ok] of Object.entries(magic)) {
      const p = join(dir, `p.${format}`);
      await savePlot(cm, { commId: plot.commId, path: p, format: format as any, widthIn: 5, heightIn: 4, dpi: 150 });
      expect(ok(readFileSync(p))).toBe(true);
    }
    // A vector plot is the requested size in inches (PDF MediaBox in points).
    const pdf = readFileSync(join(dir, "p.pdf")).toString("latin1");
    expect(pdf).toMatch(/MediaBox \[0 0 360 288\]/);
    expect(ARK_BASE_DPI).toBeGreaterThan(0);
  }, 60000);

  test("help and View() reach the frontend", async () => {
    await run("?lm");
    expect(await until(() => events.some((e) => e.method === "show_help" && /lm\.html$/.test(e.params.content)))).toBe(true);
    await run("View(mtcars)");
    expect(await until(() => opened.some((c) => c.target === "positron.dataExplorer"))).toBe(true);
    const de = opened.find((c) => c.target === "positron.dataExplorer")!;
    const st: any = await cm.rpc(de.commId, "get_state");
    expect(st.table_shape).toEqual({ num_rows: 32, num_columns: 11 });
  }, 30000);
});
