// Provider-neutral conversation history. Each provider converts it to its own
// wire format per request, and keeps its own raw output alongside so that a
// conversation that stays on one provider replays exactly what it returned
// (thinking/reasoning blocks included).

import type { AssistantProviderId } from "@rsage/shared";

export interface ToolCall {
  id: string;
  name: string;
  input: any;
}

export interface ToolResult {
  callId: string;
  name: string;
  output: string;
  images?: { mime: string; data: string }[];
  isError?: boolean;
}

export type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; provider: AssistantProviderId; model: string; text: string; calls: ToolCall[]; raw?: unknown }
  | { role: "tool_results"; results: ToolResult[] };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, any>; required: string[] };
}

export interface TurnRequest {
  model: string;
  system: string;
  history: Turn[];
  tools: ToolSpec[];
  signal: AbortSignal;
  onText: (delta: string) => void;
  onThinking: (delta: string) => void;
}

export interface TurnResult {
  text: string;
  calls: ToolCall[];
  raw: unknown;
  /** "tool" when calls should run; anything else ends the loop. */
  stop: "end" | "tool" | "max_tokens" | "refusal" | "other";
}

export interface Provider {
  id: AssistantProviderId;
  label: string;
  /** Models this provider offers (live list when possible). */
  models(): Promise<{ id: string; label: string }[]>;
  turn(req: TurnRequest): Promise<TurnResult>;
}
