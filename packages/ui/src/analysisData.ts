// Which data an analysis works on. A new analysis starts on the data frame the
// user is working with: the one used in the chunk (or script lines) at the
// cursor, else the one changed most recently in the session. The form shows
// which one was picked and why; the user can always choose another.

import type { AnalysisDataset } from "@rsage/shared";
import { useStore } from "./store";
import { editorsByPath, getModel } from "./editor/files";
import { focusedCells, isVisual, visualEditors } from "./editor/views";
import { useComms } from "./comms";
import { lastUsed } from "./analysisVars";

export interface DatasetPick {
  name: string;
  /** Why this one, shown under the data picker. */
  reason: string;
}

export function suggestDataset(datasets: AnalysisDataset[]): DatasetPick | null {
  if (!datasets.length) return null;
  const names = datasets.map((d) => d.name);
  if (names.length === 1) return { name: names[0]!, reason: "세션에 있는 유일한 데이터 프레임" };
  return datasetAtCursor(names) ?? mostRecentlyChanged(names);
}

// ---------------------------------------------------------------- at the cursor

/** Code near the cursor, nearest first: the current chunk, then the chunks above it. */
interface CursorCode {
  current?: string;
  currentReason: string;
  above: string[];
}

function datasetAtCursor(names: string[]): DatasetPick | null {
  const path = useStore.getState().activeFile;
  if (!path) return null;
  const code = isVisual(path) ? visualCode(path) : sourceCode(path);
  if (!code) return null;
  const file = path.split("/").pop();
  const hit = code.current !== undefined ? lastUsed(code.current, names) : null;
  if (hit) return { name: hit, reason: `${file}의 ${code.currentReason}에서 쓰는 데이터` };
  for (const block of code.above) {
    const n = lastUsed(block, names);
    if (n) return { name: n, reason: `${file}의 커서 위쪽 청크에서 마지막으로 쓴 데이터` };
  }
  return null;
}

const CHUNK_OPEN = /^\s*(`{3,})\s*\{r\b/;

function sourceCode(path: string): CursorCode | null {
  const model = getModel(path);
  const ed = editorsByPath.get(path);
  if (!model) return null;
  const line = ed?.getPosition()?.lineNumber ?? model.getLineCount();
  const lines = model.getLinesContent();
  if (!/\.(qmd|rmd|md)$/i.test(path)) {
    // A script: the lines just above and at the cursor.
    return { current: lines.slice(Math.max(0, line - 60), line).join("\n"), currentReason: "커서 근처 코드", above: [] };
  }
  const chunks: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = CHUNK_OPEN.exec(lines[i]!);
    if (!m) continue;
    const close = new RegExp(`^\\s*${m[1]}\\s*$`);
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j]!)) j++;
    chunks.push({ start: i + 1, end: j + 1, text: lines.slice(i + 1, j).join("\n") });
    i = j;
  }
  const cur = chunks.find((c) => line >= c.start && line <= c.end);
  return {
    current: cur?.text,
    currentReason: "커서가 있는 청크",
    above: chunks.filter((c) => c.end < line).reverse().map((c) => c.text),
  };
}

function visualCode(path: string): CursorCode | null {
  const ve = visualEditors.get(path);
  if (!ve || ve.isDestroyed) return null;
  const cells: { pos: number; cid: string; code: string }[] = [];
  ve.state.doc.forEach((node, pos) => {
    if (node.type.name === "rCell") cells.push({ pos, cid: node.attrs.cid, code: node.attrs.code ?? "" });
  });
  // The chunk the user last typed in or ran; otherwise the text cursor's place.
  const focused = focusedCells.get(path);
  const idx = cells.findIndex((c) => c.cid === focused);
  if (idx >= 0) return { current: cells[idx]!.code, currentReason: "커서가 있는 청크", above: cells.slice(0, idx).reverse().map((c) => c.code) };
  const at = ve.state.selection.from;
  const sel = cells.find((c) => c.pos === at);
  return { current: sel?.code, currentReason: "선택한 청크", above: cells.filter((c) => c.pos < at && c !== sel).reverse().map((c) => c.code) };
}

// ---------------------------------------------------------------- most recent

/** The data frame the console changed last, when the session's variables say so. */
function mostRecentlyChanged(names: string[]): DatasetPick | null {
  const vars = useComms.getState().variables.filter((v) => names.includes(v.display_name));
  if (vars.length < 2) return null;
  const times = vars.map((v) => v.updated_time ?? 0).sort((a, b) => b - a);
  // All listed at once (e.g. right after start) says nothing about which is newest.
  if (times[0]! <= times[1]!) return null;
  const v = vars.find((x) => x.updated_time === times[0])!;
  return { name: v.display_name, reason: "가장 최근에 만들거나 바꾼 데이터 프레임" };
}
