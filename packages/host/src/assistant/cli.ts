// Finding and running the user's own `claude` and `codex` command-line tools.
// An app opened from Finder gets a minimal PATH, so look in the usual
// install locations and, failing that, ask the user's login shell.
//
// Each tool runs with a config folder of R Sage's own and a short list of
// environment variables, so an API key, another endpoint or the user's own
// hooks and MCP servers can never take over from the subscription login.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const found = new Map<string, string | null>();

export function findCli(name: string): string | null {
  if (found.has(name)) return found.get(name)!;
  const home = homedir();
  const candidates = [
    Bun.which(name),
    join(home, ".local", "bin", name),
    join(home, ".claude", "local", name),
    "/opt/homebrew/bin/" + name,
    "/usr/local/bin/" + name,
    join(home, ".bun", "bin", name),
    join(home, ".npm-global", "bin", name),
    join(home, ".volta", "bin", name),
    ...(name === "codex"
      ? [
          "/Applications/Codex.app/Contents/Resources/codex",
          "/Applications/ChatGPT.app/Contents/Resources/codex",
        ]
      : []),
  ];
  let path = candidates.find((p): p is string => !!p && existsSync(p)) ?? null;
  if (!path && process.platform !== "win32") {
    const shell = process.env.SHELL || "/bin/zsh";
    const r = spawnSync(shell, ["-lic", `command -v ${name}`], { encoding: "utf8", timeout: 5000 });
    const line = r.stdout?.trim().split("\n").pop();
    if (line?.startsWith("/") && existsSync(line)) path = line;
  }
  found.set(name, path);
  return path;
}

/**
 * R Sage's own config folder for an agent CLI (its login, sessions and
 * settings live there, not in ~/.claude or ~/.codex).
 */
export function agentHome(name: "claude" | "codex"): string {
  const base = process.env.RSAGE_HOME
    ? join(process.env.RSAGE_HOME, "agents")
    : process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support", "R Sage")
      : join(homedir(), ".rsage", "agents");
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const PASS = ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "SHELL", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"];

/** Only what the CLI needs: no API keys, tokens, base URLs or parent-session variables. */
export function agentEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of PASS) if (process.env[k]) env[k] = process.env[k]!;
  const home = homedir();
  env.PATH = [join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", process.env.PATH ?? ""].join(":");
  return { ...env, ...extra };
}

/** Runs a command to the end and returns its exit code and output. */
export function runText(cmd: string, args: string[], opts: { env: Record<string, string>; cwd: string; timeoutMs?: number }) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(cmd, args, { env: opts.env, cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout = (stdout + d).slice(-1_000_000)));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    const timer = setTimeout(() => child.kill("SIGTERM"), opts.timeoutMs ?? 15_000);
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Forget cached lookups, e.g. after the user installs a tool. */
export function resetCli() {
  found.clear();
}

/**
 * Runs a CLI that prints one JSON object per line; yields the parsed lines.
 * Throws with the tail of stderr when it exits with an error.
 */
export async function* runJsonLines(cmd: string, args: string[], opts: { input: string; env: Record<string, string>; cwd: string; signal: AbortSignal }): AsyncGenerator<any> {
  const child = spawn(cmd, args, { env: opts.env, cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"] });
  const kill = () => child.kill("SIGTERM");
  opts.signal.addEventListener("abort", kill);
  let stderr = "";
  child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
  let spawnError: Error | null = null;
  child.once("error", (e) => (spawnError = e));
  const exit = new Promise<number | null>((resolve) => child.once("close", (code) => resolve(code)));
  child.stdin.end(opts.input);
  try {
    for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      if (!line.trim().startsWith("{")) continue;
      try {
        yield JSON.parse(line);
      } catch {
        // Not an event line.
      }
    }
    const code = await exit;
    if (spawnError) throw spawnError;
    if (code !== 0 && !opts.signal.aborted) throw new Error(stderr.trim().split("\n").slice(-5).join("\n") || `${cmd} exited with ${code}`);
  } finally {
    opts.signal.removeEventListener("abort", kill);
    if (child.exitCode === null) child.kill("SIGTERM");
  }
}

/** Writes attached images to temp files for CLIs that take image paths; returns the paths and a cleanup. */
export function tempImages(images: { mime: string; data: string }[] | undefined): { paths: string[]; cleanup: () => void } {
  if (!images?.length) return { paths: [], cleanup: () => {} };
  const dir = mkdtempSync(join(tmpdir(), "rsage-img-"));
  const paths = images.map((img, i) => {
    const ext = img.mime.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "") || "png";
    const p = join(dir, `image-${i + 1}.${ext}`);
    writeFileSync(p, Buffer.from(img.data, "base64"));
    return p;
  });
  return { paths, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
