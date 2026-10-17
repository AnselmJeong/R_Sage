import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { host } from "../host/client";

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
      theme: { background: "#141518" },
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
    return () => {
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
