import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In the desktop build "electrobun/view" comes from the Hutch devkit that
// `hutch electrobun prepare` creates in apps/desktop/.hutch/devkit. The
// browser build never runs that code, so a stub keeps it resolvable.
const devkit = resolve(__dirname, "../../apps/desktop/.hutch/devkit");
const shell = process.env.VITE_RSAGE_SHELL ?? "browser";

type Alias = { find: RegExp; replacement: string };

// Maps the devkit's export map ("./view" -> "./api/browser/index.ts") to Vite
// aliases. Read directly: Vite loads this config under Node, which cannot
// import the devkit's own TypeScript helper.
function electrobunAliases(): Alias[] | Record<string, string> {
  if (shell === "electrobun" && existsSync(devkit)) {
    const manifest = JSON.parse(readFileSync(resolve(devkit, "package.json"), "utf8")) as {
      exports: Record<string, string>;
    };
    return Object.entries(manifest.exports).map(([subpath, target]) => {
      const specifier = subpath === "." ? "electrobun" : `electrobun/${subpath.slice(2)}`;
      return {
        find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
        replacement: resolve(devkit, target),
      };
    });
  }
  return { "electrobun/view": resolve(__dirname, "src/host/electrobun-stub.ts") };
}

export default defineConfig(() => ({
  plugins: [react()],
  base: "./",
  resolve: { alias: electrobunAliases() },
  build: {
    outDir: process.env.RSAGE_UI_OUT ?? "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
  },
  worker: { format: "es" },
  server: { port: 5173, strictPort: true },
}));
