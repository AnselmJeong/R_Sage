// Tasks for the desktop app. Run from apps/desktop:
//   hutch run dev     build the UI for Electrobun and launch the app
//   hutch run build   release build (Developer ID signing and notarization
//                     when ELECTROBUN_DEVELOPER_ID etc. are set)
// For an installer disk image use `bun run dist:dmg` from the repository root.
export default {
  scripts: {
    // Array scripts run the real Bun from PATH. String scripts run in Hutch's
    // Cottontail shell, where `bun` is Cottontail and `bun x` is unavailable.
    ui: ["bun", "run", "--cwd", "../../packages/ui", "build:electrobun"],
    ark: ["bun", "../../scripts/fetch-ark.ts"],
    air: ["bun", "../../scripts/fetch-air.ts"],
    dev: "hutch electrobun prepare && hutch run ark && hutch run air && hutch run ui && hutch electrobun dev",
    build: "hutch electrobun prepare && hutch run ark && hutch run air && hutch run ui && hutch electrobun build --env=stable",
    "build:canary": "hutch electrobun prepare && hutch run ark && hutch run air && hutch run ui && hutch electrobun build --env=canary",
  },
};
