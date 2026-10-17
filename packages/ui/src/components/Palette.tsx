// Command palette (Mod+Shift+P) and quick open (Mod+P).

import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { allCommands, formatKey, onCommandsChanged, runCommand } from "../commands";
import { host } from "../host/client";
import { useStore } from "../store";
import { openFile } from "../editor/files";

export const usePalette = create<{ mode: "commands" | "files" | null }>(() => ({ mode: null }));

function score(text: string, q: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  const query = q.toLowerCase();
  const idx = t.indexOf(query);
  if (idx >= 0) return 100 - idx;
  // subsequence match
  let ti = 0;
  for (const ch of query) {
    ti = t.indexOf(ch, ti);
    if (ti < 0) return 0;
    ti++;
  }
  return 10;
}

export function Palette() {
  const mode = usePalette((s) => s.mode);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [, force] = useState(0);
  const root = useStore((s) => s.project?.path ?? "");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => onCommandsChanged(() => force((n) => n + 1)), []);
  useEffect(() => {
    setQ("");
    setSel(0);
    if (mode === "files") void host.call("fs.walk").then((r) => setFiles(r.files)).catch(() => setFiles([]));
  }, [mode]);

  const items = useMemo(() => {
    if (mode === "commands") {
      return allCommands()
        .map((c) => ({ id: c.id, label: `${c.category ? c.category + ": " : ""}${c.title}`, hint: formatKey(c.key), s: score(`${c.category ?? ""} ${c.title}`, q) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.label.localeCompare(b.label))
        .slice(0, 50);
    }
    if (mode === "files") {
      return files
        .map((f) => ({ id: f, label: f.split("/").pop()!, hint: f, s: score(f, q) + score(f.split("/").pop()!, q) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 50);
    }
    return [];
  }, [mode, q, files]);

  if (!mode) return null;
  const close = () => usePalette.setState({ mode: null });
  const choose = (i: number) => {
    const it = items[i];
    close();
    if (!it) return;
    if (mode === "commands") void runCommand(it.id);
    else void openFile(`${root}/${it.id}`);
  };

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette">
        <input
          autoFocus
          className="text-input"
          placeholder={mode === "commands" ? "명령 검색" : "파일 이름으로 열기"}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Escape") close();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") choose(sel);
          }}
        />
        <div className="palette-list" ref={listRef}>
          {items.map((it, i) => (
            <div key={it.id} className={`palette-item ${i === sel ? "sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => choose(i)}>
              <span>{it.label}</span>
              <span className="muted small">{it.hint}</span>
            </div>
          ))}
          {items.length === 0 && <div className="empty">결과 없음</div>}
        </div>
      </div>
    </div>
  );
}
