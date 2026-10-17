// A project is a plain folder. R Sage keeps its own files only under
// <project>/.rsage/ so the folder stays usable from any other editor.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch, type FSWatcher } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  BackupEntry,
  ExecutionRecord,
  FileEntry,
  ProjectInfo,
  ProjectSettings,
  WorkspaceState,
} from "@rsage/shared";
import { readJson, writeFileAtomic } from "./config";
import { moveToTrash } from "./trash";

const META = ".rsage";
const IGNORED_DIRS = new Set([".git", "node_modules", ".Rproj.user", META, "renv/library", ".quarto"]);

export class Project {
  readonly root: string;
  readonly name: string;
  settings: ProjectSettings;
  private watcher?: FSWatcher;
  private changeTimer?: ReturnType<typeof setTimeout>;
  private changed = new Set<string>();
  /** Writes made by the app itself, so the watcher doesn't report them as external. */
  private ownWrites = new Map<string, number>();

  constructor(root: string) {
    this.root = resolve(root);
    this.name = basename(this.root);
    this.settings = readJson<ProjectSettings>(this.meta("settings.json"), {});
  }

  static create(root: string): Project {
    mkdirSync(root, { recursive: true });
    return new Project(root);
  }

  info(): ProjectInfo {
    return { path: this.root, name: this.name, settings: this.settings };
  }

  meta(...parts: string[]): string {
    return join(this.root, META, ...parts);
  }

  private ensureMeta() {
    if (existsSync(this.meta(".gitignore"))) return;
    // Settings are worth committing; per-machine state is not.
    writeFileAtomic(this.meta(".gitignore"), "state.json\nhistory.jsonl\nconsole-history.json\nbackups/\n");
  }

  updateSettings(settings: ProjectSettings): ProjectInfo {
    this.settings = { ...this.settings, ...settings };
    this.ensureMeta();
    writeFileAtomic(this.meta("settings.json"), JSON.stringify(this.settings, null, 2));
    return this.info();
  }

  saveState(state: WorkspaceState) {
    this.ensureMeta();
    writeFileAtomic(this.meta("state.json"), JSON.stringify(state));
  }

  loadState(): WorkspaceState | null {
    const s = readJson<WorkspaceState | null>(this.meta("state.json"), null);
    return s && Array.isArray(s.openFiles) ? s : null;
  }

  // ----- paths -----

  /** Resolve a path and refuse anything outside the project root. */
  resolve(p: string): string {
    const abs = isAbsolute(p) ? resolve(p) : resolve(this.root, p);
    if (abs !== this.root && !abs.startsWith(this.root + sep)) {
      throw new Error(`Path is outside the project: ${p}`);
    }
    return abs;
  }

  // ----- files -----

  list(dir: string): FileEntry[] {
    const abs = this.resolve(dir);
    return readdirSync(abs, { withFileTypes: true })
      .filter((d) => !(d.isDirectory() && (d.name === META || d.name === ".git")) && d.name !== ".DS_Store")
      .map((d): FileEntry => {
        const path = join(abs, d.name);
        let st: import("node:fs").Stats | undefined;
        try {
          st = statSync(path);
        } catch {}
        return {
          name: d.name,
          path,
          kind: st?.isDirectory() ? "dir" : "file",
          size: st?.size,
          mtimeMs: st?.mtimeMs,
        };
      })
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
  }

  read(path: string): { content: string; mtimeMs: number } {
    const abs = this.resolve(path);
    return { content: readFileSync(abs, "utf8"), mtimeMs: statSync(abs).mtimeMs };
  }

  write(path: string, content: string, expectedMtimeMs?: number, force = false) {
    const abs = this.resolve(path);
    if (!force && expectedMtimeMs !== undefined && existsSync(abs)) {
      const current = statSync(abs).mtimeMs;
      if (Math.abs(current - expectedMtimeMs) > 1) return { ok: false as const, conflict: true as const, mtimeMs: current };
    }
    this.ownWrites.set(abs, Date.now());
    writeFileAtomic(abs, content);
    this.discardBackup(abs);
    return { ok: true as const, mtimeMs: statSync(abs).mtimeMs };
  }

  create(path: string, kind: "file" | "dir") {
    const abs = this.resolve(path);
    if (existsSync(abs)) throw new Error(`${basename(abs)} already exists`);
    if (kind === "dir") mkdirSync(abs, { recursive: true });
    else writeFileAtomic(abs, "");
  }

  rename(from: string, to: string) {
    const a = this.resolve(from);
    const b = this.resolve(to);
    if (existsSync(b)) throw new Error(`${basename(b)} already exists`);
    mkdirSync(dirname(b), { recursive: true });
    renameSync(a, b);
  }

  async trash(path: string) {
    const abs = this.resolve(path);
    if (abs === this.root) throw new Error("Refusing to delete the project folder");
    await moveToTrash(abs);
  }

  // ----- external change detection -----

  watch(onChange: (paths: string[]) => void) {
    this.unwatch();
    try {
      this.watcher = watch(this.root, { recursive: true }, (_ev, file) => {
        if (!file) return;
        const name = file.toString();
        const first = name.split(sep)[0]!;
        if (first === META || first === ".git" || IGNORED_DIRS.has(first)) return;
        const abs = join(this.root, name);
        const own = this.ownWrites.get(abs);
        if (own && Date.now() - own < 1500) return;
        this.changed.add(abs);
        clearTimeout(this.changeTimer);
        this.changeTimer = setTimeout(() => {
          const paths = [...this.changed];
          this.changed.clear();
          onChange(paths);
        }, 150);
      });
    } catch (err) {
      console.warn("[project] file watching unavailable:", err);
    }
  }

  unwatch() {
    this.watcher?.close();
    this.watcher = undefined;
  }

  // ----- unsaved-buffer backups (crash recovery) -----

  private backupPath(abs: string) {
    const h = createHash("sha1").update(abs).digest("hex").slice(0, 16);
    return this.meta("backups", `${h}.json`);
  }

  writeBackup(path: string, content: string) {
    const abs = this.resolve(path);
    this.ensureMeta();
    writeFileAtomic(this.backupPath(abs), JSON.stringify({ path: abs, savedAt: new Date().toISOString(), content }));
  }

  listBackups(): BackupEntry[] {
    const dir = this.meta("backups");
    if (!existsSync(dir)) return [];
    const out: BackupEntry[] = [];
    for (const f of readdirSync(dir)) {
      try {
        const b = JSON.parse(readFileSync(join(dir, f), "utf8"));
        out.push({ path: b.path, savedAt: b.savedAt });
      } catch {}
    }
    return out;
  }

  readBackup(path: string): string | null {
    try {
      return JSON.parse(readFileSync(this.backupPath(this.resolve(path)), "utf8")).content;
    } catch {
      return null;
    }
  }

  discardBackup(path: string) {
    rmSync(this.backupPath(this.resolve(path)), { force: true });
  }

  // ----- run history (execution records) -----

  appendHistory(rec: ExecutionRecord) {
    this.ensureMeta();
    const line = JSON.stringify(rec) + "\n";
    const file = this.meta("history.jsonl");
    // Append without rewriting: history can get long.
    appendFileSync(file, line);
  }

  readHistory(limit = 500): ExecutionRecord[] {
    const file = this.meta("history.jsonl");
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
    // Later lines for the same id supersede earlier ones.
    const byId = new Map<string, ExecutionRecord>();
    for (const l of lines.slice(-limit * 3)) {
      try {
        const r = JSON.parse(l) as ExecutionRecord;
        byId.set(r.id, r);
      } catch {}
    }
    return [...byId.values()].slice(-limit);
  }

  // ----- console input history -----

  consoleHistory(): string[] {
    return readJson<{ items: string[] }>(this.meta("console-history.json"), { items: [] }).items;
  }

  pushConsoleHistory(code: string) {
    const items = this.consoleHistory().filter((c) => c !== code);
    items.push(code);
    this.ensureMeta();
    writeFileAtomic(this.meta("console-history.json"), JSON.stringify({ items: items.slice(-1000) }));
  }

  relative(abs: string) {
    return relative(this.root, abs);
  }
}
