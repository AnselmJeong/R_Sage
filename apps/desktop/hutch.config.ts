// Tasks for the desktop app. Run from apps/desktop:
//   hutch run dev     build the UI for Electrobun and launch the app
//   hutch run build   signed, notarized release build (needs Apple credentials)
export default {
  scripts: {
    ui: "cd ../../packages/ui && VITE_RSAGE_SHELL=electrobun RSAGE_UI_OUT=../../apps/desktop/dist bun x vite build",
    ark: "bun ../../scripts/fetch-ark.ts",
    dev: "hutch electrobun prepare && hutch run ui && hutch electrobun dev",
    build: "hutch electrobun prepare && hutch run ark && hutch run ui && hutch electrobun build --env=stable",
    "build:canary": "hutch electrobun prepare && hutch run ark && hutch run ui && hutch electrobun build --env=canary",
  },
};
