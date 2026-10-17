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
  /** Length of the matched text, in UTF-16 units. */
  length?: number;
  text: string;
}

export interface RPackage {
  name: string;
  version: string;
  title?: string;
  libPath: string;
  /** Newer version on the repository, when an update check has run. */
  latest?: string;
}

export interface PackageList {
  packages: RPackage[];
  libPaths: string[];
  /** Packages attached in the running session (search path), when known. */
  attached?: string[];
  /** Namespaces loaded in the running session, when known. */
  loaded?: string[];
}

export interface GitChange {
  /** Absolute path. */
  path: string;
  /** For renames: the old path. */
  origPath?: string;
  /** M modified, A added, D deleted, R renamed, C copied, T type change, ? untracked, U conflict. */
  status: string;
  staged: boolean;
  conflict?: boolean;
}

export interface GitStatus {
  isRepo: boolean;
  gitMissing?: boolean;
  root?: string;
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  detached?: boolean;
  hasCommits?: boolean;
  remotes?: string[];
  changes: GitChange[];
}

export interface GitBranch {
  name: string;
  remote: boolean;
  current: boolean;
  upstream?: string;
  date?: number;
}

export interface GitCommit {
  hash: string;
  short: string;
  author: string;
  email: string;
  /** ms since epoch */
  date: number;
  refs: string[];
  subject: string;
  parents: string[];
}

export interface CranPackage {
  name: string;
  version: string;
  title?: string;
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

// ---------- comms (Positron extensions to Jupyter) ----------

export interface CommInfo {
  commId: string;
  /** positron.ui, positron.variables, positron.help, positron.plot, positron.dataExplorer */
  target: string;
  data: any;
  /** Execution that created it (plots, data viewers). */
  executionId?: string;
  openedAt: string;
}

/** A variable row from the variables comm (Ark's Variable type). */
export interface RVariable {
  access_key: string;
  display_name: string;
  display_value: string;
  display_type: string;
  type_info: string;
  size: number;
  kind: string;
  length: number;
  has_children: boolean;
  has_viewer: boolean;
  is_truncated: boolean;
  updated_time: number;
}

// ---------- AI assistant ----------

/**
 * anthropic / openai: API keys. claude-code / codex: the user's own Claude or
 * ChatGPT subscription, through the Claude Code and Codex they logged in to.
 */
export type AssistantProviderId = "anthropic" | "openai" | "claude-code" | "codex" | "fake";

export interface AssistantModel {
  id: string;
  label: string;
  provider: AssistantProviderId;
}

export interface AssistantProviderStatus {
  id: AssistantProviderId;
  label: string;
  configured: boolean;
  /** Where the key came from; "login" for a subscription login. */
  source?: "keychain" | "file" | "env" | "login";
  /** Subscription providers (Claude Code, Codex): the app's own login and usage. */
  subscription?: SubscriptionStatus;
  /** Last error talking to the provider (bad key, network). */
  error?: string;
}

/** One usage window of a subscription (e.g. the 5-hour or weekly limit). */
export interface SubscriptionQuota {
  label: string;
  /** 0-100, when the service reports it. */
  usedPercent?: number;
  /** Unix seconds. */
  resetsAt?: number;
  /** Claude's own word for the limit ("allowed", "allowed_warning", "rejected"). */
  status?: string;
}

/**
 * A subscription login made inside R Sage. Each agent gets its own config
 * folder, so this login is separate from the user's terminal login.
 */
export interface SubscriptionStatus {
  state: "unavailable" | "signedOut" | "signingIn" | "connected" | "error";
  cliPath?: string;
  cliVersion?: string;
  email?: string;
  plan?: string;
  error?: string;
  quotas: SubscriptionQuota[];
  /** When the quotas were last seen (ms). */
  quotaCheckedAt?: number;
}

/** How far an approved file change reaches: this change, this file, or the whole project. */
export type EditApprovalScope = "once" | "file" | "project";

export interface AssistantStatus {
  providers: AssistantProviderStatus[];
  models: AssistantModel[];
  defaultModel?: string;
  /** Run R code from the assistant without asking each time. */
  autoRunR: boolean;
  /** File changes in the open project are applied without asking. */
  autoApproveEdits: boolean;
}

/** Something the user attached to a message with @: a project file or folder, or an earlier conversation. */
export type AssistantRef = { kind: "file" | "folder"; path: string } | { kind: "conversation"; id: string; title: string };

/** An image attached to a message (base64, no data: prefix). */
export interface AssistantImage {
  mime: string;
  data: string;
  name?: string;
}

export interface AssistantContext {
  /** Active editor file (absolute path). */
  file?: string;
  selection?: { text: string; startLine: number; endLine: number };
  refs?: AssistantRef[];
  images?: AssistantImage[];
}

export type AssistantToolStatus = "awaiting-approval" | "running" | "done" | "error" | "denied";

export type AssistantItem =
  | { kind: "user"; id: string; text: string; context?: AssistantContext; at: string }
  | { kind: "assistant"; id: string; text: string; thinking?: string; model: string; at: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: any;
      status: AssistantToolStatus;
      /** What the tool returned to the model (truncated for display). */
      output?: string;
      /** Plots or images the tool produced, as data: URLs. */
      images?: string[];
      /** Proposed file change, shown as a diff before approval. */
      diff?: { path: string; before: string; after: string; isNew: boolean };
      executionId?: string;
      at: string;
    }
  | { kind: "error"; id: string; text: string; at: string };

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface Conversation extends ConversationSummary {
  createdAt: string;
  model?: string;
  items: AssistantItem[];
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
  "fs.browse": { params: { path?: string; files?: boolean }; result: { path: string; parent: string | null; entries: FileEntry[] } };
  /** Every file in the project (relative paths), for quick open. */
  "fs.walk": { params: {}; result: { files: string[]; truncated: boolean } };
  "fs.read": { params: { path: string }; result: { content: string; mtimeMs: number } };
  "fs.write": {
    params: { path: string; content: string; expectedMtimeMs?: number; force?: boolean };
    result: { ok: true; mtimeMs: number } | { ok: false; conflict: true; mtimeMs: number };
  };
  "fs.create": { params: { path: string; kind: "file" | "dir" }; result: void };
  /** Copy a file from anywhere into the project (e.g. an image picked from Finder). */
  "fs.copyIn": { params: { from: string; to: string }; result: void };
  "fs.rename": { params: { from: string; to: string }; result: void };
  "fs.trash": { params: { path: string }; result: void };

  "search.text": {
    params: { query: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; glob?: string; exclude?: string };
    result: { matches: SearchMatch[]; truncated: boolean };
  };
  "search.replace": {
    params: { query: string; replacement: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; paths: string[] };
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

  "comm.list": { params: {}; result: CommInfo[] };
  /** JSON-RPC request on a comm; params omitted for unit-variant requests. */
  "comm.rpc": { params: { commId: string; method: string; params?: unknown }; result: unknown };
  "comm.close": { params: { commId: string }; result: void };
  /** Answer a kernel → frontend request (show_question and friends). */
  "frontend.reply": { params: { id: string; result?: unknown; error?: string }; result: void };
  /** Write base64 data to a project file (plot export). */
  "fs.writeBase64": { params: { path: string; data: string }; result: void };

  "assistant.status": { params: { refresh?: boolean }; result: AssistantStatus };
  /** Store (or with key null, remove) a provider's API key. */
  "assistant.setKey": { params: { provider: AssistantProviderId; key: string | null }; result: AssistantStatus };
  /** Start the subscription sign-in in the browser; status turns "signingIn" until it completes. */
  "assistant.login": { params: { provider: AssistantProviderId }; result: AssistantStatus };
  "assistant.cancelLogin": { params: { provider: AssistantProviderId }; result: AssistantStatus };
  "assistant.logout": { params: { provider: AssistantProviderId }; result: AssistantStatus };
  "assistant.setOptions": { params: { autoRunR?: boolean; defaultModel?: string; autoApproveEdits?: boolean }; result: AssistantStatus };
  "assistant.list": { params: {}; result: ConversationSummary[] };
  "assistant.load": { params: { id: string }; result: Conversation | null };
  "assistant.new": { params: {}; result: Conversation };
  "assistant.delete": { params: { id: string }; result: void };
  "assistant.send": { params: { conversationId: string; text: string; model: string; context?: AssistantContext }; result: void };
  "assistant.stop": { params: { conversationId: string }; result: void };
  "assistant.approve": { params: { conversationId: string; itemId: string; approve: boolean; always?: boolean; scope?: EditApprovalScope }; result: void };

  /** Run R code from a document chunk; resolves with what it printed and drew. */
  "console.runCell": {
    params: { code: string; source?: SourceRef };
    result: { executionId: string; status: ExecutionRecord["status"]; text: string; isError: boolean; images: { mime: string; data: string }[] };
  };
  "quarto.info": { params: {}; result: { path?: string; version?: string } };
  /** Starts a render; progress comes as quarto.log, the end as quarto.done. */
  "quarto.render": { params: { path: string; to?: string }; result: { renderId: string } };
  "quarto.stop": { params: { renderId: string }; result: void };
  /** A local http URL that shows a project file (rendered pages, images). */
  "preview.url": { params: { path: string }; result: string };

  "dialog.pickFolder": { params: { title?: string }; result: string | null };
  /** Native file dialog; null when cancelled or when the shell has none. */
  "dialog.pickFile": { params: { title?: string; extensions?: string[]; startingFolder?: string }; result: string | null };

  /** Installed packages, read by a separate Rscript so a busy session doesn't block it. */
  "packages.list": { params: {}; result: PackageList };
  /** Installed packages with a newer CRAN version. */
  "packages.outdated": { params: {}; result: { name: string; installed: string; latest: string }[] };
  "git.status": { params: {}; result: GitStatus };
  "git.init": { params: {}; result: void };
  /** The two sides of a diff: working tree vs index, index vs HEAD, or a commit vs its parent. */
  "git.diff": { params: { path: string; origPath?: string; mode: "working" | "staged" | "commit"; hash?: string }; result: { original: string; modified: string } };
  "git.stage": { params: { paths: string[] }; result: void };
  "git.unstage": { params: { paths: string[] }; result: void };
  /** Tracked files go back to their committed state; untracked ones go to the Trash. */
  "git.discard": { params: { paths: string[]; untracked?: string[] }; result: void };
  "git.commit": { params: { message: string; amend?: boolean; all?: boolean }; result: { summary: string } };
  "git.branches": { params: {}; result: GitBranch[] };
  "git.checkout": { params: { branch: string; create?: boolean }; result: void };
  "git.pull": { params: {}; result: { output: string } };
  "git.push": { params: {}; result: { output: string } };
  "git.fetch": { params: {}; result: void };
  "git.log": { params: { limit?: number; path?: string }; result: GitCommit[] };
  "git.commitFiles": { params: { hash: string }; result: GitChange[] };
  "git.addRemote": { params: { name: string; url: string }; result: void };
  /** Adds a pattern to the .gitignore at the repository root. */
  "git.ignore": { params: { pattern: string }; result: void };
  "packages.searchCran": { params: { query: string; limit?: number }; result: CranPackage[] };
  "shell.openExternal": { params: { path: string }; result: void };
}

export type MethodName = keyof HostMethods;
export type Params<M extends MethodName> = HostMethods[M]["params"];
export type Result<M extends MethodName> = HostMethods[M]["result"];

// ---------- events ----------

export interface HostEvents {
  "quarto.log": { renderId: string; text: string };
  "quarto.done": { renderId: string; ok: boolean; output?: string; error?: string };
  "session.state": SessionInfo;
  "console.output": OutputEvent;
  execution: ExecutionRecord;
  "project.changed": ProjectInfo | null;
  "fs.changed": { paths: string[] };
  "terminal.data": { id: string; data: string };
  "terminal.exit": { id: string; code: number | null };
  "lsp.notification": { method: string; params: any };
  "lsp.state": { running: boolean };
  "comm.open": CommInfo;
  "comm.event": { commId: string; target: string; method: string; params: any };
  "comm.close": { commId: string; target: string };
  /** The kernel is waiting for the UI to answer (frontend.reply). */
  "frontend.request": { id: string; method: string; params: any };
  /** A conversation item was added or changed (replace by id). */
  "assistant.item": { conversationId: string; item: AssistantItem };
  /** Streaming text for an assistant item. */
  "assistant.delta": { conversationId: string; itemId: string; text?: string; thinking?: string };
  "assistant.state": { conversationId: string; running: boolean };
  /** Native menu → UI command registry (desktop shell). */
  "ui.command": { id: string };
}

export type EventName = keyof HostEvents;

// ---------- wire envelope ----------

export type WireMessage =
  | { t: "req"; id: number; method: string; params: unknown }
  | { t: "res"; id: number; result?: unknown; error?: string }
  | { t: "evt"; type: string; payload: unknown };
