// Claude via the Anthropic Messages API (user's own API key).

import Anthropic from "@anthropic-ai/sdk";
import type { Provider, ToolCall, Turn, TurnRequest, TurnResult } from "./types";

const FALLBACK_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
];

/** Models that take adaptive thinking (everything current except Haiku 4.5 and older). */
const adaptive = (m: string) => !/haiku-4|claude-3|sonnet-4-5|opus-4-5|opus-4-1|sonnet-4-0|opus-4-0/.test(m);
/** Models that accept the server-side refusal fallback ("default" form). */
const fallbackCapable = (m: string) => /^claude-(opus-5|fable-5-1|sonnet-5-5)/.test(m);

export class AnthropicProvider implements Provider {
  readonly id = "anthropic" as const;
  readonly label = "Claude (Anthropic API)";
  private cachedModels?: { id: string; label: string }[];

  constructor(private apiKey: () => string | undefined) {}

  private client() {
    const key = this.apiKey();
    if (!key) throw new Error("Anthropic API 키가 설정되지 않았습니다. 설정 → AI에서 키를 입력하세요.");
    return new Anthropic({ apiKey: key });
  }

  async models() {
    if (this.cachedModels) return this.cachedModels;
    try {
      const list: { id: string; label: string }[] = [];
      for await (const m of this.client().models.list({ limit: 100 })) list.push({ id: m.id, label: m.display_name });
      // Keep current families only; the API also lists retired-soon models.
      const current = list.filter((m) => /claude-(opus|sonnet|haiku|fable)-[4-9]/.test(m.id) && !/claude-3/.test(m.id));
      this.cachedModels = current.length ? current : FALLBACK_MODELS;
    } catch {
      return FALLBACK_MODELS;
    }
    return this.cachedModels;
  }

  resetModels() {
    this.cachedModels = undefined;
  }

  async turn(req: TurnRequest): Promise<TurnResult> {
    // With eager input streaming, finalMessage() rejects when a tool input is
    // not parseable JSON; re-issue that turn (API errors are not retried).
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once(req);
      } catch (err) {
        if (err instanceof Anthropic.APIError || req.signal.aborted || attempt >= 2) throw friendly(err);
      }
    }
  }

  private async once(req: TurnRequest): Promise<TurnResult> {
    const client = this.client();
    const params: Anthropic.Beta.MessageCreateParamsStreaming = {
      model: req.model,
      max_tokens: 64000,
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: toMessages(req.history),
      tools: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
        eager_input_streaming: true,
      })),
      stream: true,
    };
    if (adaptive(req.model)) {
      params.thinking = { type: "adaptive", display: "summarized" };
      params.output_config = { effort: "high" };
    }
    if (fallbackCapable(req.model)) {
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }

    const stream = client.beta.messages.stream(params, { signal: req.signal });
    stream.on("text", (d) => req.onText(d));
    stream.on("streamEvent", (e) => {
      if (e.type === "content_block_delta" && e.delta.type === "thinking_delta") req.onThinking(e.delta.thinking);
    });
    const message = await stream.finalMessage();

    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const calls: ToolCall[] = message.content
      .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));
    const stop =
      message.stop_reason === "refusal"
        ? "refusal"
        : message.stop_reason === "max_tokens"
          ? "max_tokens"
          : calls.length
            ? "tool"
            : message.stop_reason === "end_turn"
              ? "end"
              : "other";
    return { text, calls, raw: message.content, stop };
  }
}

function toMessages(history: Turn[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const t of history) {
    if (t.role === "user")
      out.push({
        role: "user",
        content: t.images?.length
          ? [
              ...t.images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mime as any, data: img.data } })),
              { type: "text" as const, text: t.text },
            ]
          : t.text,
      });
    else if (t.role === "assistant") {
      if (t.provider === "anthropic" && t.raw) out.push({ role: "assistant", content: t.raw as Anthropic.Beta.BetaContentBlockParam[] });
      else {
        const content: Anthropic.Beta.BetaContentBlockParam[] = [];
        if (t.text) content.push({ type: "text", text: t.text });
        for (const c of t.calls) content.push({ type: "tool_use", id: safeId(c.id), name: c.name, input: c.input ?? {} });
        if (content.length) out.push({ role: "assistant", content });
      }
    } else {
      // All results of one turn go back in a single user message.
      out.push({
        role: "user",
        content: t.results.map((r) => ({
          type: "tool_result" as const,
          tool_use_id: safeId(r.callId),
          is_error: r.isError || undefined,
          content: [
            { type: "text" as const, text: r.output || "(no output)" },
            ...(r.images ?? []).map((img) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: img.mime as "image/png", data: img.data },
            })),
          ],
        })),
      });
    }
  }
  return out;
}

/** Tool ids from another provider may contain characters Anthropic rejects. */
const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_");

function friendly(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) return new Error("Anthropic API 키가 올바르지 않습니다.");
  if (err instanceof Anthropic.PermissionDeniedError) return new Error("이 API 키로는 이 모델을 쓸 수 없습니다.");
  if (err instanceof Anthropic.NotFoundError) return new Error("모델을 찾을 수 없습니다.");
  if (err instanceof Anthropic.RateLimitError) return new Error("요청 한도를 넘었습니다. 잠시 후 다시 시도하세요.");
  if (err instanceof Anthropic.APIUserAbortError) return new Error("중단됨");
  if (err instanceof Anthropic.APIError) return new Error(`Anthropic API 오류 ${err.status ?? ""}: ${err.message}`);
  return err instanceof Error ? err : new Error(String(err));
}
