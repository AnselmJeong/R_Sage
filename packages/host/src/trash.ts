// Move files to the system trash instead of deleting them.

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export async function moveToTrash(path: string): Promise<void> {
  if (process.platform === "darwin") {
    // Finder keeps "Put Back" working; fall back to ~/.Trash if scripting is denied.
    const script = `tell application "Finder" to delete (POSIX file ${JSON.stringify(path)})`;
    const p = Bun.spawn(["osascript", "-e", script], { stdout: "ignore", stderr: "ignore" });
    if ((await p.exited) === 0) return;
    const dest = uniqueName(join(homedir(), ".Trash"), basename(path));
    renameSync(path, dest);
    return;
  }
  // freedesktop.org trash spec (Linux)
  const base = join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "Trash");
  mkdirSync(join(base, "files"), { recursive: true });
  mkdirSync(join(base, "info"), { recursive: true });
  const dest = uniqueName(join(base, "files"), basename(path));
  const name = basename(dest);
  writeFileSync(
    join(base, "info", `${name}.trashinfo`),
    `[Trash Info]\nPath=${encodeURI(path)}\nDeletionDate=${new Date().toISOString().slice(0, 19)}\n`,
  );
  renameSync(path, dest);
}

function uniqueName(dir: string, name: string): string {
  let candidate = join(dir, name);
  for (let i = 2; existsSync(candidate); i++) candidate = join(dir, `${name} ${i}`);
  return candidate;
}
