import { create } from "zustand";
import type {
  AppInfo,
  ExecutionRecord,
  OutputEvent,
  ProjectInfo,
  RecentProject,
  RInstallation,
  SessionInfo,
} from "@rsage/shared";
import { host } from "./host/client";

export type ConsoleItem =
  | { key: number; type: "input"; executionId: string; code: string; generation: number }
  | { key: number; type: "stream"; executionId?: string; name: "stdout" | "stderr"; text: string }
  | { key: number; type: "result"; executionId?: string; text: string }
  | { key: number; type: "display"; executionId?: string; data: Record<string, unknown> }
  | { key: number; type: "error"; executionId?: string; ename: string; evalue: string; traceback: string[] }
  | { key: number; type: "system"; text: string; level: "info" | "warn" | "error" };

export interface OpenFile {
  path: string;
  dirty: boolean;
  mtimeMs: number;
  /** Set when the file changed on disk while it had unsaved edits. */
  externalChange?: boolean;
  /** A crash-recovery backup newer than the file exists. */
  hasBackup?: boolean;
}

export type NewConsoleItem = ConsoleItem extends infer T ? (T extends ConsoleItem ? Omit<T, "key"> : never) : never;

const MAX_CONSOLE_ITEMS = 4000;
let itemKey = 1;

interface State {
  connected: boolean;
  app?: AppInfo;
  project: ProjectInfo | null;
  recent: RecentProject[];
  rList: RInstallation[];
  session: SessionInfo;
  lspRunning: boolean;
  console: ConsoleItem[];
  executions: Record<string, ExecutionRecord>;
  inputRequest?: { prompt: string; password: boolean };
  openFiles: Record<string, OpenFile>;
  activeFile?: string;
  toast?: { text: string; level: "info" | "error"; at: number };

  pushConsole(item: NewConsoleItem): void;
  clearConsole(): void;
  onOutput(o: OutputEvent): void;
  notify(text: string, level?: "info" | "error"): void;
  setFile(path: string, patch: Partial<OpenFile> | null): void;
}

export const useStore = create<State>((set, get) => ({
  connected: false,
  project: null,
  recent: [],
  rList: [],
  session: { state: "stopped", generation: 0 },
  lspRunning: false,
  console: [],
  executions: {},
  openFiles: {},

  pushConsole(item) {
    set((s) => {
      const next = [...s.console, { ...item, key: itemKey++ } as ConsoleItem];
      return { console: next.length > MAX_CONSOLE_ITEMS ? next.slice(-MAX_CONSOLE_ITEMS) : next };
    });
  },

  clearConsole() {
    set({ console: [] });
  },

  onOutput(o) {
    const s = get();
    switch (o.kind) {
      case "input":
        s.pushConsole({ type: "input", executionId: o.executionId, code: o.code, generation: s.session.generation });
        break;
      case "stream": {
        // Merge consecutive chunks of the same stream: R prints in small pieces.
        const last = s.console[s.console.length - 1];
        if (last && last.type === "stream" && last.name === o.name && last.executionId === o.executionId) {
          const merged = { ...last, text: last.text + o.text };
          set({ console: [...s.console.slice(0, -1), merged] });
        } else {
          s.pushConsole({ type: "stream", executionId: o.executionId, name: o.name, text: o.text });
        }
        break;
      }
      case "result": {
        const text = o.data["text/plain"];
        if (typeof text === "string") s.pushConsole({ type: "result", executionId: o.executionId, text });
        else s.pushConsole({ type: "display", executionId: o.executionId, data: o.data });
        break;
      }
      case "display":
        s.pushConsole({ type: "display", executionId: o.executionId, data: o.data });
        break;
      case "error":
        s.pushConsole({ type: "error", executionId: o.executionId, ename: o.ename, evalue: o.evalue, traceback: o.traceback });
        break;
      case "input_request":
        set({ inputRequest: { prompt: o.prompt, password: o.password } });
        break;
      case "done":
        if (get().inputRequest) set({ inputRequest: undefined });
        break;
    }
  },

  notify(text, level = "info") {
    set({ toast: { text, level, at: Date.now() } });
  },

  setFile(path, patch) {
    set((s) => {
      const openFiles = { ...s.openFiles };
      if (patch === null) delete openFiles[path];
      else openFiles[path] = { ...(openFiles[path] ?? { path, dirty: false, mtimeMs: 0 }), ...patch };
      return { openFiles };
    });
  },
}));

/** Wire host events into the store. Called once after connecting. */
export async function initStore() {
  const st = useStore.getState();
  host.on("session.state", (session) => {
    const prev = useStore.getState().session;
    useStore.setState({ session });
    if (session.state === "exited" && prev.state !== "exited") {
      st.pushConsole({ type: "system", level: "error", text: session.crashMessage ?? "R 세션이 종료되었습니다." });
    }
    if (session.state === "idle" && prev.generation !== session.generation && session.generation > 0) {
      st.pushConsole({
        type: "system",
        level: "info",
        text: `R ${session.rVersion ?? ""} 세션 시작 (세대 ${session.generation}) · ${session.cwd ?? ""}`,
      });
    }
  });
  host.on("console.output", (o) => useStore.getState().onOutput(o));
  host.on("execution", (rec) => useStore.setState((s) => ({ executions: { ...s.executions, [rec.id]: rec } })));
  host.on("project.changed", (project) => useStore.setState({ project }));
  host.on("lsp.state", ({ running }) => useStore.setState({ lspRunning: running }));
  host.on("ui.command", ({ id }) => void import("./commands").then((c) => c.runCommand(id)));

  const [app, project, recent, session, lsp] = await Promise.all([
    host.call("app.info"),
    host.call("project.current"),
    host.call("project.recent"),
    host.call("session.info"),
    host.call("lsp.status"),
  ]);
  useStore.setState({ connected: true, app, project, recent, session, lspRunning: lsp.running });
  host.call("r.list", {}).then((rList) => useStore.setState({ rList }));
  (await import("./comms")).initComms();
}
