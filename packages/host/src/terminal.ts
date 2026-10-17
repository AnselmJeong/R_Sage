// System terminal sessions on Bun's built-in PTY (Bun.spawn `terminal`).

import { randomUUID } from "node:crypto";
import type { Subprocess } from "bun";

interface Term {
  proc: Subprocess;
  terminal: any;
}

export class TerminalService {
  private terms = new Map<string, Term>();

  constructor(
    private onData: (id: string, data: string) => void,
    private onExit: (id: string, code: number | null) => void,
  ) {}

  create(cwd: string, cols: number, rows: number): string {
    const id = randomUUID();
    const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
    const decoder = new TextDecoder();
    const proc = Bun.spawn([shell, "-l"], {
      cwd,
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", LANG: process.env.LANG || "en_US.UTF-8" },
      terminal: {
        cols,
        rows,
        data: (_t: unknown, bytes: Uint8Array) => this.onData(id, decoder.decode(bytes, { stream: true })),
      },
      onExit: (_p: unknown, code: number | null) => {
        this.terms.delete(id);
        this.onExit(id, code);
      },
    } as any);
    this.terms.set(id, { proc, terminal: (proc as any).terminal });
    return id;
  }

  write(id: string, data: string) {
    this.terms.get(id)?.terminal?.write(data);
  }

  resize(id: string, cols: number, rows: number) {
    this.terms.get(id)?.terminal?.resize(cols, rows);
  }

  kill(id: string) {
    const t = this.terms.get(id);
    if (!t) return;
    t.proc.kill();
    this.terms.delete(id);
  }

  killAll() {
    for (const id of [...this.terms.keys()]) this.kill(id);
  }
}
