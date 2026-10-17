// Locate and launch the Ark R kernel.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";
import type { ConnectionInfo } from "./jupyter";

/** Ark release R Sage is tested against. scripts/fetch-ark.ts downloads it. */
export const ARK_VERSION = "0.1.252";

export function findArk(extraDirs: string[] = []): string | undefined {
  const candidates = [
    process.env.RSAGE_ARK_PATH,
    ...extraDirs.map((d) => join(d, "ark")),
    join(import.meta.dir, "..", "..", "..", "vendor", "ark", "ark"),
    join(homedir(), ".rsage", "ark", "ark"),
  ];
  for (const c of candidates) if (c && existsSync(c)) return c;
  const onPath = Bun.which("ark");
  return onPath ?? undefined;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

export async function makeConnectionInfo(): Promise<ConnectionInfo> {
  const ports = new Set<number>();
  while (ports.size < 5) ports.add(await freePort());
  const [shell_port, iopub_port, stdin_port, control_port, hb_port] = [...ports] as [
    number, number, number, number, number,
  ];
  return {
    ip: "127.0.0.1",
    transport: "tcp",
    signature_scheme: "hmac-sha256",
    key: randomBytes(32).toString("hex"),
    shell_port,
    iopub_port,
    stdin_port,
    control_port,
    hb_port,
    kernel_name: "ark",
  };
}

/**
 * GUI apps on macOS start without LANG, and R then falls back to the C locale:
 * Korean text prints as <U+C77C>. Pick a UTF-8 locale like Positron does.
 */
export async function utf8LocaleEnv(): Promise<Record<string, string>> {
  const current = process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG;
  if (current && /utf-?8/i.test(current)) return {};
  if (process.platform === "darwin") {
    let locale = "en_US";
    try {
      const p = Bun.spawn(["defaults", "read", "-g", "AppleLocale"], { stdout: "pipe", stderr: "ignore" });
      const out = (await new Response(p.stdout).text()).trim().replace(/@.*$/, "");
      if (/^[a-z]{2}_[A-Z]{2}$/.test(out)) locale = out;
    } catch {}
    return { LANG: `${locale}.UTF-8` };
  }
  return { LANG: "C.UTF-8" };
}

export interface LaunchOptions {
  arkPath: string;
  rHome: string;
  cwd: string;
  /** Directory for the connection file and kernel log. */
  runtimeDir?: string;
  env?: Record<string, string>;
  startupFile?: string;
  onExit?: (code: number | null, signal: string | null) => void;
}

export interface LaunchedKernel {
  proc: Subprocess;
  conn: ConnectionInfo;
  logFile: string;
  connectionFile: string;
  stderrFile: string;
}

export async function launchArk(opts: LaunchOptions): Promise<LaunchedKernel> {
  const conn = await makeConnectionInfo();
  const dir = opts.runtimeDir ?? join(tmpdir(), "rsage");
  mkdirSync(dir, { recursive: true });
  const stamp = `${Date.now()}-${process.pid}`;
  const connectionFile = join(dir, `kernel-${stamp}.json`);
  const logFile = join(dir, `ark-${stamp}.log`);
  const stderrFile = join(dir, `ark-${stamp}.stderr`);
  writeFileSync(connectionFile, JSON.stringify(conn, null, 2), { mode: 0o600 });

  const args = [opts.arkPath, "--connection_file", connectionFile, "--session-mode", "console", "--log", logFile];
  if (opts.startupFile) args.push("--startup-file", opts.startupFile);

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(await utf8LocaleEnv()),
    R_HOME: opts.rHome,
    RUST_LOG: process.env.RUST_LOG ?? "error",
    ...opts.env,
  };
  if (process.platform === "linux") {
    // The dynamic linker must find a libR.so even though Ark loads R itself.
    env.LD_LIBRARY_PATH = [join(opts.rHome, "lib"), env.LD_LIBRARY_PATH].filter(Boolean).join(":");
  }

  const proc = Bun.spawn(args, {
    cwd: opts.cwd,
    env,
    stdin: "ignore",
    stdout: "ignore",
    // A file, not a pipe: a pipe held open by R child processes keeps Bun alive.
    stderr: Bun.file(stderrFile),
    onExit: (_p, code, signal) => opts.onExit?.(code, signal ? String(signal) : null),
  });
  return { proc, conn, logFile, connectionFile, stderrFile };
}
