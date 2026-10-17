// The R Sage host: every service the UI can call, behind one dispatch().
// Shell adapters (Electrobun window, browser dev server) only move
// messages; all behaviour lives here so it is testable without a window.

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  ARK_VERSION,
  discoverR,
  findArk,
  KernelSession,
  probeManual,
  type RInstallation,
} from "@rsage/kernel";
import type {
  AppInfo,
  EventName,
  ExecutionRecord,
  HostEvents,
  HostMethods,
  MethodName,
  Params,
  Result,
  SessionInfo,
} from "@rsage/shared";
import { randomUUID } from "node:crypto";
import { AssistantService } from "./assistant/service";
import { CommManager } from "./comms";
import { appDir, ConfigStore } from "./config";
import { LspBridge } from "./lsp";
import { Project } from "./project";
import { listFiles, replaceInFiles, searchText } from "./search";
import { TerminalService } from "./terminal";

export const APP_VERSION = "0.1.0";

type Handler<M extends MethodName> = (params: Params<M>) => Promise<Result<M>> | Result<M>;
export type Emit = <E extends EventName>(type: E, payload: HostEvents[E]) => void;

export interface HostOptions {
  shell: AppInfo["shell"];
  /** Native folder picker; the browser shell has none and uses the in-app browser. */
  pickFolder?: (title?: string) => Promise<string | null>;
  openExternal?: (path: string) => Promise<void>;
}

export class Host {
  private listeners = new Set<Emit>();
  readonly config = new ConfigStore();
  readonly session = new KernelSession();
  readonly lsp = new LspBridge(this.session);
  readonly comms = new CommManager(this.session);
  readonly assistant: AssistantService;
  private frontendWaiters = new Map<string, (result: unknown, error?: string) => void>();
  /** R's working directory as the UI comm last reported it. */
  private rCwd?: string;
  private project?: Project;
  private rCache?: RInstallation[];
  private recentRuns: ExecutionRecord[] = [];
  private memTimer?: ReturnType<typeof setInterval>;
  private memoryBytes?: number;
  private terminals: TerminalService;
  private handlers: { [M in MethodName]: Handler<M> };

  constructor(private opts: HostOptions) {
    this.terminals = new TerminalService(
      (id, data) => this.emit("terminal.data", { id, data }),
      (id, code) => this.emit("terminal.exit", { id, code }),
    );
    this.session.on("state", (s) => {
      this.emit("session.state", this.sessionInfo(s));
      if (s.state === "exited" || s.state === "stopped") this.lsp.stop();
    });
    this.session.on("output", (o) => this.emit("console.output", o));
    this.session.on("execution", (rec: ExecutionRecord) => {
      this.emit("execution", rec);
      if (rec.status !== "queued" && rec.status !== "running") {
        this.recentRuns.push(rec);
        if (this.recentRuns.length > 1000) this.recentRuns.shift();
        try {
          this.project?.appendHistory(rec);
        } catch {}
      }
    });
    this.assistant = new AssistantService({
      config: this.config,
      project: () => this.project,
      session: this.session,
      comms: this.comms,
      ensureSession: async () => {
        const st = this.session.state.state;
        if (st === "stopped" || st === "exited") await this.startSession();
      },
      emitItem: (conversationId, item) => this.emit("assistant.item", { conversationId, item }),
      emitDelta: (conversationId, itemId, d) => this.emit("assistant.delta", { conversationId, itemId, ...d }),
      emitState: (conversationId, running) => this.emit("assistant.state", { conversationId, running }),
      rInfo: () => ({ version: this.session.state.rVersion }),
    });
    this.comms.on("open", (c) => this.emit("comm.open", c));
    this.comms.on("close", (c) => this.emit("comm.close", c));
    this.comms.on("event", (e) => {
      if (e.target === "positron.ui" && e.method === "working_directory") {
        this.rCwd = e.params.directory;
        this.emit("session.state", this.sessionInfo());
      }
      this.emit("comm.event", e);
    });
    this.session.on("frontend_request", (r: { method: string; params: any; reply: (res: unknown, err?: string) => void }) =>
      this.onFrontendRequest(r),
    );
    this.lsp.on("notification", (method, params) => this.emit("lsp.notification", { method, params }));
    this.lsp.on("state", (running: boolean) => this.emit("lsp.state", { running }));
    this.handlers = this.buildHandlers();
    process.on("exit", () => {
      this.session.killNow();
      this.terminals.killAll();
    });
  }

  subscribe(fn: Emit): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit: Emit = (type, payload) => {
    for (const l of this.listeners) l(type, payload);
  };

  async dispatch(method: string, params: unknown): Promise<unknown> {
    const h = (this.handlers as any)[method];
    if (!h) throw new Error(`Unknown method: ${method}`);
    return h(params ?? {});
  }

  async dispose() {
    clearInterval(this.memTimer);
    this.terminals.killAll();
    this.assistant.dispose();
    this.lsp.stop();
    this.project?.unwatch();
    await this.session.shutdown();
  }

  // ---------- helpers ----------

  private sessionInfo(s: SessionInfo = this.session.state): SessionInfo {
    return { ...s, cwd: (s.pid && this.rCwd) || s.cwd, memoryBytes: s.pid ? this.memoryBytes : undefined };
  }

  private requireProject(): Project {
    if (!this.project) throw new Error("No project is open");
    return this.project;
  }

  /** Path guard for file APIs: inside the open project only. */
  private file(path: string): string {
    return this.requireProject().resolve(path);
  }

  async rInstallations(refresh = false): Promise<RInstallation[]> {
    if (!this.rCache || refresh) {
      const manual = this.config.data.manualR;
      this.rCache = await discoverR(manual);
    }
    return this.rCache;
  }

  private async chooseR(explicit?: string): Promise<RInstallation> {
    const all = await this.rInstallations();
    const wanted = explicit ?? this.project?.settings.rHome ?? this.config.data.defaultRHome;
    const pick =
      (wanted && all.find((r) => r.home === wanted)) ||
      all.find((r) => r.isPathDefault && !r.tooOld) ||
      all.find((r) => !r.tooOld) ||
      all[0];
    if (!pick) throw new Error("No R installation found. Install R from CRAN or Homebrew, or add its path manually.");
    return pick;
  }

  private async startSession(rHome?: string, restart = false): Promise<SessionInfo> {
    const arkPath = findArk();
    if (!arkPath) throw new Error("Ark kernel not found. Run `bun scripts/fetch-ark.ts` or set RSAGE_ARK_PATH.");
    const r = await this.chooseR(rHome);
    const cwd = this.project?.root ?? homedir();
    const opts = { arkPath, rHome: r.home, cwd, runtimeDir: join(appDir(), "runtime") };
    this.rCwd = undefined;
    const info = restart && this.session.state.state !== "stopped" ? await this.session.restart(opts) : await this.session.start(opts);
    this.comms.openFrontendComms();
    this.startMemorySampling();
    void this.lsp.start(cwd).catch((err) => console.warn("[lsp]", err.message));
    return this.sessionInfo(info);
  }

  /**
   * Kernel → frontend requests (rstudioapi shims, readline-style questions).
   * Ones the host can answer itself are answered here; the rest go to the UI.
   */
  private onFrontendRequest(r: { method: string; params: any; reply: (res: unknown, err?: string) => void }) {
    switch (r.method) {
      case "workspace_folder":
        return r.reply(this.project?.root ?? null);
      case "evaluate_when_clause":
        return r.reply(false);
      case "last_active_editor_context":
      case "debug_sleep":
        return r.reply(null);
      case "show_question":
      case "show_dialog":
      case "show_prompt": {
        const id = randomUUID();
        this.frontendWaiters.set(id, r.reply);
        this.emit("frontend.request", { id, method: r.method, params: r.params });
        return;
      }
      default:
        // Unknown request: answer null so R is never left blocked.
        this.emit("frontend.request", { id: "", method: r.method, params: r.params });
        return r.reply(null);
    }
  }

  private startMemorySampling() {
    clearInterval(this.memTimer);
    const sample = async () => {
      const pid = this.session.state.pid;
      if (!pid) return;
      try {
        const p = Bun.spawn(["ps", "-o", "rss=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore" });
        const kb = parseInt((await new Response(p.stdout).text()).trim(), 10);
        if (!Number.isNaN(kb)) {
          this.memoryBytes = kb * 1024;
          this.emit("session.state", this.sessionInfo());
        }
      } catch {}
    };
    void sample();
    this.memTimer = setInterval(sample, 5000);
  }

  private async openProject(path: string, create = false): Promise<Project> {
    if (!create && (!existsSync(path) || !statSync(path).isDirectory())) throw new Error(`Not a folder: ${path}`);
    this.project?.unwatch();
    const p = create ? Project.create(path) : new Project(path);
    this.project = p;
    this.config.touchRecent(p.root, p.name);
    p.watch((paths) => this.emit("fs.changed", { paths }));
    this.emit("project.changed", p.info());
    // Each project gets its own R session rooted at the project folder.
    if (this.session.state.state !== "stopped") {
      void this.startSession(p.settings.rHome, true).catch((err) => console.warn("[session]", err.message));
    }
    return p;
  }

  private async isComplete(code: string): Promise<"complete" | "incomplete" | "invalid" | "unknown"> {
    const client = this.session.jupyter;
    if (!client || this.session.state.state !== "idle") return "unknown";
    try {
      const { reply } = client.request("shell", "is_complete_request", { code }, 1500);
      const r = await reply;
      return r.content.status ?? "unknown";
    } catch {
      return "unknown";
    }
  }

  private buildHandlers(): { [M in MethodName]: Handler<M> } {
    const h: { [M in MethodName]: Handler<M> } = {
      "app.info": () => ({
        version: APP_VERSION,
        shell: this.opts.shell,
        platform: `${process.platform}-${process.arch}`,
        arkPath: findArk(),
        arkVersion: ARK_VERSION,
        homeDir: homedir(),
      }),
      "app.diagnostics": async () => {
        const rs = await this.rInstallations();
        const ark = findArk();
        const quarto = Bun.which("quarto") ?? (existsSync("/Applications/quarto/bin/quarto") ? "/Applications/quarto/bin/quarto" : null);
        const git = Bun.which("git");
        return {
          checks: [
            { name: "R", ok: rs.length > 0, detail: rs.map((r) => `${r.version} (${r.source}) ${r.home}`).join("\n") || "not found" },
            { name: "Ark kernel", ok: !!ark, detail: ark ?? "not found" },
            { name: "Quarto", ok: !!quarto, detail: quarto ?? "not found" },
            { name: "Git", ok: !!git, detail: git ?? "not found (install Xcode Command Line Tools)" },
          ],
        };
      },

      "r.list": ({ refresh }) => this.rInstallations(refresh),
      "r.addManual": async ({ path }) => {
        const r = await probeManual(path);
        if (r) {
          this.config.update({ manualR: [...new Set([...this.config.data.manualR, r.binary])] });
          await this.rInstallations(true);
        }
        return r ?? null;
      },
      "r.setDefault": ({ home }) => {
        this.config.update({ defaultRHome: home });
      },

      "session.info": () => this.sessionInfo(),
      "session.start": ({ rHome }) => this.startSession(rHome),
      "session.restart": ({ rHome }) => this.startSession(rHome, true),
      "session.interrupt": () => this.session.interrupt(),
      "session.stop": async () => {
        this.lsp.stop();
        clearInterval(this.memTimer);
        await this.session.shutdown();
      },
      "session.libPaths": async () => (await this.session.evalText("cat(.libPaths(), sep = '\\n')")).trim().split("\n"),

      "console.execute": ({ code, origin, source }) => {
        const rec = this.session.execute(code, { origin: origin ?? "console", source });
        if ((origin ?? "console") === "console" && code.trim()) this.project?.pushConsoleHistory(code);
        return { executionId: rec.id };
      },
      "console.isComplete": ({ code }) => this.isComplete(code),
      "console.input": ({ value }) => this.session.inputReply(value),
      "console.history": () => this.project?.consoleHistory() ?? [],
      "console.saveHistory": async ({ path }) => {
        const items = this.project?.consoleHistory() ?? [];
        await Bun.write(this.file(path), items.join("\n") + "\n");
      },

      "history.list": ({ limit }) => {
        const persisted = this.project?.readHistory(limit ?? 500) ?? [];
        const byId = new Map(persisted.map((r) => [r.id, r]));
        for (const r of this.recentRuns) byId.set(r.id, r);
        return [...byId.values()].slice(-(limit ?? 500));
      },

      "project.open": async ({ path }) => (await this.openProject(path)).info(),
      "project.create": async ({ path }) => (await this.openProject(path, true)).info(),
      "project.close": () => {
        this.project?.unwatch();
        this.project = undefined;
        this.emit("project.changed", null);
      },
      "project.current": () => this.project?.info() ?? null,
      "project.recent": () => this.config.data.recentProjects.filter((p) => existsSync(p.path)),
      "project.updateSettings": ({ settings }) => {
        const info = this.requireProject().updateSettings(settings);
        this.emit("project.changed", info);
        return info;
      },
      "project.saveState": ({ state }) => this.project?.saveState(state),
      "project.loadState": () => this.project?.loadState() ?? null,

      "fs.list": ({ path }) => this.requireProject().list(path),
      "fs.browse": async ({ path }) => {
        // Folder picker for the browser shell: directories only, anywhere.
        const { readdirSync } = await import("node:fs");
        const { dirname, resolve } = await import("node:path");
        const dir = resolve(path || homedir());
        const entries = readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith("."))
          .map((d) => ({ name: d.name, path: join(dir, d.name), kind: "dir" as const }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return { path: dir, parent: dir === "/" ? null : dirname(dir), entries };
      },
      "fs.walk": () => listFiles(this.requireProject().root),
      "fs.read": ({ path }) => this.requireProject().read(path),
      "fs.write": ({ path, content, expectedMtimeMs, force }) =>
        this.requireProject().write(path, content, expectedMtimeMs, force),
      "fs.create": ({ path, kind }) => this.requireProject().create(path, kind),
      "fs.rename": ({ from, to }) => this.requireProject().rename(from, to),
      "fs.trash": ({ path }) => this.requireProject().trash(path),

      "search.text": (p) => searchText(this.requireProject().root, p),
      "search.replace": ({ paths, ...o }) => replaceInFiles(paths.map((x) => this.file(x)), o),

      "backup.write": ({ path, content }) => this.requireProject().writeBackup(path, content),
      "backup.list": () => this.project?.listBackups() ?? [],
      "backup.read": ({ path }) => this.requireProject().readBackup(path),
      "backup.discard": ({ path }) => this.requireProject().discardBackup(path),

      "terminal.create": ({ cols, rows }) => ({
        id: this.terminals.create(this.project?.root ?? homedir(), cols, rows),
      }),
      "terminal.write": ({ id, data }) => this.terminals.write(id, data),
      "terminal.resize": ({ id, cols, rows }) => this.terminals.resize(id, cols, rows),
      "terminal.kill": ({ id }) => this.terminals.kill(id),

      "lsp.request": ({ method, params }) => this.lsp.request(method, params),
      "lsp.notify": ({ method, params }) => {
        if (this.lsp.running) this.lsp.notify(method, params);
      },
      "lsp.status": () => ({ running: this.lsp.running }),

      "assistant.status": ({ refresh }) => this.assistant.status(refresh),
      "assistant.setKey": ({ provider, key }) => this.assistant.setKey(provider, key),
      "assistant.setOptions": (o) => this.assistant.setOptions(o),
      "assistant.list": () => this.assistant.list(),
      "assistant.load": ({ id }) => this.assistant.load(id),
      "assistant.new": () => this.assistant.create(),
      "assistant.delete": ({ id }) => this.assistant.delete(id),
      "assistant.send": ({ conversationId, text, model, context }) => {
        // The reply runs in the background; progress arrives as assistant.* events.
        this.assistant.send(conversationId, text, model, context);
      },
      "assistant.stop": ({ conversationId }) => this.assistant.stop(conversationId),
      "assistant.approve": ({ conversationId, itemId, approve, always }) => this.assistant.approve(conversationId, itemId, approve, always),
      "comm.list": () => this.comms.list(),
      "comm.rpc": ({ commId, method, params }) => this.comms.rpc(commId, method, params),
      "comm.close": ({ commId }) => this.comms.close(commId),
      "frontend.reply": ({ id, result, error }) => {
        const w = this.frontendWaiters.get(id);
        this.frontendWaiters.delete(id);
        w?.(result, error);
      },
      "fs.writeBase64": async ({ path, data }) => {
        await Bun.write(this.file(path), Buffer.from(data, "base64"));
      },
      "dialog.pickFolder": ({ title }) => (this.opts.pickFolder ? this.opts.pickFolder(title) : null),
      "shell.openExternal": async ({ path }) => {
        if (this.opts.openExternal) return this.opts.openExternal(path);
        const opener = process.platform === "darwin" ? "open" : "xdg-open";
        Bun.spawn([opener, path], { stdout: "ignore", stderr: "ignore" });
      },
    };
    return h;
  }
}

export type { HostMethods };
