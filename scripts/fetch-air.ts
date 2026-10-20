// Put the pinned Air formatter binary in vendor/air/air for bundling, so
// format-on-save works on the first save without a download.
//
//   bun scripts/fetch-air.ts           download (skipped when vendor/air/air exists; --force to redo)
//
// Air is MIT licensed (https://github.com/posit-dev/air).

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const AIR_VERSION = "0.12.0";

const root = join(import.meta.dir, "..");
const dest = join(root, "vendor", "air");
const bin = join(dest, "air");

if (existsSync(bin) && !process.argv.includes("--force")) {
  console.log(`Air already at ${bin} (use --force to download again)`);
  process.exit(0);
}

const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
const asset =
  process.platform === "darwin" ? `air-${arch}-apple-darwin.tar.gz` : process.platform === "linux" ? `air-${arch}-unknown-linux-gnu.tar.gz` : null;
if (!asset) {
  console.log(`No Air build for ${process.platform}; the app downloads it on first use.`);
  process.exit(0);
}

const base = `https://github.com/posit-dev/air/releases/download/${AIR_VERSION}`;
const res = await fetch(`${base}/${asset}`);
if (!res.ok) throw new Error(`Air download failed: HTTP ${res.status}`);
const data = new Uint8Array(await res.arrayBuffer());
const sum = await fetch(`${base}/${asset}.sha256`).then((r) => (r.ok ? r.text() : ""));
const want = sum.trim().split(/\s+/)[0];
if (want) {
  const got = new Bun.CryptoHasher("sha256").update(data).digest("hex");
  if (got !== want) throw new Error(`Air checksum mismatch: ${got} != ${want}`);
}

const tmp = mkdtempSync(join(tmpdir(), "air-"));
const tgz = join(tmp, asset);
await Bun.write(tgz, data);
const tar = Bun.spawnSync(["tar", "xzf", tgz, "-C", tmp]);
if (tar.exitCode !== 0) throw new Error(`Could not unpack ${asset}`);

function find(dir: string): string | undefined {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      const f = find(p);
      if (f) return f;
    } else if (e === "air") return p;
  }
}
const found = find(tmp);
if (!found) throw new Error("The Air archive has no air binary");
mkdirSync(dest, { recursive: true });
await Bun.write(bin, Bun.file(found));
chmodSync(bin, 0o755);
console.log(`Air ${AIR_VERSION} → ${bin}`);
