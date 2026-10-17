// App-wide settings in ~/.rsage/config.json (project settings live in the
// project's own .rsage/ folder).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RecentProject } from "@rsage/shared";

export interface AppConfig {
  defaultRHome?: string;
  manualR: string[];
  recentProjects: RecentProject[];
  assistant?: { autoRunR?: boolean; defaultModel?: string; autoApproveEditsIn?: string[] };
}

export function appDir(): string {
  return process.env.RSAGE_HOME ?? join(homedir(), ".rsage");
}

/** Write a file atomically (temp file + rename) so a crash never leaves half a file. */
export function writeFileAtomic(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

export function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return { ...fallback, ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return fallback;
  }
}

export class ConfigStore {
  private path = join(appDir(), "config.json");
  data: AppConfig = readJson<AppConfig>(this.path, { manualR: [], recentProjects: [] });

  save() {
    writeFileAtomic(this.path, JSON.stringify(this.data, null, 2));
  }

  update(patch: Partial<AppConfig>) {
    this.data = { ...this.data, ...patch };
    this.save();
  }

  touchRecent(path: string, name: string) {
    const rest = this.data.recentProjects.filter((p) => p.path !== path);
    this.update({ recentProjects: [{ path, name, openedAt: new Date().toISOString() }, ...rest].slice(0, 15) });
  }
}
