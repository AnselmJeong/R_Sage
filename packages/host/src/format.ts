// R code formatting with Air (Posit's R formatter, MIT licensed,
// https://github.com/posit-dev/air). .R files are formatted whole; in .qmd and
// .Rmd only the R chunks are, with everything around them left untouched.
// Air is looked up on the machine and otherwise downloaded once into the app
// folder, so formatting works without the user installing anything.

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { qmdRChunks } from "@rsage/shared";
import { appDir } from "./config";

function installedAir() {
  return join(appDir(), "bin", process.platform === "win32" ? "air.exe" : "air");
}

export function findAir(): string | undefined {
  const bundled = process.env.RSAGE_ARK_PATH ? join(dirname(dirname(process.env.RSAGE_ARK_PATH)), "air", "air") : undefined;
  for (const p of [
    process.env.RSAGE_AIR,
    bundled,
    installedAir(),
    join(homedir(), ".local", "bin", "air"),
    "/opt/homebrew/bin/air",
    "/usr/local/bin/air",
  ])
    if (p && existsSync(p)) return p;
  return Bun.which("air") ?? undefined;
}

export async function airVersion(): Promise<string | null> {
  const air = findAir();
  if (!air) return null;
  const p = Bun.spawn([air, "--version"], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out.trim().replace(/^air\s+/, "") || null;
}

function airAsset() {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  if (process.platform === "darwin") return `air-${arch}-apple-darwin.tar.gz`;
  if (process.platform === "linux") return `air-${arch}-unknown-linux-gnu.tar.gz`;
  throw new Error(`Air를 자동으로 설치할 수 없는 플랫폼입니다 (${process.platform}).`);
}

function findFile(dir: string, name: string): string | undefined {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      const f = findFile(p, name);
      if (f) return f;
    } else if (e === name) return p;
  }
}

let installing: Promise<string> | undefined;

/** Downloads the latest Air release into the app folder. */
export function installAir(): Promise<string> {
  installing ??= (async () => {
    const asset = airAsset();
    const res = await fetch(`https://github.com/posit-dev/air/releases/latest/download/${asset}`);
    if (!res.ok) throw new Error(`Air를 내려받지 못했습니다 (HTTP ${res.status}).`);
    const tmp = mkdtempSync(join(tmpdir(), "air-"));
    const tgz = join(tmp, asset);
    await Bun.write(tgz, await res.arrayBuffer());
    const tar = Bun.spawn(["tar", "xzf", tgz, "-C", tmp], { stderr: "pipe" });
    if ((await tar.exited) !== 0) throw new Error(`Air 압축을 풀지 못했습니다: ${await new Response(tar.stderr).text()}`);
    const bin = findFile(tmp, "air");
    if (!bin) throw new Error("내려받은 Air에 실행 파일이 없습니다.");
    const dest = installedAir();
    mkdirSync(dirname(dest), { recursive: true });
    await Bun.write(dest, Bun.file(bin));
    chmodSync(dest, 0o755);
    return dest;
  })().finally(() => (installing = undefined));
  return installing;
}

/** Formats R code. `path` is where the code lives, so Air finds the project's air.toml. */
export async function formatR(code: string, path: string): Promise<string> {
  const air = findAir() ?? (await installAir());
  const p = Bun.spawn([air, "format", "--stdin-file-path", path.replace(/\.(qmd|rmd)$/i, ".R")], {
    cwd: dirname(path),
    stdin: new TextEncoder().encode(code),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exit] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (exit !== 0) throw new Error(err.trim() || `air exited with ${exit}`);
  return out;
}

export interface FormatResult {
  text: string;
  /** Chunks Air could not parse (left as they were). */
  failed: number;
  error?: string;
}

/** Formats a whole .R file, or the R chunks of a .qmd/.Rmd. */
export async function formatDocument(path: string, text: string): Promise<FormatResult> {
  if (!/\.(qmd|rmd)$/i.test(path)) {
    try {
      return { text: await formatR(text, path), failed: 0 };
    } catch (e) {
      return { text, failed: 1, error: (e as Error).message };
    }
  }
  const lines = text.split("\n");
  let failed = 0;
  let error: string | undefined;
  // Last chunk first, so earlier line numbers stay valid.
  for (const c of qmdRChunks(text).reverse()) {
    if (!c.code.trim()) continue;
    try {
      const out = (await formatR(c.code + "\n", path)).replace(/\n$/, "");
      if (out !== c.code) lines.splice(c.start, c.code.split("\n").length, ...out.split("\n"));
    } catch (e) {
      failed++;
      error ??= (e as Error).message;
    }
  }
  return { text: lines.join("\n"), failed, error };
}
