// Left activity bar and side panel, like Positron: Explorer, Search, Outline,
// Packages. Clicking the active icon hides the panel.

import { useRef } from "react";
import { create } from "zustand";
import { FileTree } from "./FileTree";
import { SearchPanel } from "./SearchPanel";
import { OutlinePanel } from "./OutlinePanel";
import { PackagesPanel } from "./PackagesPanel";

export type SideView = "files" | "search" | "outline" | "packages";

const KEY = "rsage.sidebar";
function load(): { view: SideView; open: boolean; width: number } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "");
    if (v && typeof v.width === "number") return v;
  } catch {}
  return { view: "files", open: true, width: 260 };
}

export const useSidebar = create(load);
useSidebar.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ view: s.view, open: s.open, width: s.width }));
  } catch {}
});

/** Show a view (opening the panel if hidden). */
export function showSideView(view: SideView) {
  useSidebar.setState({ view, open: true });
}

const ICONS: Record<SideView, JSX.Element> = {
  files: (
    <svg viewBox="0 0 24 24">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
    </svg>
  ),
  outline: (
    <svg viewBox="0 0 24 24">
      <path d="M4 5h16M8 10h12M8 15h12M4 20h16" />
    </svg>
  ),
  packages: (
    <svg viewBox="0 0 24 24">
      <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </svg>
  ),
};

const VIEWS: { id: SideView; title: string }[] = [
  { id: "files", title: "탐색기 (⌘⇧E)" },
  { id: "search", title: "검색 (⌘⇧F)" },
  { id: "outline", title: "개요 (⌘⇧O)" },
  { id: "packages", title: "패키지" },
];

export function ActivityBar() {
  const { view, open } = useSidebar();
  return (
    <div className="activitybar">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          className={`activity ${open && view === v.id ? "active" : ""}`}
          title={v.title}
          onClick={() => useSidebar.setState(open && view === v.id ? { open: false } : { view: v.id, open: true })}
        >
          {ICONS[v.id]}
        </button>
      ))}
    </div>
  );
}

export function SidePanel() {
  const { view, open, width } = useSidebar();
  const drag = useRef<{ x: number; w: number } | null>(null);
  if (!open) return null;
  return (
    <div className="sidepanel" style={{ width }}>
      {/* Views stay mounted so search results and tree state survive switching. */}
      <div className="sideview" hidden={view !== "files"}>
        <FileTree />
      </div>
      <div className="sideview" hidden={view !== "search"}>
        <SearchPanel />
      </div>
      <div className="sideview" hidden={view !== "outline"}>
        <OutlinePanel />
      </div>
      <div className="sideview" hidden={view !== "packages"}>
        {view === "packages" || usedPackages ? ((usedPackages = true), <PackagesPanel />) : null}
      </div>
      <div
        className="side-resizer"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, w: width };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          useSidebar.setState({ width: Math.max(180, Math.min(600, drag.current.w + e.clientX - drag.current.x)) });
        }}
        onPointerUp={() => (drag.current = null)}
      />
    </div>
  );
}

// The packages list runs Rscript, so wait until the view is first opened.
let usedPackages = false;
