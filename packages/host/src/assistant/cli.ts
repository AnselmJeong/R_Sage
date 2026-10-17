// Finding and running the user's own `claude` and `codex` command-line tools.
// An app opened from Finder gets a minimal PATH, so look in the usual
// install locations and, failing that, ask the user's login shell.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
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

/** Forget cached lookups, e.g. after the user installs a tool. */
export function resetCli() {
  found.clear();
}

/**
 * Runs a CLI that prints one JSON object per line; yields the parsed lines.
 * Throws with the tail of stderr when it exits with an error.
 */
export async function* runJsonLines(cmd: string, args: string[], opts: { input: string; env: Record<string, string>; cwd: string; signal: AbortSignal }) {
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
