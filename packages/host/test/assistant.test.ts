// The assistant's tool loop end to end with the scripted provider and a real
// Ark + R (skipped when either is missing).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverR, findArk } from "@rsage/kernel";
import type { AssistantItem } from "@rsage/shared";

process.env.RSAGE_FAKE_AI = "1";
process.env.RSAGE_HOME = mkdtempSync(join(tmpdir(), "rsage-home-"));
process.env.RSAGE_NO_KEYCHAIN = "1";
const { Host } = await import("../src/host");

const ark = findArk();
const rs = await discoverR();
const maybe = ark && rs.length ? describe : describe.skip;

maybe("assistant with the scripted provider", () => {
  const host = new Host({ shell: "browser" });
  const proj = mkdtempSync(join(tmpdir(), "rsage-proj-"));
  writeFileSync(join(proj, "analysis.R"), "x <- 1\n");
  const items = new Map<string, AssistantItem>();
  let running = false;
  host.subscribe((type, payload: any) => {
    if (type === "assistant.item") items.set(payload.item.id, payload.item);
    if (type === "assistant.state") running = payload.running;
  });
  afterAll(() => host.dispose());

  const call = (m: string, p: unknown = {}) => host.dispatch(m, p) as Promise<any>;
  const until = async (pred: () => boolean, ms = 30000) => {
    const t0 = Date.now();
    while (!pred() && Date.now() - t0 < ms) await Bun.sleep(50);
    return pred();
  };
  const tools = () => [...items.values()].filter((i): i is Extract<AssistantItem, { kind: "tool" }> => i.kind === "tool");

  test("runs R code after approval and returns the plot", async () => {
    await call("project.open", { path: proj });
    const status = await call("assistant.status");
    expect(status.models.map((m: any) => m.id)).toContain("fake-echo");
    const conv = await call("assistant.new");
    await call("assistant.send", { conversationId: conv.id, model: "fake-echo", text: "```r\nsummary(cars)\nplot(cars)\n```" });
    expect(await until(() => tools().some((t) => t.status === "awaiting-approval"))).toBe(true);
    const pending = tools().find((t) => t.status === "awaiting-approval")!;
    await call("assistant.approve", { conversationId: conv.id, itemId: pending.id, approve: true });
    expect(await until(() => !running && tools()[0]!.status === "done", 60000)).toBe(true);
    const t = tools()[0]!;
    expect(t.output).toContain("speed");
    expect(t.images?.length).toBe(1);
    const reply = [...items.values()].filter((i) => i.kind === "assistant").pop() as any;
    expect(reply.text).toContain("run_r");
  }, 90000);

  test("file edits wait for approval and are written after it", async () => {
    items.clear();
    const conv = await call("assistant.new");
    await call("assistant.send", { conversationId: conv.id, model: "fake-echo", text: "write report.qmd\n---\ntitle: 보고서\n---\n" });
    expect(await until(() => tools().some((t) => t.status === "awaiting-approval"))).toBe(true);
    const pending = tools()[0]!;
    expect(pending.diff?.isNew).toBe(true);
    await call("assistant.approve", { conversationId: conv.id, itemId: pending.id, approve: true });
    expect(await until(() => !running)).toBe(true);
    expect(readFileSync(join(proj, "report.qmd"), "utf8")).toContain("보고서");
    // The conversation is saved in the project.
    const list = await call("assistant.list");
    expect(list.length).toBe(2);
    const loaded = await call("assistant.load", { id: conv.id });
    expect(loaded.items.some((i: any) => i.kind === "tool" && i.status === "done")).toBe(true);
  }, 60000);

  test("a rejected change leaves the file alone", async () => {
    items.clear();
    const conv = await call("assistant.new");
    await call("assistant.send", { conversationId: conv.id, model: "fake-echo", text: "write analysis.R\ny <- 2\n" });
    expect(await until(() => tools().some((t) => t.status === "awaiting-approval"))).toBe(true);
    await call("assistant.approve", { conversationId: conv.id, itemId: tools()[0]!.id, approve: false });
    expect(await until(() => !running)).toBe(true);
    expect(tools()[0]!.status).toBe("denied");
    expect(readFileSync(join(proj, "analysis.R"), "utf8")).toBe("x <- 1\n");
  }, 60000);
});
