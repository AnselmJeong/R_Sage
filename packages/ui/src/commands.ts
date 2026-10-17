// Command registry: every user action is a command with an id, a title and an
// optional key binding. The palette, menus and (later) plugins go through it.

import { useStore } from "./store";

export interface Command {
  id: string;
  title: string;
  category?: string;
  /** e.g. "Mod+Shift+P" — Mod is Cmd on macOS, Ctrl elsewhere. */
  key?: string;
  /** Only run from the global handler when this returns true. */
  when?: () => boolean;
  run: () => unknown;
}

const commands = new Map<string, Command>();
const listeners = new Set<() => void>();

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function registerCommand(c: Command): () => void {
  commands.set(c.id, c);
  listeners.forEach((l) => l());
  return () => {
    commands.delete(c.id);
    listeners.forEach((l) => l());
  };
}

export function allCommands(): Command[] {
  return [...commands.values()];
}

export function onCommandsChanged(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function runCommand(id: string) {
  const c = commands.get(id);
  if (!c) return;
  try {
    await c.run();
  } catch (err) {
    useStore.getState().notify((err as Error).message, "error");
  }
}

export function formatKey(key?: string): string {
  if (!key) return "";
  return key
    .split("+")
    .map((k) => {
      if (k === "Mod") return isMac ? "⌘" : "Ctrl";
      if (k === "Shift") return isMac ? "⇧" : "Shift";
      if (k === "Alt") return isMac ? "⌥" : "Alt";
      if (k === "Ctrl") return isMac ? "⌃" : "Ctrl";
      if (k === "Enter") return "↵";
      return k.length === 1 ? k.toUpperCase() : k;
    })
    .join(isMac ? "" : "+");
}

export function eventMatches(e: KeyboardEvent, key: string): boolean {
  const parts = key.split("+");
  const main = parts[parts.length - 1]!;
  const want = new Set(parts.slice(0, -1));
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (want.has("Mod") !== mod) return false;
  if (want.has("Shift") !== e.shiftKey) return false;
  if (want.has("Alt") !== e.altKey) return false;
  const ctrlWanted = want.has("Ctrl") || (!isMac && want.has("Mod"));
  if (ctrlWanted !== e.ctrlKey) return false;
  if (isMac && !want.has("Mod") && e.metaKey) return false;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const code = e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : e.code.startsWith("Digit") ? e.code.slice(5) : "";
  const m = main.length === 1 ? main.toLowerCase() : main;
  return k === m || code === m || (m === "`" && e.code === "Backquote");
}

export function installGlobalKeys() {
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.isComposing) return;
      for (const c of commands.values()) {
        if (!c.key || !eventMatches(e, c.key)) continue;
        if (c.when && !c.when()) continue;
        e.preventDefault();
        e.stopPropagation();
        void runCommand(c.id);
        return;
      }
    },
    true,
  );
}
