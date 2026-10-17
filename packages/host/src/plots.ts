// Plot export: re-render a plot in R at a physical size and resolution and
// write it to disk, like Positron's Save Plot dialog.
//
// Ark sizes plots in "logical pixels" at its default DPI (96 on macOS, 72
// elsewhere): a plot of width w is w / base inches wide. Raster formats are
// drawn at w * pixel_ratio pixels with res = base * pixel_ratio, so for a
// target DPI d we send w = inches * base and pixel_ratio = d / base. Vector
// formats ignore res and take pixel_ratio = 1.

import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { PlotExportFormat } from "@rsage/shared";
import type { CommManager } from "./comms";

/** Mirrors DEFAULT_DPI in Ark's graphics_device.rs. */
export const ARK_BASE_DPI = process.platform === "darwin" ? 96 : 72;

export const RASTER_FORMATS: PlotExportFormat[] = ["png", "jpeg", "tiff"];

export interface PlotSaveRequest {
  commId?: string;
  /** Absolute path of the file to write. */
  path: string;
  format: PlotExportFormat;
  widthIn: number;
  heightIn: number;
  /** Raster formats only. */
  dpi?: number;
  /** Already-rendered image (base64) for plots whose comm is gone. */
  data?: string;
  overwrite?: boolean;
}

export function renderParams(format: PlotExportFormat, widthIn: number, heightIn: number, dpi = 300) {
  const raster = RASTER_FORMATS.includes(format);
  const pixelRatio = raster ? Math.max(0.1, dpi) / ARK_BASE_DPI : 1;
  return {
    size: { width: Math.max(1, Math.round(widthIn * ARK_BASE_DPI)), height: Math.max(1, Math.round(heightIn * ARK_BASE_DPI)) },
    pixel_ratio: pixelRatio,
    format,
  };
}

export async function savePlot(comms: CommManager, req: PlotSaveRequest): Promise<{ ok: true; path: string } | { ok: false; exists: true }> {
  if (!isAbsolute(req.path)) throw new Error("저장 경로는 절대 경로여야 합니다.");
  const path = resolve(req.path);
  if (!req.overwrite && existsSync(path)) return { ok: false, exists: true };
  let data = req.data;
  if (!data) {
    if (!req.commId) throw new Error("플롯이 없습니다.");
    if (!(req.widthIn > 0 && req.heightIn > 0)) throw new Error("너비와 높이는 0보다 커야 합니다.");
    const r = (await comms.rpc(req.commId, "render", renderParams(req.format, req.widthIn, req.heightIn, req.dpi))) as { data: string };
    data = r.data;
  }
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, Buffer.from(data, "base64"));
  return { ok: true, path };
}
