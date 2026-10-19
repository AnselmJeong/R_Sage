// Build a macOS installer disk image (DMG) of R Sage.
//
//   bun run dist:dmg                 release build + DMG in apps/desktop/artifacts/
//   bun run dist:dmg --skip-build    repackage the last release build only
//
// The release build bundles the UI, Ark (vendor/ark), the analysis modules and
// the app's own R packages (see apps/desktop/electrobun.config.ts). The DMG
// holds "R Sage.app" and an Applications shortcut, with the app icon as the
// volume icon.
//
// Signing: without credentials the app is signed ad hoc, which runs on this
// Mac but makes other Macs show a Gatekeeper warning. To sign with a Developer
// ID and notarize, set before running:
//   ELECTROBUN_DEVELOPER_ID   "Developer ID Application: Name (TEAMID)"
//   ELECTROBUN_TEAMID         the team id
//   and either ELECTROBUN_APPLEID + ELECTROBUN_APPLEIDPASS (app-specific password)
//   or ELECTROBUN_APPLEAPIKEY + ELECTROBUN_APPLEAPIISSUER + ELECTROBUN_APPLEAPIKEYPATH.
// ELECTROBUN_SKIP_NOTARIZATION=1 signs without notarizing.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const desktop = join(root, "apps", "desktop");
const skipBuild = process.argv.includes("--skip-build");
const env = process.env;

function run(cmd: string[], opts: { cwd?: string; quiet?: boolean } = {}) {
  const p = Bun.spawnSync(cmd, { cwd: opts.cwd, stdout: opts.quiet ? "pipe" : "inherit", stderr: opts.quiet ? "pipe" : "inherit", env });
  if (p.exitCode !== 0) {
    const out = opts.quiet ? `\n${p.stderr?.toString() ?? ""}${p.stdout?.toString() ?? ""}` : "";
    throw new Error(`${cmd.join(" ")} failed (${p.exitCode})${out}`);
  }
  return p.stdout?.toString() ?? "";
}

function fail(msg: string): never {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

if (process.platform !== "darwin") fail("DMG builds need macOS.");
const hutch = Bun.which("hutch") ?? [join(homedir(), ".hutch", "bin", "hutch")].find(existsSync);
if (!hutch && !skipBuild) fail("Hutch was not found. Install it from https://hutch.blackboard.sh");

const version = /version:\s*"([^"]+)"/.exec(readFileSync(join(desktop, "electrobun.config.ts"), "utf8"))?.[1] ?? "0.0.0";
const arch = process.arch === "arm64" ? "arm64" : "x64";
const identity = env.ELECTROBUN_DEVELOPER_ID;
const notarize =
  !!identity && !env.ELECTROBUN_SKIP_NOTARIZATION && !!(env.ELECTROBUN_APPLEID || env.ELECTROBUN_APPLEAPIKEY);

console.log(`R Sage ${version} (${arch}) · ${identity ? `signing as ${identity}${notarize ? ", notarizing" : ""}` : "ad hoc signing"}`);

// 1. Release build: prepare the devkit, fetch Ark, build the UI, package the app.
if (!skipBuild) run([hutch!, "run", "build"], { cwd: desktop });

const buildDir = join(desktop, "build", `stable-macos-${arch}`);
const app = join(buildDir, "R Sage.app");
if (!existsSync(app)) fail(`No app at ${app}. Run without --skip-build.`);

// 2. The real app. Electrobun's release "R Sage.app" is a small self-extracting
// launcher that replaces itself with the app on first open, which fails when
// it is opened inside the read-only DMG ("Installation failed"). Ship the
// unpacked app instead: it runs from the DMG, from Applications or anywhere.
const stage = mkdtempSync(join(tmpdir(), "rsage-dmg-"));
try {
  const resources = join(app, "Contents", "Resources");
  const archive = readdirSync(resources).find((f) => f.endsWith(".tar.zst"));
  if (!archive) fail(`No packed app (.tar.zst) in ${resources}.`);
  const tar = join(stage, "..", `${stage.split("/").pop()}.tar`);
  writeFileSync(tar, Bun.zstdDecompressSync(readFileSync(join(resources, archive))));
  run(["tar", "-xf", tar, "-C", stage], { quiet: true });
  rmSync(tar, { force: true });
  const unpacked = join(stage, "R Sage.app");
  if (!existsSync(unpacked)) fail(`The packed app has no "R Sage.app".`);

  // Signature. Electrobun signs the app with the Developer ID when it is set;
  // otherwise sign ad hoc so the bundle's seal covers every file.
  if (!identity) run(["codesign", "--force", "--deep", "--sign", "-", unpacked], { quiet: true });
  run(["codesign", "--verify", "--deep", "--strict", unpacked], { quiet: true });

  // 3. Disk image: the app, an Applications shortcut and the volume icon.
  symlinkSync("/Applications", join(stage, "Applications"));
  const icns = join(desktop, "assets", "icon", "icon.icns");
  if (existsSync(icns)) cpSync(icns, join(stage, ".VolumeIcon.icns"));
  const outDir = join(desktop, "artifacts");
  mkdirSync(outDir, { recursive: true });
  const dmg = join(outDir, `R-Sage-${version}-${arch}.dmg`);
  const rw = join(stage, "..", `${stage.split("/").pop()}-rw.dmg`);
  rmSync(dmg, { force: true });
  // A writable image first, so the volume can be marked as having a custom icon.
  run(["hdiutil", "create", "-volname", "R Sage", "-srcfolder", stage, "-fs", "HFS+", "-format", "UDRW", "-ov", rw], { quiet: true });
  if (existsSync(icns)) {
    const mount = mkdtempSync(join(tmpdir(), "rsage-dmg-mnt-"));
    run(["hdiutil", "attach", rw, "-nobrowse", "-noautoopen", "-mountpoint", mount], { quiet: true });
    try {
      run(["SetFile", "-a", "C", mount], { quiet: true });
    } catch {
      console.warn("SetFile (Xcode command line tools) not found; the DMG keeps the default volume icon.");
    } finally {
      run(["hdiutil", "detach", mount, "-quiet"], { quiet: true });
      rmSync(mount, { recursive: true, force: true });
    }
  }
  run(["hdiutil", "convert", rw, "-format", "UDZO", "-imagekey", "zlib-level=9", "-o", dmg], { quiet: true });
  rmSync(rw, { force: true });

  // 4. Developer ID: sign the image, notarize it and staple the ticket.
  if (identity) {
    run(["codesign", "--force", "--sign", identity, "--timestamp", dmg]);
    if (notarize) {
      const auth = env.ELECTROBUN_APPLEAPIKEY
        ? ["--key", env.ELECTROBUN_APPLEAPIKEYPATH ?? "", "--key-id", env.ELECTROBUN_APPLEAPIKEY, "--issuer", env.ELECTROBUN_APPLEAPIISSUER ?? ""]
        : ["--apple-id", env.ELECTROBUN_APPLEID!, "--password", env.ELECTROBUN_APPLEIDPASS ?? "", "--team-id", env.ELECTROBUN_TEAMID ?? ""];
      run(["xcrun", "notarytool", "submit", dmg, ...auth, "--wait"]);
      run(["xcrun", "stapler", "staple", dmg]);
    }
  }

  run(["hdiutil", "verify", dmg], { quiet: true });
  const size = (Bun.file(dmg).size / 1024 / 1024).toFixed(1);
  console.log(`\n✓ ${dmg} (${size} MB)`);
  if (!identity) console.log("  Ad hoc signed: other Macs will warn on first open (right-click → 열기).");
} finally {
  rmSync(stage, { recursive: true, force: true });
}
