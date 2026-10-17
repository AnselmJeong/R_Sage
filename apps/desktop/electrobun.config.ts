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
      // Analysis modules and the R packages the app installs for them.
      "../../modules": "modules",
      "../../r-packages": "r-packages",
    },
    watchIgnore: ["dist/**"],
    mac: {
      // Developer ID signing and notarization only when the credentials are
      // set (see scripts/build-dmg.ts); otherwise the app is signed ad hoc.
      codesign: !!process.env.ELECTROBUN_DEVELOPER_ID,
      notarize:
        !!process.env.ELECTROBUN_DEVELOPER_ID &&
        !process.env.ELECTROBUN_SKIP_NOTARIZATION &&
        !!(process.env.ELECTROBUN_APPLEID || process.env.ELECTROBUN_APPLEAPIKEY),
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
