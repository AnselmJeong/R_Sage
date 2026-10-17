// GPT via the OpenAI Responses API (user's own API key). Requests are
// stateless (store: false) with encrypted reasoning carried in the history,
// so a conversation can move between providers.

import OpenAI from "openai";
import type { Provider, ToolCall, Turn, TurnRequest, TurnResult } from "./types";

type InputItem = OpenAI.Responses.ResponseInputItem;

export class OpenAIProvider implements Provider {
  readonly id = "openai" as const;
  readonly label = "GPT (OpenAI API)";
  private cachedModels?: { id: string; label: string }[];

  constructor(private apiKey: () => string | undefined) {}

  private client() {
    const key = this.apiKey();
    if (!key) throw new Error("OpenAI API 키가 설정되지 않았습니다. 설정 → AI에서 키를 입력하세요.");
    return new OpenAI({ apiKey: key });
  }

  async models() {
    if (this.cachedModels) return this.cachedModels;
    try {
      const ids: string[] = [];
      for await (const m of this.client().models.list()) ids.push(m.id);
      // Chat-capable GPT and o-series models; drop audio, realtime, image,
      // embedding, search and dated snapshots to keep the picker short.
      const chat = ids
        .filter((id) => /^(gpt-[4-9]|o[1-9])/.test(id))
        .filter((id) => !/audio|realtime|image|transcribe|tts|search|embedding|instruct|\d{4}-\d{2}-\d{2}/.test(id))
        .sort()
        .reverse();
      this.cachedModels = chat.map((id) => ({ id, label: id }));
    } catch {
      return [];
    }
    return this.cachedModels;
  }

  resetModels() {
    this.cachedModels = undefined;
  }

  async turn(req: TurnRequest): Promise<TurnResult> {
    const client = this.client();
    const stream = client.responses.stream(
      {
        model: req.model,
        instructions: req.system,
        input: toInput(req.history),
        tools: req.tools.map((t) => ({
          type: "function" as const,
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          strict: false,
        })),
        store: false,
        include: ["reasoning.encrypted_content"],
        reasoning: /^(o[1-9]|gpt-5)/.test(req.model) ? { summary: "auto" } : undefined,
      },
      { signal: req.signal },
    );
    stream.on("response.output_text.delta", (e) => req.onText(e.delta));
    stream.on("response.reasoning_summary_text.delta", (e) => req.onThinking(e.delta));
    let response: OpenAI.Responses.Response;
    try {
      response = await stream.finalResponse();
    } catch (err) {
      throw friendly(err);
    }

    const calls: ToolCall[] = [];
    let text = "";
    for (const item of response.output) {
      if (item.type === "function_call") {
        let input: any = {};
        try {
          input = JSON.parse(item.arguments || "{}");
        } catch {
          input = { __invalid_json: item.arguments };
        }
        calls.push({ id: item.call_id, name: item.name, input });
      } else if (item.type === "message") {
        for (const c of item.content) if (c.type === "output_text") text += c.text;
      }
    }
    const stop =
      response.status === "incomplete"
        ? response.incomplete_details?.reason === "max_output_tokens"
          ? "max_tokens"
          : "refusal"
        : calls.length
          ? "tool"
          : "end";
    return { text, calls, raw: response.output, stop };
  }
}

function toInput(history: Turn[]): InputItem[] {
  const out: InputItem[] = [];
  for (const t of history) {
    if (t.role === "user") out.push({ role: "user", content: t.text });
    else if (t.role === "assistant") {
      if (t.provider === "openai" && t.raw) {
        // Output items are valid input items; drop server ids (store: false).
        for (const item of t.raw as any[]) out.push({ ...item, id: item.type === "reasoning" ? item.id : undefined } as InputItem);
      } else {
        if (t.text) out.push({ role: "assistant", content: t.text });
        for (const c of t.calls) {
          out.push({ type: "function_call", call_id: c.id, name: c.name, arguments: JSON.stringify(c.input ?? {}) });
        }
      }
    } else {
      for (const r of t.results) {
        out.push({
          type: "function_call_output",
          call_id: r.callId,
          output: r.images?.length
            ? [
                { type: "input_text", text: r.output || "(no output)" },
                ...r.images.map((img) => ({ type: "input_image" as const, image_url: `data:${img.mime};base64,${img.data}`, detail: "auto" as const })),
              ]
            : r.output || "(no output)",
        });
      }
    }
  }
  return out;
}

function friendly(err: unknown): Error {
  if (err instanceof OpenAI.AuthenticationError) return new Error("OpenAI API 키가 올바르지 않습니다.");
  if (err instanceof OpenAI.NotFoundError) return new Error("모델을 찾을 수 없거나 이 키로 쓸 수 없습니다.");
  if (err instanceof OpenAI.RateLimitError) return new Error("요청 한도를 넘었습니다. 잠시 후 다시 시도하세요.");
  if (err instanceof OpenAI.APIUserAbortError) return new Error("중단됨");
  if (err instanceof OpenAI.APIError) return new Error(`OpenAI API 오류 ${err.status ?? ""}: ${err.message}`);
  return err instanceof Error ? err : new Error(String(err));
}
