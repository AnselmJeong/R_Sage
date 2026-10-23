import { createRoot } from "react-dom/client";
import "dockview/dist/styles/dockview.css";
import "katex/dist/katex.min.css";
import "./assets/fonts/fonts.css";
import "./styles.css";
// Applies the saved theme before the first paint.
import "./editor/prefs";
import { connectHost } from "./host/client";
import { initStore } from "./store";
import { registerRLanguage, initLspEvents } from "./editor/monaco";
import { installGlobalKeys } from "./commands";
import { App } from "./App";

async function boot() {
  if (import.meta.env.VITE_RSAGE_SHELL === "electrobun") {
    const { installElectrobunBridge } = await import("./host/electrobun-bridge");
    installElectrobunBridge();
  }
  const root = createRoot(document.getElementById("root")!);
  root.render(<App />);
  try {
    await connectHost();
  } catch (e) {
    document.getElementById("root")!.innerHTML = `<div class="splash">호스트에 연결하지 못했습니다: ${(e as Error).message}</div>`;
    return;
  }
  registerRLanguage();
  initLspEvents();
  installGlobalKeys();
  await initStore();
}

void boot();
