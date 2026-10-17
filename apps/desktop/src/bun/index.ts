// R Sage desktop shell (Electrobun main process).
//
// All app behaviour lives in @rsage/host; this file only creates the window,
// relays the wire envelope over Electrobun's typed RPC, and adds what needs
// the native side: menus, the folder dialog and quitting cleanly.

import { join } from "node:path";
import Electrobun, { ApplicationMenu, BrowserView, BrowserWindow, PATHS, Utils, type RPCSchema } from "electrobun/main";
import { connectUi, Host } from "@rsage/host";
import type { WireMessage } from "@rsage/shared";

// Bundled Ark lives in the app's Resources; findArk() checks this first.
process.env.RSAGE_ARK_PATH ??= join(PATHS.RESOURCES_FOLDER, "app", "ark", "ark");
process.env.RSAGE_MODULES_PATH ??= join(PATHS.RESOURCES_FOLDER, "app", "modules");
process.env.RSAGE_RPKG_PATH ??= join(PATHS.RESOURCES_FOLDER, "app", "r-packages");

type BridgeRPC = {
  bun: RPCSchema<{ requests: {}; messages: { wire: WireMessage } }>;
  webview: RPCSchema<{ requests: {}; messages: { wire: WireMessage } }>;
};

const host = new Host({
  shell: "electrobun",
  pickFolder: async (_title, startingFolder) => {
    const paths = await Utils.openFileDialog({
      ...(startingFolder ? { startingFolder } : {}),
      canChooseFiles: false,
      canChooseDirectory: true,
      allowsMultipleSelection: false,
    });
    return paths.find(Boolean) ?? null;
  },
  pickFile: async (_title, extensions, startingFolder) => {
    const paths = await Utils.openFileDialog({
      ...(startingFolder ? { startingFolder } : {}),
      canChooseFiles: true,
      canChooseDirectory: false,
      allowsMultipleSelection: false,
      allowedFileTypes: extensions?.length ? extensions.join(",") : "*",
    });
    return paths.find(Boolean) ?? null;
  },
  openExternal: async (path) => {
    // Web pages (sign-in, help) go to the browser; files to their default app.
    if (/^https?:\/\//.test(path)) Utils.openExternal(path);
    else Utils.openPath(path);
  },
});

let send: (m: WireMessage) => void = () => {};
let onMessage: (m: WireMessage) => void = () => {};

const rpc = BrowserView.defineRPC<BridgeRPC>({
  maxRequestTime: 60_000,
  handlers: {
    requests: {},
    messages: { wire: (m: WireMessage) => onMessage(m) },
  },
});

const win = new BrowserWindow({
  title: "R Sage",
  url: "views://mainview/index.html",
  rpc,
  titleBarStyle: "hiddenInset",
  frame: { width: 1440, height: 900, x: 120, y: 80 },
});

send = (m) => (win.webview.rpc as any)?.send?.wire(m);
const conn = connectUi(host, (m) => send(m));
onMessage = conn.onMessage;

// Menu actions are forwarded to the UI's command registry.
const runUiCommand = (id: string) => send({ t: "evt", type: "ui.command", payload: { id } });

ApplicationMenu.setApplicationMenu([
  {
    submenu: [
      { label: "R Sage 정보", role: "about" },
      { type: "divider" },
      { label: "설정…", action: "project.settings", accelerator: "," },
      { type: "divider" },
      { label: "R Sage 숨기기", role: "hide" },
      { role: "hideOthers" },
      { type: "divider" },
      { label: "R Sage 종료", role: "quit", accelerator: "q" },
    ],
  },
  {
    label: "파일",
    submenu: [
      { label: "새 R 스크립트", action: "file.new", accelerator: "n" },
      { label: "새 프로젝트…", action: "project.new" },
      { label: "폴더 열기…", action: "project.open", accelerator: "o" },
      { type: "divider" },
      { label: "저장", action: "file.save", accelerator: "s" },
      { label: "모두 저장", action: "file.saveAll" },
      { label: "파일 닫기", action: "file.close", accelerator: "w" },
      { type: "divider" },
      { label: "프로젝트 닫기", action: "project.close" },
    ],
  },
  {
    label: "편집",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "divider" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
  {
    label: "보기",
    submenu: [
      { label: "명령 팔레트", action: "palette.open" },
      { label: "파일 빠르게 열기", action: "file.quickOpen" },
      { type: "divider" },
      { label: "파일", action: "view.files" },
      { label: "검색", action: "view.search" },
      { label: "소스 제어", action: "view.scm" },
      { label: "터미널", action: "view.terminal" },
      { label: "실행 이력", action: "view.history" },
      { type: "divider" },
      { label: "패널 배치 초기화", action: "view.resetLayout" },
    ],
  },
  {
    label: "R",
    submenu: [
      { label: "R 세션 시작", action: "session.start" },
      { label: "R 세션 재시작", action: "session.restart" },
      { label: "실행 중단", action: "session.interrupt" },
      { label: "R 세션 종료", action: "session.stop" },
      { type: "divider" },
      { label: "현재 파일 source()", action: "r.source" },
      { label: "R 경로 직접 지정…", action: "r.addManual" },
    ],
  },
]);

Electrobun.events.on("application-menu-clicked", (e: any) => {
  const action = e?.data?.action;
  if (typeof action === "string" && action) runUiCommand(action);
});

Electrobun.events.on("before-quit", async () => {
  await host.dispose();
});
