// Tasks for the desktop app. Run from apps/desktop:
//   hutch run dev     build the UI for Electrobun and launch the app
//   hutch run build   signed, notarized release build (needs Apple credentials)
export default {
  scripts: {
    // Array scripts run the real Bun from PATH. String scripts run in Hutch's
    // Cottontail shell, where `bun` is Cottontail and `bun x` is unavailable.
    ui: ["bun", "run", "--cwd", "../../packages/ui", "build:electrobun"],
    ark: ["bun", "../../scripts/fetch-ark.ts"],
    dev: "hutch electrobun prepare && hutch run ark && hutch run ui && hutch electrobun dev",
    build: "hutch electrobun prepare && hutch run ark && hutch run ui && hutch electrobun build --env=stable",
    "build:canary": "hutch electrobun prepare && hutch run ark && hutch run ui && hutch electrobun build --env=canary",
  },
};
