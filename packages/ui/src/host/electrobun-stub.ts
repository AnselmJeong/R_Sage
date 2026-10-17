// Stand-in for "electrobun/view" in the browser build. Never executed there:
// main.tsx only installs the bridge when built for the desktop shell.
export class Electroview {
  static defineRPC<_T = unknown>(_: unknown): unknown {
    throw new Error("Electrobun is not available in the browser shell");
  }
  rpc: unknown;
  constructor(_: unknown) {}
}
export default { Electroview };
