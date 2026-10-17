import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In the desktop build "electrobun/view" comes from the Hutch devkit that
// `hutch electrobun prepare` creates in apps/desktop/.hutch/devkit. The
// browser build never runs that code, so a stub keeps it resolvable.
const devkit = resolve(__dirname, "../../apps/desktop/.hutch/devkit");
const shell = process.env.VITE_RSAGE_SHELL ?? "browser";

async function electrobunAliases(): Promise<Record<string, string>> {
  if (shell === "electrobun" && existsSync(devkit)) {
    const mod = await import(resolve(devkit, "api/config/electrobun-vite"));
    return mod.electrobunViteAliases(devkit);
  }
  return { "electrobun/view": resolve(__dirname, "src/host/electrobun-stub.ts") };
}

export default defineConfig(async () => ({
  plugins: [react()],
  base: "./",
  resolve: { alias: await electrobunAliases() },
  build: {
    outDir: process.env.RSAGE_UI_OUT ?? "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
  },
  worker: { format: "es" },
  server: { port: 5173, strictPort: true },
}));
