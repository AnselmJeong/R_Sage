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

export type PlotExportFormat = "png" | "jpeg" | "tiff" | "svg" | "pdf";

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

// ---------- analysis modules ----------

/** A menu command that opens an analysis, e.g. 회귀 › 로지스틱 회귀 with family = binomial. */
export interface AnalysisMenuEntry {
  /** [category, command]; the category groups commands in the 분석 menu. */
  menu: string[];
  /** Title of analyses opened from this entry. */
  title: string;
  /** Options the entry sets before the user changes anything. */
  preset?: any;
}

/** One analysis a module offers (e.g. org.rsage.missing/missing). */
export interface AnalysisDef {
  /** "<moduleId>/<analysisId>" */
  key: string;
  moduleId: string;
  id: string;
  title: string;
  /** Path of the first menu entry: [category, command]. */
  menu: string[];
  /** Places the analysis appears in the 분석 menu, each possibly with preset options (JASP-style: category › command). */
  entries: AnalysisMenuEntry[];
  /** JSON Schema of the options (a small subset: object, array, string, integer, number, boolean, enum, null). */
  schema: any;
  /** Form layout (form.json). */
  form: AnalysisForm;
  summary: string;
  /** ai.md: how the assistant should use it. */
  guide: string;
  requiresDataset: boolean;
}

export interface AnalysisModuleInfo {
  id: string;
  version: string;
  title: string;
  description: string;
  rPackage: string;
  /** Packages the module's R code cannot load without. */
  requires: string[];
  backends: { package: string; role: string; required: boolean }[];
  analyses: AnalysisDef[];
}

/** Common fields of a form control. See docs/module-authoring-guide.md. */
interface AnalysisControlBase {
  /** Dotted path of the option in the options schema, e.g. "plots.upset". */
  bind: string;
  label: string;
  /** One line under the control: what this gives the user and when it helps. */
  description?: string;
  /** Short hint about how to fill the control in. */
  hint?: string;
  /** Backend function behind the option, shown as a tag (e.g. "naniar::gg_miss_upset"). */
  fn?: string;
  /** R packages the option needs beyond the module's required ones; shown as a tag. */
  requires?: string[];
  /** Hidden unless the condition holds. */
  visibleWhen?: AnalysisCondition;
  /** Shown but greyed out unless the condition holds, so the user still sees the possibility. */
  enabledWhen?: AnalysisCondition;
  /** Shown while disabled, saying what turns it on (e.g. "그룹 변수를 넣으면 쓸 수 있습니다"). */
  disabledHint?: string;
}

export type AnalysisFormControl =
  /** A role box in the variable transfer block (several variables). */
  | (AnalysisControlBase & { type: "variables"; types?: AnalysisVarType[] })
  /** A role box in the variable transfer block (one variable). */
  | (AnalysisControlBase & { type: "variable"; optional?: boolean; types?: AnalysisVarType[] })
  /**
   * A compact column picker inside an option section (e.g. the x axis of a plot).
   * `from`: only the columns named in these options (e.g. the chosen predictors).
   * `emptyLabel`: the choice for none, when none means something.
   */
  | (AnalysisControlBase & { type: "column"; types?: AnalysisVarType[]; from?: string[]; emptyLabel?: string })
  /** One value of the column named in the option `column` (e.g. the outcome's event level). */
  | (AnalysisControlBase & { type: "level"; column: string; emptyLabel?: string })
  /**
   * Model cards built from structured terms: `bind` holds the models
   * ({id, label, termIds, intercept}), `terms` the term list ({id, kind,
   * variable | components}). Main terms follow the variables in `predictors`;
   * interactions keep strong hierarchy.
   */
  | (AnalysisControlBase & { type: "models"; terms: string; predictors: string[]; outcome?: string; maxOrder?: number })
  /** One of the models in the option `models`, by id; null is `emptyLabel` (e.g. "마지막 모형"). */
  | (AnalysisControlBase & { type: "model"; models: string; emptyLabel?: string })
  /** Several terms of the option `terms`, by id, as chips. */
  | (AnalysisControlBase & { type: "termChoice"; terms: string; emptyLabel?: string })
  | (AnalysisControlBase & { type: "list" | "text"; placeholder?: string })
  /** A checkbox; `controls` are its sub-options, indented and greyed out while it is off. */
  | (AnalysisControlBase & { type: "checkbox"; controls?: AnalysisFormControl[] })
  | (AnalysisControlBase & { type: "number"; unit?: string })
  /** `choicesBy`: the enum values to offer for each value of another option (e.g. links per family). */
  | (AnalysisControlBase & { type: "select"; labels?: Record<string, string>; choicesBy?: { bind: string; values: Record<string, string[]> } })
  /**
   * Rules the user adds one row at a time (e.g. "나이 0 ~ 120"). The option is
   * an array of objects; `fields` are its keys, shown as columns of the row.
   */
  | (AnalysisControlBase & { type: "rows"; fields: AnalysisRowField[]; addLabel?: string })
  /** A labelled group of controls inside a section, like JASP's "Central tendency". */
  | { type: "group"; label: string; description?: string; controls: AnalysisFormControl[]; visibleWhen?: AnalysisCondition };

/** One column of a `rows` control. A select takes its choices from the item schema's enum. */
export interface AnalysisRowField {
  key: string;
  label: string;
  /** level: one value of the column picked in this row's `column` field. */
  type: "column" | "text" | "select" | "level";
  column?: string;
  types?: AnalysisVarType[];
  placeholder?: string;
  labels?: Record<string, string>;
  /** A column field's choice for "none", when none means something (e.g. "every text variable"). */
  emptyLabel?: string;
}

/**
 * Variable types a role box accepts (all when left out). numeric covers
 * integer and double, factor covers ordered factors, date covers Date and
 * date-times.
 */
export type AnalysisVarType = "numeric" | "factor" | "ordered" | "character" | "logical" | "date";

/** A condition on another option: equal to a value, one of several (`in`), or (filled) not empty. */
export interface AnalysisCondition {
  bind: string;
  equals?: unknown;
  in?: unknown[];
  filled?: boolean;
}

/** @deprecated Use AnalysisCondition. */
export type AnalysisVisibleWhen = AnalysisCondition;


/**
 * A use case the backend package showcases, offered in the form's "이 분석으로
 * 할 수 있는 것" list. Turning it on sets `enable` in the options.
 */
export interface AnalysisShowcase {
  title: string;
  description: string;
  /** Backend functions behind it, shown as tags. */
  fn?: string[];
  enable: Record<string, unknown>;
  /** What the user still has to choose after turning it on (e.g. "X·Y 변수를 고르세요"). */
  needs?: string;
  /** Options that must be filled before it works; `needs` shows while any is empty. */
  needsFilled?: string[];
  /** Not in this version yet: shown as 예정, with no switch. `enable` is then empty. */
  planned?: boolean;
}

export interface AnalysisForm {
  formVersion: number;
  /** What the analysis can do, shown above the variables. */
  about?: { summary?: string; links?: { label: string; url: string }[]; showcase?: AnalysisShowcase[] };
  /** Variable roles, shown as the transfer block under the data picker. */
  roles?: Extract<AnalysisFormControl, { type: "variables" | "variable" }>[];
  sections: { title: string; description?: string; open?: boolean; controls: AnalysisFormControl[] }[];
}

/** Whether the module's R packages and their dependencies are ready in the current R. */
export interface AnalysisRuntimeStatus {
  ready: boolean;
  /** R library the app installs its own packages into. */
  libPath?: string;
  /** Needed and not installed: the analysis cannot run. */
  missing: string[];
  /** Backends that are not installed: parts of the analysis fall back or are skipped. */
  missingOptional: string[];
  error?: string;
}

/** A data frame in the R session's global environment. */
export interface AnalysisDataset {
  name: string;
  rows: number;
  columns: { name: string; type: string }[];
}

export interface AnalysisTableColumn {
  id: string;
  label: string;
  type: "number" | "integer" | "string" | "logical";
}

export interface AnalysisTable {
  id: string;
  title: string;
  columns: AnalysisTableColumn[];
  rows: Record<string, unknown>[];
  notes: string[];
  /** How to read the table, shown under its title. */
  description?: string;
  /** Result section it belongs to (AnalysisResult.sections). */
  section?: string;
}

export interface AnalysisResult {
  runId: string;
  title: string;
  tables: AnalysisTable[];
  /**
   * Plots with the image inlined as a data: URL. width/height are inches;
   * autoWidth/autoHeight the size the module chose from the content.
   * rds is the saved plot, for redrawing it in the Plots pane.
   */
  plots: {
    id: string;
    title: string;
    alt: string;
    width: number;
    height: number;
    autoWidth: number;
    autoHeight: number;
    src: string;
    rds?: string;
    description?: string;
    section?: string;
  }[];
  /** Order of the result sections; tables and plots are shown grouped by their section. */
  sections?: string[];
  notes: { level: "info" | "warning"; code?: string; text: string; /** A file the analysis wrote, which the app offers to open. */ file?: string }[];
  dataInfo: { dataset?: string; rows?: number; columns?: number; [k: string]: unknown };
  exports: string[];
  provenance: { r?: string; packages?: Record<string, string>; created?: string };
}

export interface AnalysisRun {
  runId: string;
  revision: number;
  status: "queued" | "running" | "ok" | "error" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  error?: { code: string; message: string };
}

export interface AnalysisFigureSize {
  width: number;
  height: number;
}

/** A saved analysis instance: <project>/.rsage/analyses/<id>.json */
export interface AnalysisInstance {
  id: string;
  /** AnalysisDef.key */
  analysis: string;
  title: string;
  dataset: string;
  options: any;
  /** Figure sizes the user chose (inches), by plot id; other plots keep their automatic size. */
  figures?: Record<string, AnalysisFigureSize>;
  /** Bumped on every options/dataset/figure change. */
  revision: number;
  createdAt: string;
  updatedAt: string;
  lastRun?: AnalysisRun;
  /** The latest successful result (runs of older revisions included). */
  result?: AnalysisResult;
  /** Revision the result was computed for. */
  resultRevision?: number;
  createdBy?: "user" | "assistant";
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
  /** Distinct values (or factor levels) of one column of a global data frame, for the data viewer. */
  "data.columnValues": {
    params: { object: string; column: string; limit?: number };
    result: { factor: boolean; ordered: boolean; numeric: boolean; total: number; values: string[] };
  };

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
  /** Re-render a plot in R at a physical size and write it to an absolute path. */
  "plot.save": {
    params: { commId?: string; path: string; format: PlotExportFormat; widthIn: number; heightIn: number; dpi?: number; data?: string; overwrite?: boolean };
    result: { ok: true; path: string } | { ok: false; exists: true };
  };
  /** Render a plot at a physical size (for the save dialog's preview). */
  "plot.render": {
    params: { commId: string; format: PlotExportFormat; widthIn: number; heightIn: number; dpi?: number };
    result: { data: string; mime_type: string };
  };

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

  "dialog.pickFolder": { params: { title?: string; startingFolder?: string }; result: string | null };
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

  /** Formats a .R file, or the R chunks of a .qmd/.Rmd, with Air (downloaded on first use). */
  "format.document": { params: { path: string; text: string }; result: { text: string; failed: number; error?: string } };
  /** Air's version, or null when it is not on this machine yet. */
  "format.status": { params: {}; result: { air: string | null } };
  "format.installAir": { params: {}; result: { air: string | null } };
  "shell.openExternal": { params: { path: string }; result: void };

  /** Installed analysis modules and their analyses. */
  "analysis.modules": { params: {}; result: AnalysisModuleInfo[] };
  /** Checks (and when possible installs) the module's R packages in the current R. */
  "analysis.prepare": { params: { moduleId: string }; result: AnalysisRuntimeStatus };
  /** Data frames in the session's global environment. */
  "analysis.datasets": { params: {}; result: AnalysisDataset[] };
  /** A column's values (factor levels, else sorted distinct values) for level pickers. */
  "analysis.levels": { params: { dataset: string; column: string }; result: { values: string[]; truncated: boolean } };
  "analysis.list": { params: {}; result: AnalysisInstance[] };
  "analysis.get": { params: { id: string }; result: AnalysisInstance | null };
  /** reuse: bring back an analysis of the same kind, data and options instead of making another (menu opens). */
  "analysis.create": { params: { analysis: string; dataset?: string; options?: any; title?: string; reuse?: boolean }; result: AnalysisInstance };
  /** figures replaces all user figure sizes; a plot id mapped to null goes back to automatic. */
  "analysis.update": {
    params: { id: string; dataset?: string; options?: any; title?: string; figures?: Record<string, AnalysisFigureSize | null> };
    result: AnalysisInstance;
  };
  /** Runs the latest revision; resolves when the run ends (the instance carries the outcome). */
  "analysis.run": { params: { id: string }; result: AnalysisInstance };
  "analysis.cancel": { params: { id: string }; result: void };
  "analysis.delete": { params: { id: string }; result: void };
  /** R code that reproduces the analysis (for a Quarto chunk or the console). */
  "analysis.code": { params: { id: string }; result: string };
  /** Redraws a result plot in the R session so it opens in the Plots pane. */
  "analysis.showPlot": { params: { id: string; plotId: string }; result: void };
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
  /** An analysis instance changed (options, run state or result). */
  "analysis.changed": AnalysisInstance;
  "analysis.deleted": { id: string };
  /** Ask the UI to show an analysis tab (e.g. one the assistant just ran). */
  "analysis.open": { id: string };
  /** Native menu → UI command registry (desktop shell). */
  "ui.command": { id: string };
}

export type EventName = keyof HostEvents;

// ---------- wire envelope ----------

export type WireMessage =
  | { t: "req"; id: number; method: string; params: unknown }
  | { t: "res"; id: number; result?: unknown; error?: string }
  | { t: "evt"; type: string; payload: unknown };

export * from "./schema";
export * from "./rchunks";
