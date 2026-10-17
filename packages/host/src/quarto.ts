// Quarto: finding the CLI, rendering documents with a progress log, and a
// small local web server so rendered pages and a document's images can be
// shown inside the app.
//
// Rendering runs `quarto render` in its own R process (not the console
// session), so a document that only works because of objects in the console
// fails here the way it would for anyone else.

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { findCli } from "./assistant/cli";

const APP_QUARTOS = [
  "/Applications/quarto/bin/quarto",
  "/Applications/Positron.app/Contents/Resources/app/quarto/bin/quarto",
  "/Applications/RStudio.app/Contents/Resources/app/quarto/bin/quarto",
];

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

export interface QuartoEvents {
  log: (renderId: string, text: string) => void;
  done: (renderId: string, r: { ok: boolean; output?: string; error?: string }) => void;
}

export class QuartoService {
  private renders = new Map<string, ChildProcess>();
  private versionCache = new Map<string, string>();

  constructor(private events: QuartoEvents) {}

  find(configured?: string): string | null {
    if (configured && existsSync(configured)) return configured;
    return findCli("quarto") ?? APP_QUARTOS.find((p) => existsSync(p)) ?? null;
  }

  async info(configured?: string): Promise<{ path?: string; version?: string }> {
    const path = this.find(configured);
    if (!path) return {};
    let version = this.versionCache.get(path);
    if (!version) {
      const p = Bun.spawn([path, "--version"], { stdout: "pipe", stderr: "ignore" });
      version = (await new Response(p.stdout).text()).trim();
      if (version) this.versionCache.set(path, version);
    }
    return { path, version };
  }

  /** Starts `quarto render`; progress arrives as log events, then done. */
  render(file: string, opts: { to?: string; quarto?: string; rHome?: string }): string {
    const quarto = this.find(opts.quarto);
    if (!quarto) throw new Error("Quarto를 찾지 못했습니다. https://quarto.org 에서 설치한 뒤 다시 시도하세요.");
    const id = randomUUID();
    const cwd = dirname(file);
    const args = ["render", basename(file), ...(opts.to ? ["--to", opts.to] : [])];
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    // Render with the same R the project uses.
    if (opts.rHome && existsSync(join(opts.rHome, "bin", "R"))) env.QUARTO_R = join(opts.rHome, "bin", "R");
    const child = spawn(quarto, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    this.renders.set(id, child);
    let output: string | undefined;
    let tail = "";
    const onData = (d: Buffer) => {
      const text = stripAnsi(d.toString());
      tail = (tail + text).slice(-4000);
      for (const m of text.matchAll(/Output created: (.+)/g)) output = resolve(cwd, m[1]!.trim());
      this.events.log(id, text);
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    this.events.log(id, `$ quarto ${args.join(" ")}\n`);
    let finished = false;
    const finish = (r: { ok: boolean; output?: string; error?: string }) => {
      if (finished) return;
      finished = true;
      this.renders.delete(id);
      this.events.done(id, r);
    };
    child.once("error", (e) => finish({ ok: false, error: `Quarto를 실행하지 못했습니다: ${e.message}` }));
    child.once("close", (code, signal) => {
      if (signal) return finish({ ok: false, error: "렌더링을 중단했습니다." });
      if (code !== 0) return finish({ ok: false, error: lastError(tail) });
      finish({ ok: true, output: output && existsSync(output) ? output : guessOutput(file, opts.to) });
    });
    return id;
  }

  stop(renderId: string) {
    this.renders.get(renderId)?.kill("SIGTERM");
  }

  dispose() {
    for (const c of this.renders.values()) c.kill("SIGTERM");
  }
}

function lastError(log: string) {
  const lines = log.trim().split("\n").filter((l) => l.trim());
  let i = -1;
  lines.forEach((l, j) => {
    if (/^(ERROR|Error)/.test(l.trim())) i = j;
  });
  return (i >= 0 ? lines.slice(i, i + 8) : lines.slice(-8)).join("\n") || "렌더링에 실패했습니다.";
}

function guessOutput(file: string, to?: string) {
  const ext = to === "pdf" || to === "typst" ? ".pdf" : to === "docx" ? ".docx" : ".html";
  const out = file.replace(/\.[^.]+$/, ext);
  return existsSync(out) ? out : undefined;
}

/** Serves files under the open project at http://127.0.0.1:<port>/f/<token>/<path>. */
export class PreviewServer {
  private server?: ReturnType<typeof Bun.serve>;
  private token = randomBytes(16).toString("hex");

  constructor(private root: () => string | undefined) {}

  url(abs: string): string {
    const root = this.root();
    if (!root) throw new Error("프로젝트가 열려 있지 않습니다.");
    const rel = relative(root, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("프로젝트 밖의 파일은 미리 볼 수 없습니다.");
    this.server ??= Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req) => this.serve(new URL(req.url)),
    });
    const path = rel.split(sep).map(encodeURIComponent).join("/");
    return `http://127.0.0.1:${this.server.port}/f/${this.token}/${path}`;
  }

  private serve(url: URL): Response {
    const root = this.root();
    const prefix = `/f/${this.token}/`;
    if (!root || !url.pathname.startsWith(prefix)) return new Response("not found", { status: 404 });
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname.slice(prefix.length));
    } catch {
      return new Response("bad path", { status: 400 });
    }
    const abs = resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + sep)) return new Response("not found", { status: 404 });
    let path = abs;
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
    if (!existsSync(path)) return new Response("not found", { status: 404 });
    return new Response(Bun.file(path), { headers: { "cache-control": "no-store" } });
  }

  dispose() {
    this.server?.stop(true);
  }
}
