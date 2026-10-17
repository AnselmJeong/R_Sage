import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "R Sage",
    identifier: "dev.rsage.app",
    version: "0.1.0",
    description: "R analysis and Quarto reports in one workspace",
    fileAssociations: [
      { ext: ["R", "r"], name: "R Script", role: "Editor" },
      { ext: ["qmd"], name: "Quarto Document", role: "Editor" },
    ],
  },
  build: {
    // Real Bun in the main process: the host uses Bun.spawn's PTY and Bun.serve.
    mainProcess: "bun",
    bun: { entrypoint: "src/bun/index.ts" },
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
      "../../vendor/ark/ark": "ark/ark",
    },
    watchIgnore: ["dist/**"],
    mac: {
      codesign: true,
      notarize: true,
      bundleCEF: false,
      entitlements: {
        // Ark and R are separate executables that load R's dylibs.
        "com.apple.security.cs.allow-jit": true,
        "com.apple.security.cs.allow-unsigned-executable-memory": true,
        "com.apple.security.cs.disable-library-validation": true,
      },
    },
    linux: { bundleCEF: false },
  },
  runtime: { exitOnLastWindowClosed: true },
} satisfies ElectrobunConfig;
