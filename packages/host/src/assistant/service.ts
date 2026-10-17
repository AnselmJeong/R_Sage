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
  EditApprovalScope,
} from "@rsage/shared";
import type { KernelSession } from "@rsage/kernel";
import type { CommManager } from "../comms";
import { appDir, type ConfigStore, writeFileAtomic } from "../config";
import type { Project } from "../project";
import { AnthropicProvider } from "./anthropic";
import { ClaudeCodeProvider } from "./claude-code";
import { CodexProvider } from "./codex";
import { FakeAgentProvider, FakeProvider } from "./fake";
import { McpBridge } from "./mcp";
import { OpenAIProvider } from "./openai";
import { getKey, setKey } from "./secrets";
import { runTool, TOOL_SPECS } from "./tools";
import type { AnalysisService } from "../analysis/service";
import type { AgentProvider, Provider, ToolResult, Turn } from "./types";

const MAX_STEPS = 40;

interface Stored extends Conversation {
  history: Turn[];
  /** Agent providers keep their own session; `synced` is how much of `history` it has seen. */
  agentSessions?: Partial<Record<AssistantProviderId, { id?: string; synced: number }>>;
}

type AnyProvider = Provider | AgentProvider;
type Run = { abort: AbortController; approvals: Map<string, (ok: boolean, scope?: EditApprovalScope) => void> };
const isAgent = (p: AnyProvider): p is AgentProvider => (p as AgentProvider).kind === "agent";

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
  /** Opens a web page in the user's browser (sign-in pages). */
  openUrl: (url: string) => Promise<void>;
  analyses?: AnalysisService;
  openAnalysis?: (id: string) => void;
}

export class AssistantService {
  private providers: AnyProvider[];
  private running = new Map<string, Run>();
  private errors = new Map<AssistantProviderId, string>();
  private bridge = new McpBridge(TOOL_SPECS);

  constructor(private deps: AssistantDeps) {
    this.providers = [
      new ClaudeCodeProvider(),
      new CodexProvider(),
      new AnthropicProvider(() => getKey("anthropic")?.key),
      new OpenAIProvider(() => getKey("openai")?.key),
    ];
    if (process.env.RSAGE_FAKE_AI) this.providers.push(new FakeProvider(), new FakeAgentProvider());
  }

  dispose() {
    for (const id of this.running.keys()) this.stop(id);
    this.bridge.dispose();
    for (const p of this.providers) if (isAgent(p)) p.dispose?.();
  }

  private get options() {
    return this.deps.config.data.assistant ?? {};
  }

  // ---------- status & keys ----------

  async status(refresh = false): Promise<AssistantStatus> {
    const providers: AssistantStatus["providers"] = [];
    const models: AssistantModel[] = [];
    // Ask both agent CLIs at once; each takes a moment.
    const subs = new Map(await Promise.all(this.providers.filter(isAgent).map(async (p) => [p, await p.connection(refresh)] as const)));
    for (const p of this.providers) {
      // Both fake providers share one status row.
      if (providers.some((x) => x.id === p.id)) {
        for (const m of await p.models()) models.push({ ...m, provider: p.id });
        continue;
      }
      let st: AssistantStatus["providers"][number];
      const sub = isAgent(p) ? subs.get(p) : undefined;
      if (sub) {
        st = { id: p.id, label: p.label, configured: sub.state === "connected", source: sub.state === "connected" ? "login" : undefined, subscription: sub };
      } else {
        const key = p.id === "fake" ? { source: "env" as const } : getKey(p.id);
        st = { id: p.id, label: p.label, configured: !!key, source: key?.source, error: this.errors.get(p.id) };
      }
      providers.push(st);
      if (!st.configured) continue;
      if (refresh) (p as any).resetModels?.();
      for (const m of await p.models()) models.push({ ...m, provider: p.id });
    }
    const def = this.options.defaultModel;
    const prefer = ["cc:opus", "cc:default", "claude-opus-5-5", "codex:default"];
    return {
      providers,
      models,
      defaultModel: models.find((m) => m.id === def)?.id ?? prefer.map((id) => models.find((m) => m.id === id)?.id).find(Boolean) ?? models[0]?.id,
      autoRunR: !!this.options.autoRunR,
      autoApproveEdits: this.projectApproved(),
    };
  }

  private agent(provider: AssistantProviderId) {
    const p = this.providers.find((x) => x.id === provider && isAgent(x));
    if (!p) throw new Error("구독으로 연결할 수 없는 서비스입니다.");
    return p as AgentProvider;
  }

  /** Starts the subscription sign-in; the browser opens on the provider's page. */
  async login(provider: AssistantProviderId) {
    await this.agent(provider).login((url) => void this.deps.openUrl(url));
    return this.status();
  }

  async cancelLogin(provider: AssistantProviderId) {
    await this.agent(provider).cancelLogin();
    return this.status(true);
  }

  async logout(provider: AssistantProviderId) {
    await this.agent(provider).logout();
    return this.status(true);
  }

  async setKey(provider: AssistantProviderId, key: string | null) {
    setKey(provider, key?.trim() || null);
    this.errors.delete(provider);
    (this.providers.find((p) => p.id === provider) as any)?.resetModels?.();
    return this.status();
  }

  async setOptions({ autoApproveEdits, ...o }: { autoRunR?: boolean; defaultModel?: string; autoApproveEdits?: boolean }) {
    const next = { ...this.options, ...o };
    const root = this.deps.project()?.root;
    if (root && autoApproveEdits !== undefined) {
      const rest = (next.autoApproveEditsIn ?? []).filter((r) => r !== root);
      next.autoApproveEditsIn = autoApproveEdits ? [...rest, root] : rest;
    }
    this.deps.config.update({ assistant: next });
    return this.status();
  }

  // ---------- file-change approvals ----------

  /** Files whose changes the user approved for the rest of this app session, per project. */
  private approvedFiles = new Map<string, Set<string>>();

  private projectApproved() {
    const root = this.deps.project()?.root;
    return !!root && (this.options.autoApproveEditsIn ?? []).includes(root);
  }

  /** True when a change to this file needs no approval. */
  private autoApply(path: string) {
    const root = this.deps.project()?.root;
    return !!root && (this.projectApproved() || !!this.approvedFiles.get(root)?.has(path));
  }

  private rememberApproval(path: string, scope: EditApprovalScope) {
    const root = this.deps.project()?.root;
    if (!root) return;
    if (scope === "project") void this.setOptions({ autoApproveEdits: true });
    else if (scope === "file") {
      if (!this.approvedFiles.has(root)) this.approvedFiles.set(root, new Set());
      this.approvedFiles.get(root)!.add(path);
    }
  }

  // ---------- storage ----------

  private dir() {
    const p = this.deps.project();
    p?.ensureMeta();
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

  approve(id: string, itemId: string, ok: boolean, always?: boolean, scope?: EditApprovalScope) {
    if (ok && always) void this.setOptions({ autoRunR: true });
    const r = this.running.get(id);
    const resolve = r?.approvals.get(itemId);
    r?.approvals.delete(itemId);
    resolve?.(ok, scope);
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
    c.history.push({ role: "user", text: this.withContext(text, context), images: context?.images?.length ? context.images : undefined });
    this.save(c);

    const run: Run = { abort: new AbortController(), approvals: new Map() };
    this.running.set(id, run);
    this.deps.emitState(id, true);
    return { done: isAgent(provider) ? this.agentLoop(c, provider, model, run, push, now) : this.loop(c, provider, model, run, push, now) };
  }

  /** Runs one tool call as a visible, approvable item. */
  private async execTool(name: string, input: any, run: Run, push: (item: AssistantItem) => void, now: () => string) {
    const toolItem: ToolItem = { kind: "tool", id: randomUUID(), name, input, status: "running", at: now() };
    push(toolItem);
    const update = (patch: Partial<ToolItem>) => {
      Object.assign(toolItem, patch);
      push(toolItem);
    };
    let res: Omit<ToolResult, "callId" | "name">;
    if (run.abort.signal.aborted) res = { output: "Stopped by the user.", isError: true };
    else {
      try {
        res = await runTool(name, input, toolItem, {
          project: this.deps.project(),
          session: this.deps.session,
          comms: this.deps.comms,
          ensureSession: this.deps.ensureSession,
          autoRunR: () => !!this.options.autoRunR,
          autoApply: (path) => this.autoApply(path),
          readConversation: (cid) => this.fullTranscript(cid),
          analyses: this.deps.analyses,
          openAnalysis: this.deps.openAnalysis,
          signal: run.abort.signal,
          update,
          approve: (it) =>
            new Promise<boolean>((resolve) => {
              update({ ...it, status: "awaiting-approval" });
              run.approvals.set(toolItem.id, (ok, scope) => {
                if (ok && scope && toolItem.diff) this.rememberApproval(toolItem.diff.path, scope);
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
    return res;
  }

  /** Claude Code / Codex: the agent runs the loop and calls our tools over MCP. */
  private async agentLoop(c: Stored, provider: AgentProvider, model: string, run: Run, push: (item: AssistantItem) => void, now: () => string) {
    const id = c.id;
    const sessions = (c.agentSessions ??= {});
    const prev = sessions[provider.id];
    const userTurn = c.history[c.history.length - 1] as Extract<Turn, { role: "user" }>;
    // Turns this agent has not seen (other models, or before it joined) go in as a transcript.
    const unseen = c.history.slice(prev?.id ? prev.synced : 0, -1);
    const prompt = unseen.length ? `<earlier_conversation>\n${transcript(unseen)}\n</earlier_conversation>\n\n${userTurn.text}` : userTurn.text;

    let item: Extract<AssistantItem, { kind: "assistant" }> | undefined;
    const said: { text: string }[] = [];
    const current = () => {
      if (!item) {
        item = { kind: "assistant", id: randomUUID(), text: "", model, at: now() };
        said.push(item);
        push(item);
      }
      return item;
    };
    const own = new Map<string, ToolItem>();
    const mcp = this.bridge.open(async (name, input) => {
      if (item) push(item);
      item = undefined;
      const res = await this.execTool(name, input, run, push, now);
      this.save(c);
      return res;
    });
    let produced = false;
    try {
      const r = await provider.run({
        model,
        system: this.systemPrompt(),
        prompt,
        images: userTurn.images,
        sessionId: prev?.id,
        cwd: this.deps.project()?.root ?? this.dir(),
        mcp: { url: mcp.url, token: mcp.token },
        signal: run.abort.signal,
        onMessage: () => {
          if (item) push(item);
          item = undefined;
        },
        onText: (d) => {
          produced = true;
          const it = current();
          it.text += d;
          this.deps.emitDelta(id, it.id, { text: d });
        },
        onThinking: (d) => {
          const it = current();
          it.thinking = (it.thinking ?? "") + d;
          this.deps.emitDelta(id, it.id, { thinking: d });
        },
        onOwnTool: (t) => {
          produced = true;
          let ti = own.get(t.key);
          if (!ti) {
            if (item) push(item);
            item = undefined;
            ti = { kind: "tool", id: randomUUID(), name: t.name, input: t.input, status: t.status, at: now() };
            own.set(t.key, ti);
          }
          Object.assign(ti, { status: t.status, output: t.output?.slice(0, 4000) });
          push(ti);
        },
      });
      this.errors.delete(provider.id);
      if (item) push(item);
      c.history.push({ role: "assistant", provider: provider.id, model, text: r.text, calls: [] });
      sessions[provider.id] = { id: r.sessionId, synced: c.history.length };
    } catch (err: any) {
      const msg = run.abort.signal.aborted ? "중단했습니다." : (err?.message ?? String(err));
      if (!run.abort.signal.aborted) this.errors.set(provider.id, msg);
      // A session that could not be resumed starts over next time, with the transcript.
      if (!produced && prev?.id) delete sessions[provider.id];
      if (item) push(item);
      push({ kind: "error", id: randomUUID(), text: msg, at: now() });
      const text = said.map((x) => x.text).filter(Boolean).join("\n");
      if (text) c.history.push({ role: "assistant", provider: provider.id, model, text, calls: [] });
    } finally {
      mcp.close();
      this.running.delete(id);
      this.save(c);
      this.deps.emitState(id, false);
    }
  }

  private async loop(c: Stored, provider: Provider, model: string, run: Run, push: (item: AssistantItem) => void, now: () => string) {
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
          const res = await this.execTool(call.name, call.input, run, push, now);
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

  private providerFor(model: string): AnyProvider {
    if (model.startsWith("fake")) {
      const p = this.providers.find((x) => x.id === "fake" && isAgent(x) === model.startsWith("fake-agent"));
      if (p) return p;
    }
    const id: AssistantProviderId = model.startsWith("cc:")
      ? "claude-code"
      : model.startsWith("codex:")
        ? "codex"
        : model.startsWith("claude")
          ? "anthropic"
          : "openai";
    const p = this.providers.find((x) => x.id === id);
    if (!p) throw new Error(`No provider for ${model}`);
    return p;
  }

  /** The user's message as the model sees it: editor context, @ references and earlier conversations. */
  private withContext(text: string, ctx: AssistantContext | undefined): string {
    const project = this.deps.project();
    const parts = [text];
    const editor = editorContext(ctx, project);
    if (editor) parts.push(editor);
    const refs = ctx?.refs ?? [];
    if (refs.length) {
      const lines = ["<references>", "The user attached these with @."];
      for (const r of refs) {
        if (r.kind === "conversation") {
          lines.push(`Earlier conversation "${r.title}" (id ${r.id}). Excerpt below; call read_conversation with this id for the full transcript.`);
          lines.push(this.excerpt(r.id));
        } else {
          const rel = project ? project.relative(r.path) : r.path;
          lines.push(r.kind === "folder" ? `Folder: ${rel}/ (look inside with list_files)` : `File: ${rel} (read it with read_file)`);
        }
      }
      parts.push(lines.join("\n") + "\n</references>");
    }
    return parts.join("\n\n");
  }

  /** The questions and answers of a stored conversation, short enough to put in a prompt. */
  private excerpt(id: string): string {
    const c = this.read(id);
    if (!c) return "(not found)";
    const lines: string[] = [];
    let size = 0;
    for (const it of c.items) {
      const line = it.kind === "user" ? `User: ${clip(it.text, 800)}` : it.kind === "assistant" && it.text ? `Assistant: ${clip(it.text, 800)}` : "";
      if (!line) continue;
      if (size + line.length > 6000) {
        lines.push("… (more in the full transcript)");
        break;
      }
      lines.push(line);
      size += line.length;
    }
    return lines.join("\n") || "(empty)";
  }

  /** A stored conversation in full, for read_conversation. */
  private fullTranscript(id: string): string | null {
    const c = this.read(id);
    if (!c) return null;
    const out = [`# ${c.title} (${c.createdAt})`];
    for (const it of c.items) {
      if (it.kind === "user") out.push(`User: ${it.text}`);
      else if (it.kind === "assistant" && it.text) out.push(`Assistant: ${it.text}`);
      else if (it.kind === "tool") out.push(`[${it.name}${it.input?.path ? ` ${it.input.path}` : ""}] ${it.name === "run_r" ? `\n${it.input?.code ?? ""}\n` : ""}${clip(it.output ?? "", 1500)}`);
      else if (it.kind === "error") out.push(`Error: ${it.text}`);
    }
    return clip(out.join("\n\n"), 60000);
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
      "- For a standard statistical analysis, check list_analyses first. When one fits, use describe_analysis and run_analysis instead of writing the R code yourself: the result opens in an analysis tab where the user can adjust options. Use run_r for what the analyses do not cover.",
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

function editorContext(ctx: AssistantContext | undefined, project: Project | undefined): string {
  if (!ctx?.file) return "";
  const rel = project ? project.relative(ctx.file) : ctx.file;
  let s = `<editor_context>\nActive file: ${rel}`;
  if (ctx.selection?.text) s += `\nSelected lines ${ctx.selection.startLine}-${ctx.selection.endLine}:\n${ctx.selection.text.slice(0, 8000)}`;
  return s + "\n</editor_context>";
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function transcript(turns: Turn[]): string {
  return turns
    .map((t) => {
      if (t.role === "user") return `User: ${t.text}`;
      if (t.role === "assistant") return `Assistant: ${t.text}${t.calls.length ? `\n[called ${t.calls.map((x) => x.name).join(", ")}]` : ""}`;
      return t.results.map((r) => `Tool result (${r.name}): ${r.output.slice(0, 1500)}`).join("\n");
    })
    .join("\n\n");
}
