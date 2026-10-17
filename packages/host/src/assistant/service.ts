// The AI assistant: conversations, the tool loop, approvals.
//
// Conversations are stored per project in .rsage/assistant/<id>.json. Each
// keeps the UI items (what the user sees) and the provider-neutral history
// (what the model sees) side by side.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type {
  AssistantContext,
  AssistantItem,
  AssistantModel,
  AssistantProviderId,
  AssistantStatus,
  Conversation,
  ConversationSummary,
} from "@rsage/shared";
import type { KernelSession } from "@rsage/kernel";
import type { CommManager } from "../comms";
import { appDir, type ConfigStore, writeFileAtomic } from "../config";
import type { Project } from "../project";
import { AnthropicProvider } from "./anthropic";
import { FakeProvider } from "./fake";
import { OpenAIProvider } from "./openai";
import { getKey, setKey } from "./secrets";
import { runTool, TOOL_SPECS } from "./tools";
import type { Provider, ToolResult, Turn } from "./types";

const MAX_STEPS = 40;

interface Stored extends Conversation {
  history: Turn[];
}

type ToolItem = Extract<AssistantItem, { kind: "tool" }>;

export interface AssistantDeps {
  config: ConfigStore;
  project: () => Project | undefined;
  session: KernelSession;
  comms: CommManager;
  ensureSession: () => Promise<void>;
  emitItem: (conversationId: string, item: AssistantItem) => void;
  emitDelta: (conversationId: string, itemId: string, d: { text?: string; thinking?: string }) => void;
  emitState: (conversationId: string, running: boolean) => void;
  rInfo: () => { version?: string };
}

export class AssistantService {
  private providers: Provider[];
  private running = new Map<string, { abort: AbortController; approvals: Map<string, (ok: boolean) => void> }>();
  private errors = new Map<AssistantProviderId, string>();

  constructor(private deps: AssistantDeps) {
    this.providers = [
      new AnthropicProvider(() => getKey("anthropic")?.key),
      new OpenAIProvider(() => getKey("openai")?.key),
    ];
    if (process.env.RSAGE_FAKE_AI) this.providers.push(new FakeProvider());
  }

  private get options() {
    return this.deps.config.data.assistant ?? {};
  }

  // ---------- status & keys ----------

  async status(refresh = false): Promise<AssistantStatus> {
    const providers = this.providers.map((p) => {
      const key = p.id === "fake" ? { source: "env" as const } : getKey(p.id);
      return { id: p.id, label: p.label, configured: !!key, source: key?.source, error: this.errors.get(p.id) };
    });
    const models: AssistantModel[] = [];
    for (const p of this.providers) {
      if (!providers.find((x) => x.id === p.id)?.configured) continue;
      if (refresh) (p as any).resetModels?.();
      for (const m of await p.models()) models.push({ ...m, provider: p.id });
    }
    const def = this.options.defaultModel;
    return {
      providers,
      models,
      defaultModel: models.find((m) => m.id === def)?.id ?? models.find((m) => m.id === "claude-opus-5-5")?.id ?? models[0]?.id,
      autoRunR: !!this.options.autoRunR,
    };
  }

  async setKey(provider: AssistantProviderId, key: string | null) {
    setKey(provider, key?.trim() || null);
    this.errors.delete(provider);
    (this.providers.find((p) => p.id === provider) as any)?.resetModels?.();
    return this.status();
  }

  async setOptions(o: { autoRunR?: boolean; defaultModel?: string }) {
    const cfg = this.deps.config;
    cfg.update({ assistant: { ...this.options, ...o } });
    return this.status();
  }

  // ---------- storage ----------

  private dir() {
    const p = this.deps.project();
    const d = p ? p.meta("assistant") : join(appDir(), "assistant");
    mkdirSync(d, { recursive: true });
    return d;
  }

  private file(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new Error("bad conversation id");
    return join(this.dir(), `${id}.json`);
  }

  private read(id: string): Stored | null {
    try {
      return JSON.parse(readFileSync(this.file(id), "utf8"));
    } catch {
      return null;
    }
  }

  private save(c: Stored) {
    c.updatedAt = new Date().toISOString();
    writeFileAtomic(this.file(c.id), JSON.stringify(c));
  }

  list(): ConversationSummary[] {
    const d = this.dir();
    return readdirSync(d)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const c = JSON.parse(readFileSync(join(d, f), "utf8")) as Stored;
          return { id: c.id, title: c.title, updatedAt: c.updatedAt };
        } catch {
          return null;
        }
      })
      .filter((x): x is ConversationSummary => !!x)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  load(id: string): Conversation | null {
    const c = this.read(id);
    if (!c) return null;
    const { history: _h, ...rest } = c;
    return rest;
  }

  create(): Conversation {
    const now = new Date().toISOString();
    const c: Stored = { id: randomUUID(), title: "새 대화", createdAt: now, updatedAt: now, items: [], history: [] };
    this.save(c);
    const { history: _h, ...rest } = c;
    return rest;
  }

  delete(id: string) {
    this.stop(id);
    if (existsSync(this.file(id))) rmSync(this.file(id));
  }

  // ---------- running ----------

  stop(id: string) {
    const r = this.running.get(id);
    if (!r) return;
    r.abort.abort();
    for (const resolve of r.approvals.values()) resolve(false);
  }

  approve(id: string, itemId: string, ok: boolean, always?: boolean) {
    if (ok && always) void this.setOptions({ autoRunR: true });
    const r = this.running.get(id);
    const resolve = r?.approvals.get(itemId);
    r?.approvals.delete(itemId);
    resolve?.(ok);
  }

  /** Validates and starts a reply; resolves when the whole tool loop is done. */
  send(id: string, text: string, model: string, context?: AssistantContext): { done: Promise<void> } {
    if (this.running.has(id)) throw new Error("이 대화는 아직 답하는 중입니다.");
    const c = this.read(id);
    if (!c) throw new Error("대화를 찾을 수 없습니다.");
    const provider = this.providerFor(model);

    const now = () => new Date().toISOString();
    const push = (item: AssistantItem) => {
      const i = c.items.findIndex((x) => x.id === item.id);
      if (i >= 0) c.items[i] = item;
      else c.items.push(item);
      this.deps.emitItem(id, item);
    };

    push({ kind: "user", id: randomUUID(), text, context, at: now() });
    if (c.title === "새 대화") c.title = text.replace(/\s+/g, " ").slice(0, 60);
    c.model = model;
    c.history.push({ role: "user", text: withContext(text, context, this.deps.project()) });
    this.save(c);

    const run = { abort: new AbortController(), approvals: new Map<string, (ok: boolean) => void>() };
    this.running.set(id, run);
    this.deps.emitState(id, true);
    return { done: this.loop(c, provider, model, run, push, now) };
  }

  private async loop(
    c: Stored,
    provider: Provider,
    model: string,
    run: { abort: AbortController; approvals: Map<string, (ok: boolean) => void> },
    push: (item: AssistantItem) => void,
    now: () => string,
  ) {
    const id = c.id;
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const item: Extract<AssistantItem, { kind: "assistant" }> = { kind: "assistant", id: randomUUID(), text: "", model, at: now() };
        push(item);
        const result = await provider.turn({
          model,
          system: this.systemPrompt(),
          history: c.history,
          tools: TOOL_SPECS,
          signal: run.abort.signal,
          onText: (d) => {
            item.text += d;
            this.deps.emitDelta(id, item.id, { text: d });
          },
          onThinking: (d) => {
            item.thinking = (item.thinking ?? "") + d;
            this.deps.emitDelta(id, item.id, { thinking: d });
          },
        });
        this.errors.delete(provider.id);
        item.text = result.text || item.text;
        push(item);
        c.history.push({ role: "assistant", provider: provider.id, model, text: result.text, calls: result.calls, raw: result.raw });
        this.save(c);

        if (result.stop === "refusal") {
          push({ kind: "error", id: randomUUID(), text: "모델이 이 요청에 답하지 않았습니다.", at: now() });
          break;
        }
        if (result.stop === "max_tokens" && result.calls.length) {
          // A cut-off tool input must not run; tell the model and continue.
          c.history.push({
            role: "tool_results",
            results: result.calls.map((call) => ({ callId: call.id, name: call.name, output: "Output limit reached; the tool input was cut off. Try a smaller step.", isError: true })),
          });
          continue;
        }
        if (result.stop !== "tool" || !result.calls.length) break;

        const results: ToolResult[] = [];
        for (const call of result.calls) {
          const toolItem: ToolItem = { kind: "tool", id: randomUUID(), name: call.name, input: call.input, status: "running", at: now() };
          push(toolItem);
          const update = (patch: Partial<ToolItem>) => {
            Object.assign(toolItem, patch);
            push(toolItem);
          };
          let res: Omit<ToolResult, "callId" | "name">;
          if (run.abort.signal.aborted) res = { output: "Stopped by the user.", isError: true };
          else {
            try {
              res = await runTool(call.name, call.input, toolItem, {
                project: this.deps.project(),
                session: this.deps.session,
                comms: this.deps.comms,
                ensureSession: this.deps.ensureSession,
                autoRunR: () => !!this.options.autoRunR,
                signal: run.abort.signal,
                update,
                approve: (it) =>
                  new Promise<boolean>((resolve) => {
                    update({ ...it, status: "awaiting-approval" });
                    run.approvals.set(toolItem.id, (ok) => {
                      update({ status: ok ? "running" : "denied" });
                      resolve(ok);
                    });
                  }),
              });
            } catch (err: any) {
              res = { output: err?.message ?? String(err), isError: true };
            }
          }
          update({
            status: toolItem.status === "denied" ? "denied" : res.isError ? "error" : "done",
            output: res.output.slice(0, 4000),
            images: res.images?.map((img) => `data:${img.mime};base64,${img.data}`),
          });
          results.push({ callId: call.id, name: call.name, ...res });
        }
        c.history.push({ role: "tool_results", results });
        this.save(c);
        if (run.abort.signal.aborted) break;
      }
    } catch (err: any) {
      const msg = run.abort.signal.aborted ? "중단했습니다." : (err?.message ?? String(err));
      if (!run.abort.signal.aborted) this.errors.set(provider.id, msg);
      push({ kind: "error", id: randomUUID(), text: msg, at: now() });
      // Keep the history valid: a dangling tool call needs a result.
      const last = c.history[c.history.length - 1];
      if (last?.role === "assistant" && last.calls.length) {
        c.history.push({ role: "tool_results", results: last.calls.map((x) => ({ callId: x.id, name: x.name, output: "Stopped.", isError: true })) });
      }
    } finally {
      this.running.delete(id);
      this.save(c);
      this.deps.emitState(id, false);
    }
  }

  private providerFor(model: string): Provider {
    const id: AssistantProviderId = model.startsWith("claude") ? "anthropic" : model.startsWith("fake") ? "fake" : "openai";
    const p = this.providers.find((x) => x.id === id);
    if (!p) throw new Error(`No provider for ${model}`);
    return p;
  }

  private systemPrompt(): string {
    const p = this.deps.project();
    const r = this.deps.rInfo();
    return [
      "You are the assistant inside R Sage, a desktop app for data analysis in R and for writing reports in Quarto (.qmd).",
      "Most users here are researchers who prefer to ask you rather than write code themselves, so do the work: look at their files and data, run R code in their live session, and write or edit their R scripts and .qmd reports.",
      "",
      "How to work:",
      "- Look before you act: list or read files and check data (e.g. str(), summary(), head()) before analysing.",
      "- Run code with run_r to verify it before putting it in a file, and report actual results; never invent numbers.",
      "- Prefer tidyverse-style, readable R; load packages explicitly; if a package is missing, say so and suggest install.packages() rather than installing it yourself.",
      "- When writing a report, edit the .qmd: keep YAML header and chunk fences intact, put analysis in ```{r} chunks with labels, and explain results in prose.",
      "- Use edit_file for focused changes and write_file for new files. The user approves every file change.",
      "- Keep replies short and in the language the user writes in (often Korean). Show key results, not long logs.",
      "",
      `Project folder: ${p?.root ?? "(none open)"}`,
      `R: ${r.version ?? "not started"}`,
    ].join("\n");
  }
}

function withContext(text: string, ctx: AssistantContext | undefined, project: Project | undefined): string {
  if (!ctx?.file) return text;
  const rel = project ? project.relative(ctx.file) : ctx.file;
  let s = `${text}\n\n<editor_context>\nActive file: ${rel}`;
  if (ctx.selection?.text) s += `\nSelected lines ${ctx.selection.startLine}-${ctx.selection.endLine}:\n${ctx.selection.text.slice(0, 8000)}`;
  return s + "\n</editor_context>";
}
