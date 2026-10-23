import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { host } from "../host/client";
import { resolvedTheme } from "../editor/prefs";

const TERM_THEMES = {
  dark: {
    background: "#181819",
    foreground: "#e4e4e7",
    cursor: "#e4e4e7",
    selectionBackground: "#8fb3e040",
    black: "#3f3f46", red: "#e06c75", green: "#8cc59a", yellow: "#dcbc8f",
    blue: "#8fb3e0", magenta: "#c3a6e6", cyan: "#7cc4c4", white: "#d4d4d8",
    brightBlack: "#71717a", brightRed: "#f08b93", brightGreen: "#a6d8b2", brightYellow: "#ead0a8",
    brightBlue: "#a9c6ec", brightMagenta: "#d4bdf0", brightCyan: "#9ad6d6", brightWhite: "#fafafa",
  },
  light: {
    background: "#ffffff",
    foreground: "#27272a",
    cursor: "#18181b",
    selectionBackground: "#3d6aa833",
    black: "#27272a", red: "#c0392b", green: "#2f7d4f", yellow: "#9a6a2c",
    blue: "#3d6aa8", magenta: "#7a4fb0", cyan: "#2b7f86", white: "#a1a1aa",
    brightBlack: "#71717a", brightRed: "#d9534f", brightGreen: "#3c9a63", brightYellow: "#b5803a",
    brightBlue: "#5582c0", brightMagenta: "#9166c8", brightCyan: "#3a9aa2", brightWhite: "#d4d4d8",
  },
};

/** System shell (zsh) on the host's PTY, rooted at the project folder. */
export function TerminalPanel({ active }: { active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal>();

  useEffect(() => {
    if (!ref.current) return;
    const term = new Terminal({
      fontFamily: "Menlo, 'D2Coding', 'SF Mono', monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: TERM_THEMES[resolvedTheme()],
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    termRef.current = term;
    fit.fit();
    term.focus();
    let id: string | undefined;
    let disposed = false;
    const offData = host.on("terminal.data", (e) => e.id === id && term.write(e.data));
    const offExit = host.on("terminal.exit", (e) => {
      if (e.id === id) term.write(`\r\n\x1b[2m[프로세스 종료: ${e.code ?? ""}]\x1b[0m\r\n`);
    });
    void host.call("terminal.create", { cols: term.cols, rows: term.rows }).then((r) => {
      if (disposed) return void host.call("terminal.kill", { id: r.id });
      id = r.id;
    });
    term.onData((data) => id && void host.call("terminal.write", { id, data }));
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        if (id) void host.call("terminal.resize", { id, cols: term.cols, rows: term.rows });
      } catch {}
    });
    ro.observe(ref.current);
    const onTheme = () => (term.options.theme = TERM_THEMES[resolvedTheme()]);
    window.addEventListener("rsage-theme", onTheme);
    return () => {
      window.removeEventListener("rsage-theme", onTheme);
      disposed = true;
      ro.disconnect();
      offData();
      offExit();
      if (id) void host.call("terminal.kill", { id });
      term.dispose();
    };
  }, []);

  useEffect(() => {
    if (active) setTimeout(() => termRef.current?.focus(), 0);
  }, [active]);

  return <div className="terminal-host" ref={ref} onClick={() => termRef.current?.focus()} />;
}
