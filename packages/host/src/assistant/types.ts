// Provider-neutral conversation history. Each provider converts it to its own
// wire format per request, and keeps its own raw output alongside so that a
// conversation that stays on one provider replays exactly what it returned
// (thinking/reasoning blocks included).

import type { AssistantProviderId, SubscriptionStatus } from "@rsage/shared";

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

/**
 * A provider that runs its own agent loop (Claude Code, Codex) and calls the
 * app's tools over MCP. Used for subscription logins, which only these
 * agents carry.
 */
export interface AgentRunRequest {
  model: string;
  system: string;
  /** This turn's message, with earlier turns the agent has not seen prepended. */
  prompt: string;
  /** The agent's own session id from the previous run, to resume. */
  sessionId?: string;
  cwd: string;
  mcp: { url: string; token: string };
  signal: AbortSignal;
  onText: (delta: string) => void;
  onThinking: (delta: string) => void;
  /** The agent started a new message (after a tool call). */
  onMessage: () => void;
  /** A tool the agent ran itself (not one of ours), shown for transparency. */
  onOwnTool: (t: { key: string; name: string; input: any; output?: string; status: "running" | "done" | "error" }) => void;
}

export interface AgentProvider {
  kind: "agent";
  id: AssistantProviderId;
  label: string;
  /** The app's own subscription login; `refresh` re-asks the CLI instead of using the last answer. */
  connection(refresh?: boolean): Promise<SubscriptionStatus>;
  /** Starts the browser sign-in; `open` shows a URL when the CLI does not open one itself. */
  login(open: (url: string) => void): Promise<void>;
  cancelLogin(): Promise<void>;
  logout(): Promise<void>;
  /** Models for a connected login. */
  models(): Promise<{ id: string; label: string }[]>;
  /** Runs one user turn to the end. Returns the session id to resume next time and the final text. */
  run(req: AgentRunRequest): Promise<{ sessionId?: string; text: string }>;
  dispose?(): void;
}
