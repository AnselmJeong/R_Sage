import { useCallback, useEffect, useState } from "react";
import type { FileEntry } from "@rsage/shared";
import { host } from "../host/client";
import { useStore } from "../store";
import { basename, disposeFile, openFile } from "../editor/files";
import { confirmDialog, promptDialog } from "./Dialogs";

function iconFor(e: FileEntry, open: boolean): { glyph: string; cls: string } {
  if (e.kind === "dir") return { glyph: open ? "▾" : "▸", cls: "ic-dir" };
  const ext = e.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "r") return { glyph: "R", cls: "ic-r" };
  if (ext === "qmd" || ext === "rmd") return { glyph: "Q", cls: "ic-qmd" };
  if (ext === "md") return { glyph: "M", cls: "ic-md" };
  if (["csv", "tsv", "xlsx", "xls", "rds", "rdata", "parquet", "sav", "dta", "sas7bdat", "feather"].includes(ext))
    return { glyph: "▦", cls: "ic-data" };
  if (ext === "bib" || ext === "csl") return { glyph: "❝", cls: "ic-bib" };
  if (["png", "jpg", "jpeg", "svg", "gif", "pdf"].includes(ext)) return { glyph: "▣", cls: "ic-img" };
  if (["html", "docx", "pptx"].includes(ext)) return { glyph: "◧", cls: "ic-out" };
  return { glyph: "·", cls: "ic-file" };
}

const OPENABLE = /\.(r|qmd|rmd|md|txt|csv|tsv|json|ya?ml|bib|tex|css|js|ts|sh|sql|toml|lua|csl|html|rprofile|renviron|gitignore|py)$/i;

interface Menu {
  x: number;
  y: number;
  entry: FileEntry | null;
}

export function FileTree() {
  const project = useStore((s) => s.project);
  const activeFile = useStore((s) => s.activeFile);
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const root = project?.path;

  const load = useCallback(async (dir: string) => {
    try {
      const list = await host.call("fs.list", { path: dir });
      setChildren((c) => ({ ...c, [dir]: list }));
    } catch {
      setChildren((c) => {
        const n = { ...c };
        delete n[dir];
        return n;
      });
    }
  }, []);

  useEffect(() => {
    if (!root) return;
    setChildren({});
    setExpanded(new Set([root]));
    void load(root);
  }, [root, load]);

  useEffect(() => {
    return host.on("fs.changed", ({ paths }) => {
      const dirs = new Set(paths.map((p) => p.slice(0, p.lastIndexOf("/")) || "/"));
      for (const d of dirs) if (children[d] || d === root) void load(d);
    });
  }, [children, root, load]);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  if (!root) return null;

  const toggle = (dir: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(dir)) n.delete(dir);
      else {
        n.add(dir);
        if (!children[dir]) void load(dir);
      }
      return n;
    });
  };

  const parentOf = (p: string) => p.slice(0, p.lastIndexOf("/"));
  const refresh = (dir: string) => load(dir);

  const newItem = async (kind: "file" | "dir", base: string) => {
    const name = await promptDialog({
      title: kind === "file" ? "새 파일" : "새 폴더",
      placeholder: kind === "file" ? "analysis.R" : "data",
      confirm: "만들기",
    });
    if (!name) return;
    const path = `${base}/${name}`;
    try {
      await host.call("fs.create", { path, kind });
      setExpanded((s) => new Set(s).add(base));
      await refresh(base);
      if (kind === "file") void openFile(path);
    } catch (e) {
      useStore.getState().notify((e as Error).message, "error");
    }
  };

  const rename = async (e: FileEntry) => {
    const name = await promptDialog({ title: "이름 바꾸기", value: e.name, confirm: "바꾸기", selectBaseName: e.kind === "file" });
    if (!name || name === e.name) return;
    const to = `${parentOf(e.path)}/${name}`;
    await move(e, to);
  };

  const move = async (e: FileEntry, to: string) => {
    const wasOpen = useStore.getState().openFiles[e.path];
    if (wasOpen?.dirty) {
      useStore.getState().notify("저장하지 않은 파일은 이동할 수 없습니다. 먼저 저장하세요.", "error");
      return;
    }
    try {
      await host.call("fs.rename", { from: e.path, to });
      if (wasOpen) {
        disposeFile(e.path);
        void openFile(to);
      }
      await refresh(parentOf(e.path));
      await refresh(parentOf(to));
    } catch (err) {
      useStore.getState().notify((err as Error).message, "error");
    }
  };

  const remove = async (e: FileEntry) => {
    const ok = await confirmDialog({
      title: "휴지통으로 이동",
      message: `${e.name}${e.kind === "dir" ? " 폴더와 그 안의 모든 파일" : ""}을(를) 휴지통으로 옮길까요?`,
      confirm: "휴지통으로 이동",
      danger: true,
    });
    if (!ok) return;
    try {
      await host.call("fs.trash", { path: e.path });
      for (const p of Object.keys(useStore.getState().openFiles)) if (p === e.path || p.startsWith(e.path + "/")) disposeFile(p);
      await refresh(parentOf(e.path));
    } catch (err) {
      useStore.getState().notify((err as Error).message, "error");
    }
  };

  const open = (e: FileEntry) => {
    if (e.kind === "dir") return toggle(e.path);
    if (OPENABLE.test(e.name) || !e.name.includes(".")) void openFile(e.path);
    else void host.call("shell.openExternal", { path: e.path });
  };

  const renderDir = (dir: string, depth: number): JSX.Element[] => {
    const list = children[dir];
    if (!list) return [<div key={dir + ":loading"} className="tree-row muted" style={{ paddingLeft: 12 + depth * 12 }}>…</div>];
    return list.flatMap((e) => {
      const isOpen = expanded.has(e.path);
      const ic = iconFor(e, isOpen);
      const row = (
        <div
          key={e.path}
          className={`tree-row ${activeFile === e.path ? "active" : ""} ${dragOver === e.path ? "drop" : ""}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => open(e)}
          onContextMenu={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            setMenu({ x: ev.clientX, y: ev.clientY, entry: e });
          }}
          draggable
          onDragStart={(ev) => ev.dataTransfer.setData("text/rsage-path", JSON.stringify(e))}
          onDragOver={(ev) => {
            if (e.kind !== "dir") return;
            ev.preventDefault();
            setDragOver(e.path);
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(ev) => {
            setDragOver(null);
            const raw = ev.dataTransfer.getData("text/rsage-path");
            if (!raw || e.kind !== "dir") return;
            ev.preventDefault();
            const src = JSON.parse(raw) as FileEntry;
            if (src.path === e.path || e.path.startsWith(src.path + "/")) return;
            void move(src, `${e.path}/${src.name}`);
          }}
          title={e.path}
        >
          <span className={`tree-icon ${ic.cls}`}>{ic.glyph}</span>
          <span className="ellipsis">{e.name}</span>
        </div>
      );
      return e.kind === "dir" && isOpen ? [row, ...renderDir(e.path, depth + 1)] : [row];
    });
  };

  return (
    <div
      className="file-tree"
      onContextMenu={(ev) => {
        ev.preventDefault();
        setMenu({ x: ev.clientX, y: ev.clientY, entry: null });
      }}
      onDragOver={(ev) => ev.preventDefault()}
      onDrop={(ev) => {
        const raw = ev.dataTransfer.getData("text/rsage-path");
        if (!raw) return;
        const src = JSON.parse(raw) as FileEntry;
        if (parentOf(src.path) !== root) void move(src, `${root}/${src.name}`);
      }}
    >
      <div className="panel-toolbar">
        <strong className="ellipsis">{project?.name}</strong>
        <span className="spacer" />
        <button className="btn btn-icon" title="새 파일" onClick={() => newItem("file", root)}>
          ＋
        </button>
        <button className="btn btn-icon" title="새 폴더" onClick={() => newItem("dir", root)}>
          ▤
        </button>
        <button
          className="btn btn-icon"
          title="새로 고침"
          onClick={() => {
            void load(root);
            for (const d of expanded) if (d !== root) void load(d);
          }}
        >
          ↻
        </button>
      </div>
      <div className="tree-scroll">{renderDir(root, 0)}</div>
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {(() => {
            const base = menu.entry ? (menu.entry.kind === "dir" ? menu.entry.path : parentOf(menu.entry.path)) : root;
            const items: [string, () => void][] = [
              ["새 파일", () => newItem("file", base)],
              ["새 폴더", () => newItem("dir", base)],
            ];
            if (menu.entry) {
              const e = menu.entry;
              items.push(["이름 바꾸기", () => rename(e)]);
              items.push(["경로 복사", () => navigator.clipboard.writeText(e.path)]);
              items.push(["상대 경로 복사", () => navigator.clipboard.writeText(e.path.slice(root.length + 1))]);
              if (e.kind === "file" && /\.r$/i.test(e.name))
                items.push(["source()로 실행", () => host.call("console.execute", { code: `source(${JSON.stringify(e.path)}, echo = TRUE)`, origin: "app" })]);
              items.push(["외부 앱으로 열기", () => host.call("shell.openExternal", { path: e.path })]);
              items.push(["휴지통으로 이동", () => remove(e)]);
            }
            return items.map(([label, fn]) => (
              <div
                key={label}
                className={`menu-item ${label === "휴지통으로 이동" ? "danger" : ""}`}
                onClick={() => {
                  setMenu(null);
                  fn();
                }}
              >
                {label}
              </div>
            ));
          })()}
        </div>
      )}
    </div>
  );
}

export { basename };
