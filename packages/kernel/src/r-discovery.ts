// Find R installations on this machine.
//
// macOS: CRAN's R.framework (one directory per version), Homebrew
// (/opt/homebrew on arm64, /usr/local on x64), rig, and whatever the user's
// login shell puts on PATH (GUI apps on macOS do not inherit it).
// Linux paths are included so the same code runs in CI and dev containers.

import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export interface RInstallation {
  /** R_HOME, the identity of an installation. */
  home: string;
  /** Executable used to query it (bin/R inside home). */
  binary: string;
  version: string;
  /** e.g. "R version 4.4.1 (2024-06-14)" */
  banner: string;
  arch: string;
  /** Where it was found: "framework", "homebrew", "rig", "path", "manual"... */
  source: string;
  /** Older than the minimum version R Sage supports (4.2). */
  tooOld: boolean;
  /** The one `R` on the login PATH resolves to. */
  isPathDefault?: boolean;
}

export const MIN_R_VERSION = "4.2.0";

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

function isExecutable(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** PATH as seen by the user's login shell (macOS GUI apps get a minimal PATH). */
export async function loginShellPath(): Promise<string[]> {
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    const p = Bun.spawn([shell, "-l", "-c", 'printf "%s" "$PATH"'], { stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => p.kill(), 3000);
    const out = await new Response(p.stdout).text();
    clearTimeout(timer);
    return out.split(delimiter).filter(Boolean);
  } catch {
    return [];
  }
}

interface Candidate {
  binary: string;
  source: string;
}

export function candidateBinaries(pathDirs: string[]): Candidate[] {
  const out: Candidate[] = [];
  const add = (binary: string, source: string) => {
    if (isExecutable(binary)) out.push({ binary, source });
  };

  // CRAN installer: /Library/Frameworks/R.framework/Versions/<x.y>[-arm64]/Resources/bin/R
  const fw = "/Library/Frameworks/R.framework/Versions";
  if (existsSync(fw)) {
    for (const v of readdirSync(fw)) {
      if (v === "Current") continue;
      add(join(fw, v, "Resources", "bin", "R"), "framework");
    }
  }
  add("/opt/homebrew/bin/R", "homebrew");
  add("/usr/local/bin/R", "homebrew");
  // rig on Linux, and the Posit "R builds"
  for (const root of ["/opt/R", join(homedir(), ".local", "share", "rig")]) {
    if (!existsSync(root)) continue;
    for (const v of readdirSync(root)) add(join(root, v, "bin", "R"), "rig");
  }
  add("/usr/bin/R", "system");
  add("/usr/lib/R/bin/R", "system");
  for (const dir of pathDirs) add(join(dir, "R"), "path");
  return out;
}

async function run(cmd: string[], env?: Record<string, string>): Promise<string> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited;
  return out + err;
}

/** Ask one R binary for its home, version and arch. */
export async function probe(binary: string, source: string): Promise<RInstallation | undefined> {
  try {
    const out = await run(
      [binary, "--vanilla", "-s", "-e", 'cat(R.home(), R.version.string, R.version$arch, sep="\\n")'],
      { R_HOME: "" },
    );
    const [home, banner, arch] = out.trim().split("\n");
    if (!home || !banner) return undefined;
    const m = banner.match(/R version (\d+\.\d+\.\d+)/);
    if (!m) return undefined;
    const version = m[1]!;
    return {
      home: realpathSync(home),
      binary,
      version,
      banner,
      arch: arch ?? "",
      source,
      tooOld: compareVersions(version, MIN_R_VERSION) < 0,
    };
  } catch {
    return undefined;
  }
}

/** All distinct R installations, newest first. */
export async function discoverR(extra: string[] = []): Promise<RInstallation[]> {
  const pathDirs = [...new Set([...(await loginShellPath()), ...(process.env.PATH ?? "").split(delimiter)])];
  const candidates = [...extra.map((binary) => ({ binary, source: "manual" })), ...candidateBinaries(pathDirs)];

  // Dedupe binaries pointing to the same file before spawning R for each.
  const seenReal = new Set<string>();
  const unique = candidates.filter((c) => {
    let real: string;
    try {
      real = realpathSync(c.binary);
    } catch {
      return false;
    }
    if (seenReal.has(real)) return false;
    seenReal.add(real);
    return true;
  });

  const probed = await Promise.all(unique.map((c) => probe(c.binary, c.source)));
  const byHome = new Map<string, RInstallation>();
  for (const r of probed) if (r && !byHome.has(r.home)) byHome.set(r.home, r);

  // Which one would `R` on the login PATH launch?
  for (const dir of pathDirs) {
    const b = join(dir, "R");
    if (!isExecutable(b)) continue;
    const r = await probe(b, "path");
    if (r && byHome.has(r.home)) byHome.get(r.home)!.isPathDefault = true;
    break;
  }

  return [...byHome.values()].sort((a, b) => compareVersions(b.version, a.version));
}

/** Validate a user-chosen R binary or R_HOME. */
export async function probeManual(path: string): Promise<RInstallation | undefined> {
  const bin = isExecutable(join(path, "bin", "R")) ? join(path, "bin", "R") : path;
  return probe(bin, "manual");
}
