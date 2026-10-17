// In-app folder and file browser, used when the shell has no native picker (browser dev shell).

import { useEffect, useState } from "react";
import { create } from "zustand";
import type { FileEntry } from "@rsage/shared";
import { host } from "../host/client";

interface Req {
  title: string;
  allowNew: boolean;
  /** Pick a file with one of these extensions instead of a folder. */
  extensions?: string[];
  start?: string;
  resolve: (p: string | null) => void;
}
const usePicker = create<{ req?: Req }>(() => ({}));

export function pickFolderInApp(title: string, allowNew = false, start?: string): Promise<string | null> {
  return new Promise((resolve) => usePicker.setState({ req: { title, allowNew, start, resolve } }));
}

/** Native file dialog when available, otherwise the in-app browser. */
export async function pickFile(title: string, extensions?: string[], startingFolder?: string): Promise<string | null> {
  const native = await host.call("dialog.pickFile", { title, extensions, startingFolder }).catch(() => null);
  if (native) return native;
  return new Promise((resolve) => usePicker.setState({ req: { title, allowNew: false, extensions: extensions ?? [], start: startingFolder, resolve } }));
}

/** Native picker when available, otherwise the in-app browser. */
export async function pickFolder(title: string, allowNew = false, startingFolder?: string): Promise<string | null> {
  const native = await host.call("dialog.pickFolder", { title, startingFolder }).catch(() => null);
  if (native) return native;
  return pickFolderInApp(title, allowNew, startingFolder);
}

export function FolderPickerHost() {
  const req = usePicker((s) => s.req);
  const [dir, setDir] = useState<{ path: string; parent: string | null; entries: FileEntry[] } | null>(null);
  const [typed, setTyped] = useState("");
  const [newName, setNewName] = useState("");

  const fileMode = !!req?.extensions;
  const [picked, setPicked] = useState<string | null>(null);
  const go = async (path?: string) => {
    try {
      const d = await host.call("fs.browse", { path, files: fileMode });
      setPicked(null);
      setDir(d);
      setTyped(d.path);
    } catch {}
  };
  useEffect(() => {
    if (req) void go(req.start);
  }, [req]);
  if (!req) return null;
  const exts = (req.extensions ?? []).map((e) => e.toLowerCase());
  const visible = (dir?.entries ?? []).filter(
    (e) => e.kind === "dir" || !exts.length || exts.includes(e.name.split(".").pop()?.toLowerCase() ?? ""),
  );
  const done = (p: string | null) => {
    usePicker.setState({ req: undefined });
    setNewName("");
    req.resolve(p);
  };

  return (
    <div className="dialog-backdrop picker-backdrop">
      <div className="dialog folder-picker">
        <h3>{req.title}</h3>
        <div className="row">
          <button className="btn btn-small" disabled={!dir?.parent} onClick={() => go(dir!.parent!)}>
            ↑ 상위
          </button>
          <input
            className="text-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go(typed)}
          />
        </div>
        <div className="folder-list">
          {visible.map((e) =>
            e.kind === "dir" ? (
              <div key={e.path} className="tree-row" onClick={() => go(e.path)}>
                <span className="tree-icon ic-dir">▸</span> {e.name}
              </div>
            ) : (
              <div
                key={e.path}
                className={`tree-row ${picked === e.path ? "active" : ""}`}
                onClick={() => setPicked(e.path)}
                onDoubleClick={() => done(e.path)}
              >
                <span className="tree-icon ic-file">·</span> {e.name}
              </div>
            ),
          )}
          {dir && visible.length === 0 && <div className="empty">{fileMode ? "열 수 있는 파일 없음" : "하위 폴더 없음"}</div>}
        </div>
        {req.allowNew && (
          <div className="row">
            <input className="text-input" placeholder="새 폴더 이름 (선택)" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
        )}
        <div className="dialog-actions">
          <button className="btn" onClick={() => done(null)}>
            취소
          </button>
          {fileMode ? (
            <button className="btn btn-primary" disabled={!picked} onClick={() => done(picked)}>
              열기
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!dir} onClick={() => done(newName.trim() ? `${dir!.path}/${newName.trim()}` : dir!.path)}>
              {newName.trim() ? "이 위치에 만들기" : "이 폴더 선택"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
