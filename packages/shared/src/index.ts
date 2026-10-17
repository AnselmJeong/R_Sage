// The contract between the R Sage host (Bun main process) and the UI.
//
// The same envelope travels over Electrobun's typed RPC inside the app and
// over a token-protected WebSocket in browser dev mode, so the UI never
// knows which shell it runs in. The page gets no privileged API beyond
// these methods.

// ---------- domain types ----------

export interface RInstallation {
  home: string;
  binary: string;
  version: string;
  banner: string;
  arch: string;
  source: string;
  tooOld: boolean;
  isPathDefault?: boolean;
}

export type SessionStateName =
  | "stopped"
  | "starting"
  | "idle"
  | "busy"
  | "interrupting"
  | "restarting"
  | "exited";

export interface SessionInfo {
  state: SessionStateName;
  generation: number;
  rHome?: string;
  rVersion?: string;
  pid?: number;
  cwd?: string;
  logFile?: string;
  exitCode?: number | null;
  crashMessage?: string;
  /** Resident memory of the R process in bytes, sampled periodically. */
  memoryBytes?: number;
}

export interface SourceRef {
  file: string;
  line: number;
  endLine?: number;
}

export interface ExecutionRecord {
  id: string;
  generation: number;
  code: string;
  source?: SourceRef;
  origin: "console" | "editor" | "app" | "ai";
  executionCount?: number;
  startedAt: string;
  finishedAt?: string;
  status: "queued" | "running" | "ok" | "error" | "aborted";
  error?: { ename: string; evalue: string; traceback: string[] };
  outputs: string[];
}

export type OutputEvent =
  | { kind: "input"; executionId: string; code: string; executionCount?: number }
  | { kind: "stream"; executionId?: string; name: "stdout" | "stderr"; text: string }
  | { kind: "result"; executionId?: string; data: Record<string, unknown> }
  | { kind: "display"; executionId?: string; data: Record<string, unknown>; displayId?: string }
  | { kind: "error"; executionId?: string; ename: string; evalue: string; traceback: string[] }
  | { kind: "input_request"; prompt: string; password: boolean }
  | { kind: "done"; executionId: string; status: ExecutionRecord["status"] };

export interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "dir";
  size?: number;
  mtimeMs?: number;
}

export interface ProjectSettings {
  /** R_HOME to use for this project; empty = app default. */
  rHome?: string;
  quartoPath?: string;
  outputDir?: string;
  ai?: { provider?: string; model?: string };
}

export interface ProjectInfo {
  path: string;
  name: string;
  settings: ProjectSettings;
}

export interface RecentProject {
  path: string;
  name: string;
  openedAt: string;
}

/** Workspace state restored when a project reopens. */
export interface WorkspaceState {
  openFiles: { path: string; cursor?: { line: number; column: number } }[];
  activeFile?: string;
  layout?: unknown;
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

export interface BackupEntry {
  path: string;
  savedAt: string;
}

export interface AppInfo {
  version: string;
  shell: "electrobun" | "browser";
  platform: string;
  arkPath?: string;
  arkVersion: string;
  homeDir: string;
}

export interface Diagnostic {
  severity: "error" | "warning" | "info";
  message: string;
}

// ---------- methods ----------

export interface HostMethods {
  "app.info": { params: {}; result: AppInfo };
  "app.diagnostics": { params: {}; result: { checks: { name: string; ok: boolean; detail: string }[] } };

  "r.list": { params: { refresh?: boolean }; result: RInstallation[] };
  "r.addManual": { params: { path: string }; result: RInstallation | null };
  "r.setDefault": { params: { home: string }; result: void };

  "session.info": { params: {}; result: SessionInfo };
  "session.start": { params: { rHome?: string }; result: SessionInfo };
  "session.restart": { params: { rHome?: string }; result: SessionInfo };
  "session.interrupt": { params: {}; result: void };
  "session.stop": { params: {}; result: void };
  "session.libPaths": { params: {}; result: string[] };

  "console.execute": {
    params: { code: string; origin?: ExecutionRecord["origin"]; source?: SourceRef };
    result: { executionId: string };
  };
  "console.isComplete": { params: { code: string }; result: "complete" | "incomplete" | "invalid" | "unknown" };
  "console.input": { params: { value: string }; result: void };
  "console.history": { params: {}; result: string[] };
  "console.saveHistory": { params: { path: string }; result: void };

  "history.list": { params: { limit?: number }; result: ExecutionRecord[] };

  "project.open": { params: { path: string }; result: ProjectInfo };
  "project.create": { params: { path: string }; result: ProjectInfo };
  "project.close": { params: {}; result: void };
  "project.current": { params: {}; result: ProjectInfo | null };
  "project.recent": { params: {}; result: RecentProject[] };
  "project.updateSettings": { params: { settings: ProjectSettings }; result: ProjectInfo };
  "project.saveState": { params: { state: WorkspaceState }; result: void };
  "project.loadState": { params: {}; result: WorkspaceState | null };

  "fs.list": { params: { path: string }; result: FileEntry[] };
  "fs.browse": { params: { path?: string }; result: { path: string; parent: string | null; entries: FileEntry[] } };
  "fs.read": { params: { path: string }; result: { content: string; mtimeMs: number } };
  "fs.write": {
    params: { path: string; content: string; expectedMtimeMs?: number; force?: boolean };
    result: { ok: true; mtimeMs: number } | { ok: false; conflict: true; mtimeMs: number };
  };
  "fs.create": { params: { path: string; kind: "file" | "dir" }; result: void };
  "fs.rename": { params: { from: string; to: string }; result: void };
  "fs.trash": { params: { path: string }; result: void };

  "search.text": {
    params: { query: string; regex?: boolean; caseSensitive?: boolean; glob?: string };
    result: { matches: SearchMatch[]; truncated: boolean };
  };
  "search.replace": {
    params: { query: string; replacement: string; regex?: boolean; caseSensitive?: boolean; paths: string[] };
    result: { files: number; replacements: number };
  };

  "backup.write": { params: { path: string; content: string }; result: void };
  "backup.list": { params: {}; result: BackupEntry[] };
  "backup.read": { params: { path: string }; result: string | null };
  "backup.discard": { params: { path: string }; result: void };

  "terminal.create": { params: { cols: number; rows: number }; result: { id: string } };
  "terminal.write": { params: { id: string; data: string }; result: void };
  "terminal.resize": { params: { id: string; cols: number; rows: number }; result: void };
  "terminal.kill": { params: { id: string }; result: void };

  "lsp.request": { params: { method: string; params: unknown }; result: unknown };
  "lsp.notify": { params: { method: string; params: unknown }; result: void };
  "lsp.status": { params: {}; result: { running: boolean } };

  "dialog.pickFolder": { params: { title?: string }; result: string | null };
  "shell.openExternal": { params: { path: string }; result: void };
}

export type MethodName = keyof HostMethods;
export type Params<M extends MethodName> = HostMethods[M]["params"];
export type Result<M extends MethodName> = HostMethods[M]["result"];

// ---------- events ----------

export interface HostEvents {
  "session.state": SessionInfo;
  "console.output": OutputEvent;
  execution: ExecutionRecord;
  "project.changed": ProjectInfo | null;
  "fs.changed": { paths: string[] };
  "terminal.data": { id: string; data: string };
  "terminal.exit": { id: string; code: number | null };
  "lsp.notification": { method: string; params: any };
  "lsp.state": { running: boolean };
}

export type EventName = keyof HostEvents;

// ---------- wire envelope ----------

export type WireMessage =
  | { t: "req"; id: number; method: string; params: unknown }
  | { t: "res"; id: number; result?: unknown; error?: string }
  | { t: "evt"; type: string; payload: unknown };
