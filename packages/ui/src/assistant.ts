// UI state for the AI assistant: provider status, the open conversation and
// its streamed items.

import { create } from "zustand";
import type { AssistantContext, AssistantItem, AssistantStatus, Conversation, ConversationSummary } from "@rsage/shared";
import { host } from "./host/client";
import { useStore } from "./store";

interface AssistantState {
  status?: AssistantStatus;
  conversations: ConversationSummary[];
  current?: Conversation;
  running: Record<string, boolean>;
  model?: string;
  /** Send the active editor file (and selection) with each message. */
  includeContext: boolean;
}

export const useAssistant = create<AssistantState>(() => ({
  conversations: [],
  running: {},
  includeContext: true,
}));

const MODEL_KEY = "rsage.assistant.model";

function upsert(item: AssistantItem) {
  useAssistant.setState((s) => {
    if (!s.current) return {};
    const items = s.current.items.slice();
    const i = items.findIndex((x) => x.id === item.id);
    if (i >= 0) items[i] = item;
    else items.push(item);
    return { current: { ...s.current, items } };
  });
}

export async function refreshStatus(refresh = false) {
  const status = await host.call("assistant.status", { refresh });
  let model = useAssistant.getState().model;
  try {
    model ??= localStorage.getItem(MODEL_KEY) ?? undefined;
  } catch {}
  if (!model || !status.models.some((m) => m.id === model)) model = status.defaultModel;
  useAssistant.setState({ status, model });
  return status;
}

export function setModel(model: string) {
  useAssistant.setState({ model });
  try {
    localStorage.setItem(MODEL_KEY, model);
  } catch {}
}

export async function loadConversations() {
  const conversations = await host.call("assistant.list");
  useAssistant.setState({ conversations });
  const cur = useAssistant.getState().current;
  if (!cur || !conversations.some((c) => c.id === cur.id)) {
    const first = conversations[0];
    useAssistant.setState({ current: first ? ((await host.call("assistant.load", { id: first.id })) ?? undefined) : undefined });
  }
}

export async function openConversation(id: string) {
  const c = await host.call("assistant.load", { id });
  if (c) useAssistant.setState({ current: c });
}

export async function newConversation() {
  const c = await host.call("assistant.new");
  useAssistant.setState((s) => ({ current: c, conversations: [{ id: c.id, title: c.title, updatedAt: c.updatedAt }, ...s.conversations] }));
  return c;
}

export async function deleteConversation(id: string) {
  await host.call("assistant.delete", { id });
  useAssistant.setState({ current: undefined });
  await loadConversations();
}

/** Deletes every conversation of this project. */
export async function clearConversations() {
  for (const c of useAssistant.getState().conversations) await host.call("assistant.delete", { id: c.id });
  useAssistant.setState({ current: undefined });
  await loadConversations();
}

/** Sends a message. The editor file and selection go along only while that chip is on; @ references and images always do. */
export async function send(text: string, context: AssistantContext = {}) {
  const s = useAssistant.getState();
  if (!s.model) throw new Error("모델을 고르세요.");
  const conv = s.current ?? (await newConversation());
  const { file, selection, ...rest } = context;
  const ctx: AssistantContext = { ...(s.includeContext ? { file, selection } : {}), ...rest };
  const empty = !ctx.file && !ctx.refs?.length && !ctx.images?.length;
  await host.call("assistant.send", { conversationId: conv.id, text, model: s.model, context: empty ? undefined : ctx });
}

export function initAssistant() {
  host.on("assistant.item", ({ conversationId, item }) => {
    if (useAssistant.getState().current?.id === conversationId) upsert(item);
  });
  host.on("assistant.delta", ({ conversationId, itemId, text, thinking }) => {
    const cur = useAssistant.getState().current;
    if (cur?.id !== conversationId) return;
    const item = cur.items.find((x) => x.id === itemId);
    if (item?.kind !== "assistant") return;
    upsert({ ...item, text: item.text + (text ?? ""), thinking: thinking ? (item.thinking ?? "") + thinking : item.thinking });
  });
  host.on("assistant.state", ({ conversationId, running }) => {
    useAssistant.setState((s) => ({ running: { ...s.running, [conversationId]: running } }));
    if (!running) {
      void host.call("assistant.list").then((conversations) =>
        useAssistant.setState((s) => {
          // The first message names a new conversation.
          const title = conversations.find((c) => c.id === s.current?.id)?.title;
          return { conversations, current: s.current && title ? { ...s.current, title } : s.current };
        }),
      );
      // A provider error (bad key) shows up in the status.
      void refreshStatus();
    }
  });
  host.on("project.changed", () => {
    useAssistant.setState({ current: undefined });
    void loadConversations();
  });
  void refreshStatus().catch(() => {});
  if (useStore.getState().project) void loadConversations();
}
