// Opening projects and documents: what the toolbar's New and Open menus do.

import { host } from "./host/client";
import { useStore } from "./store";
import { closeFile, openFile } from "./editor/files";
import { pickFile, pickFolder } from "./components/FolderPicker";
import { promptDialog } from "./components/Dialogs";

/** Close the open files (asking about unsaved ones), then open another folder. */
export async function openProject(path: string, create = false): Promise<boolean> {
  const cur = useStore.getState().project;
  if (cur && cur.path === path) return true;
  for (const f of Object.keys(useStore.getState().openFiles)) if (!(await closeFile(f))) return false;
  try {
    const project = await host.call(create ? "project.create" : "project.open", { path });
    useStore.setState({ project, recent: await host.call("project.recent") });
    return true;
  } catch (e) {
    useStore.getState().notify((e as Error).message, "error");
    return false;
  }
}

export async function openFolderDialog() {
  const p = await pickFolder("프로젝트 폴더 열기");
  if (p) await openProject(p);
}

export async function newProjectDialog() {
  const p = await pickFolder("새 프로젝트를 만들 위치", true);
  if (p) await openProject(p, true);
}

const parentOf = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
const inside = (root: string, p: string) => p === root || p.startsWith(root + "/");

export const OPEN_EXTENSIONS = ["qmd", "R", "r", "Rmd", "rmd", "md", "txt", "csv", "tsv", "yml", "yaml", "bib", "json"];

/** Open a file from anywhere: a file outside the open project opens its folder as the project. */
export async function openPath(path: string) {
  const root = useStore.getState().project?.path;
  if (!root || !inside(root, path)) {
    if (!(await openProject(parentOf(path)))) return;
  }
  await openFile(path);
}

export async function openFileDialog() {
  const p = await pickFile("파일 열기", OPEN_EXTENSIONS);
  if (p) await openPath(p);
}

const TEMPLATES = {
  qmd: (title: string) => `---\ntitle: "${title.replace(/"/g, '\\"')}"\nformat: html\n---\n\n## 소개\n\n\n\n\`\`\`{r}\n\n\`\`\`\n`,
  R: () => "",
};

async function uniqueName(dir: string, base: string, ext: string): Promise<string> {
  const taken = new Set((await host.call("fs.list", { path: dir }).catch(() => [])).map((e) => e.name.toLowerCase()));
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${base}.${ext}` : `${base}-${i}.${ext}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** New Quarto document or R script. Without an open project, asks where to keep it first. */
export async function newDocument(kind: "qmd" | "R") {
  let root = useStore.getState().project?.path;
  if (!root) {
    const p = await pickFolder(kind === "qmd" ? "새 문서를 저장할 폴더" : "새 스크립트를 저장할 폴더", true);
    if (!p || !(await openProject(p, true))) return;
    root = useStore.getState().project!.path;
  }
  const suggested = await uniqueName(root, kind === "qmd" ? "untitled" : "script", kind);
  const name = await promptDialog({
    title: kind === "qmd" ? "새 Quarto 문서" : "새 R 스크립트",
    message: "프로젝트 폴더 기준 경로입니다. 하위 폴더도 쓸 수 있습니다 (예: reports/분석.qmd).",
    value: suggested,
    selectBaseName: true,
    confirm: "만들기",
  });
  if (!name) return;
  const file = /\.[A-Za-z]+$/.test(name) ? name : `${name}.${kind}`;
  const path = `${root}/${file.replace(/^\/+/, "")}`;
  try {
    await host.call("fs.create", { path, kind: "file" });
    const title = file.split("/").pop()!.replace(/\.[^.]+$/, "");
    const content = kind === "qmd" ? TEMPLATES.qmd(title) : TEMPLATES.R();
    if (content) await host.call("fs.write", { path, content, force: true });
  } catch (e) {
    useStore.getState().notify((e as Error).message, "error");
    return;
  }
  await openFile(path);
}
