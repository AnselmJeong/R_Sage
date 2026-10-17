// Put the pinned Ark kernel binary in vendor/ark/ark for bundling.
//
//   bun scripts/fetch-ark.ts            download the release for this platform
//   bun scripts/fetch-ark.ts --source   build from a posit-dev/ark checkout
//                                       (ARK_SRC=/path/to/ark, needs cargo)
//
// Ark is MIT licensed (https://github.com/posit-dev/ark).

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARK_VERSION } from "../packages/kernel/src/ark";

const root = join(import.meta.dir, "..");
const dest = join(root, "vendor", "ark");
mkdirSync(dest, { recursive: true });

async function sh(cmd: string[], cwd?: string) {
  const p = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) throw new Error(`failed: ${cmd.join(" ")}`);
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

async function fromRelease() {
  const platform = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
  const res = await fetch(`https://api.github.com/repos/posit-dev/ark/releases/tags/${ARK_VERSION}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for Ark ${ARK_VERSION}`);
  const release = (await res.json()) as { assets: { name: string; browser_download_url: string }[] };
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const asset =
    release.assets.find((a) => a.name.includes(platform) && a.name.includes("universal")) ??
    release.assets.find((a) => a.name.includes(platform) && a.name.includes(arch) && !a.name.includes("debug"));
  if (!asset) throw new Error(`No Ark asset for ${platform}-${arch}: ${release.assets.map((a) => a.name).join(", ")}`);
  console.log(`Downloading ${asset.name}`);
  const tmp = mkdtempSync(join(tmpdir(), "ark-"));
  const zip = join(tmp, asset.name);
  await Bun.write(zip, await (await fetch(asset.browser_download_url)).arrayBuffer());
  await sh(["unzip", "-o", "-q", zip, "-d", tmp]);
  const bin = findFile(tmp, process.platform === "win32" ? "ark.exe" : "ark");
  if (!bin) throw new Error("ark binary not found in archive");
  await sh(["cp", bin, join(dest, "ark")]);
}

async function fromSource() {
  const src = process.env.ARK_SRC ?? join(root, "..", "ark");
  if (!existsSync(join(src, "Cargo.toml"))) throw new Error(`No Ark checkout at ${src} (set ARK_SRC)`);
  await sh(["cargo", "build", "--release", "-p", "ark"], src);
  await sh(["cp", join(src, "target", "release", "ark"), join(dest, "ark")]);
}

if (process.argv.includes("--source")) await fromSource();
else await fromRelease();
chmodSync(join(dest, "ark"), 0o755);
console.log(`Ark ${ARK_VERSION} → ${join(dest, "ark")}`);
