// Package management state and actions. Installing, updating, removing and
// attaching run as visible R code in the console, like Positron, so progress,
// prompts and errors show where the user expects them; the list is refreshed
// when that code finishes.

import { create } from "zustand";
import type { PackageList } from "@rsage/shared";
import { host } from "./host/client";
import { useStore } from "./store";

interface PkgState {
  list?: PackageList;
  loading: boolean;
  error?: string;
  outdated?: { name: string; installed: string; latest: string }[];
  checking: boolean;
  /** Code running in the console on the panel's behalf. */
  busy?: string;
  /** Packages changed while loaded: their new version needs a session restart. */
  needsRestart: string[];
}

export const usePackages = create<PkgState>(() => ({ loading: false, checking: false, needsRestart: [] }));

export async function refreshPackages() {
  usePackages.setState({ loading: true, error: undefined });
  try {
    usePackages.setState({ list: await host.call("packages.list"), loading: false });
  } catch (e) {
    usePackages.setState({ loading: false, error: (e as Error).message });
  }
}

export async function checkUpdates() {
  usePackages.setState({ checking: true, error: undefined });
  try {
    usePackages.setState({ outdated: await host.call("packages.outdated"), checking: false });
  } catch (e) {
    usePackages.setState({ checking: false, error: `업데이트 확인 실패: ${(e as Error).message}` });
  }
}

const q = (s: string) => JSON.stringify(s);
const vec = (xs: string[]) => (xs.length === 1 ? q(xs[0]!) : `c(${xs.map(q).join(", ")})`);

/** Runs code in the console and resolves when it finishes. */
async function runInConsole(code: string, label: string): Promise<boolean> {
  if (useStore.getState().session.state === "stopped") await host.call("session.start", {}).catch(() => {});
  usePackages.setState({ busy: label });
  try {
    const { executionId } = await host.call("console.execute", { code, origin: "app" });
    const status = await new Promise<string>((resolve) => {
      const off = host.on("execution", (rec) => {
        if (rec.id === executionId && rec.status !== "queued" && rec.status !== "running") {
          off();
          resolve(rec.status);
        }
      });
    });
    return status === "ok";
  } finally {
    usePackages.setState({ busy: undefined });
    void refreshPackages();
  }
}

function noteLoaded(names: string[]) {
  const loaded = new Set(usePackages.getState().list?.loaded ?? []);
  const hit = names.filter((n) => loaded.has(n));
  if (hit.length) usePackages.setState((s) => ({ needsRestart: [...new Set([...s.needsRestart, ...hit])] }));
}

export type InstallSource = "cran" | "bioc" | "github" | "file";

export function installCode(names: string[], o: { source?: InstallSource; lib?: string; dependencies?: boolean } = {}): string {
  const lib = o.lib ? `, lib = ${q(o.lib)}` : "";
  switch (o.source ?? "cran") {
    case "bioc":
      return `if (!requireNamespace("BiocManager", quietly = TRUE)) install.packages("BiocManager"${lib})\nBiocManager::install(${vec(names)}${lib}, update = FALSE, ask = FALSE)`;
    case "github":
      return `if (!requireNamespace("remotes", quietly = TRUE)) install.packages("remotes"${lib})\nremotes::install_github(${vec(names)}${lib})`;
    case "file":
      return `install.packages(${vec(names)}, repos = NULL${lib})`;
    default:
      return `install.packages(${vec(names)}${lib}${o.dependencies === false ? ", dependencies = FALSE" : ""})`;
  }
}

export async function installPackages(names: string[], o: { source?: InstallSource; lib?: string; dependencies?: boolean } = {}) {
  if (!names.length) return false;
  noteLoaded(names);
  return runInConsole(installCode(names, o), `${names.join(", ")} 설치 중`);
}

export async function updatePackages(names: string[]) {
  if (!names.length) return false;
  noteLoaded(names);
  const ok = await runInConsole(`update.packages(oldPkgs = ${vec(names)}, ask = FALSE)`, `${names.length}개 패키지 업데이트 중`);
  void checkUpdates();
  return ok;
}

export async function removePackages(names: string[]) {
  noteLoaded(names);
  const lib = usePackages.getState().list?.packages.find((p) => p.name === names[0])?.libPath;
  return runInConsole(`remove.packages(${vec(names)}${lib && names.length === 1 ? `, lib = ${q(lib)}` : ""})`, `${names.join(", ")} 삭제 중`);
}

export async function setAttached(name: string, attach: boolean) {
  return runInConsole(attach ? `library(${name})` : `detach("package:${name}", unload = TRUE, character.only = TRUE)`, attach ? `${name} 불러오는 중` : `${name} 해제 중`);
}

export function packageHelp(name: string) {
  void host.call("console.execute", { code: `help(package = ${q(name)})`, origin: "app" });
}
