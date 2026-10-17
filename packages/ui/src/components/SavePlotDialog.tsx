// Save Plot dialog, after Positron's: folder, name, format, size and
// resolution, with a live preview. R re-renders the plot at the chosen size;
// raster formats (PNG, JPEG, TIFF) also take a DPI.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { PlotExportFormat } from "@rsage/shared";
import { host } from "../host/client";
import { closedPlots, useComms, type PlotEntry } from "../comms";
import { useStore } from "../store";
import { confirmDialog } from "./Dialogs";
import { pickFolder } from "./FolderPicker";
import { fileStem, fromInches, isRaster, roundUnit, toInches, type Size, type Unit } from "../plotSizing";

const FORMATS: { value: PlotExportFormat; label: string; ext: string }[] = [
  { value: "png", label: "PNG", ext: "png" },
  { value: "jpeg", label: "JPEG", ext: "jpg" },
  { value: "tiff", label: "TIFF", ext: "tiff" },
  { value: "svg", label: "SVG", ext: "svg" },
  { value: "pdf", label: "PDF", ext: "pdf" },
];
const DPI_PRESETS = [72, 96, 150, 300, 600];

interface Saved {
  dir?: string;
  format: PlotExportFormat;
  unit: Unit;
  dpi: number;
  lock: boolean;
  /** Last size, in inches; reused when the unit is inches or cm. */
  size?: { w: number; h: number };
}
const KEY = "rsage.plotExport";
function loadSaved(): Saved {
  const d: Saved = { format: "png", unit: "px", dpi: 300, lock: true };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return d;
  }
}

export function SavePlotDialog({ plot, initialSize, onClose }: { plot: PlotEntry; initialSize: Size; onClose: () => void }) {
  const saved = useMemo(loadSaved, []);
  const closed = closedPlots.has(plot.commId);
  const project = useStore((s) => s.project?.path);
  const [dir, setDir] = useState(saved.dir ?? project ?? "");
  const [name, setName] = useState(() => `plot-${useComms.getState().plots.findIndex((p) => p.commId === plot.commId) + 1}`);
  const [format, setFormat] = useState<PlotExportFormat>(closed ? "png" : saved.format);
  const [unit, setUnit] = useState<Unit>(saved.unit);
  // The size is kept in inches; inputs show it in the chosen unit.
  // A physical unit means the user picked a print size: start from the last one.
  const [inches, setInches] = useState(() =>
    saved.unit !== "px" && saved.size && !closed ? saved.size : { w: toInches(initialSize.width, "px"), h: toInches(initialSize.height, "px") },
  );
  const [text, setText] = useState({ w: "", h: "" });
  const [dpi, setDpi] = useState(String(saved.dpi));
  const [lock, setLock] = useState(saved.lock);
  const [preview, setPreview] = useState<{ src?: string; error?: string; busy?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const raster = isRaster(format);
  const dpiNum = Number(dpi);
  const dpiOk = !raster || (dpiNum >= 10 && dpiNum <= 2400);
  const sizeOk = inches.w > 0.1 && inches.h > 0.1 && inches.w < 200 && inches.h < 200;

  // Use R's own name for the plot (e.g. "ggplot2 box plot 1") when it has one.
  useEffect(() => {
    if (closed) return;
    host
      .call("comm.rpc", { commId: plot.commId, method: "get_metadata" })
      .then((m: any) => m?.name && m.name !== "plot" && setName(fileStem(m.name)))
      .catch(() => {});
  }, [plot.commId]);

  useEffect(() => {
    setText({ w: String(roundUnit(fromInches(inches.w, unit), unit)), h: String(roundUnit(fromInches(inches.h, unit), unit)) });
  }, [unit]);

  const editSize = (k: "w" | "h", v: string) => {
    const n = Number(v);
    const next = { ...text, [k]: v };
    if (n > 0) {
      const inch = toInches(n, unit);
      const ratio = inches.h / inches.w;
      const ni = k === "w" ? { w: inch, h: lock ? inch * ratio : inches.h } : { w: lock ? inch / ratio : inches.w, h: inch };
      if (lock) {
        const other = k === "w" ? "h" : "w";
        next[other] = String(roundUnit(fromInches(ni[other], unit), unit));
      }
      setInches(ni);
    }
    setText(next);
  };

  // Live preview at the chosen size, debounced.
  useEffect(() => {
    if (closed) {
      setPreview({ src: plot.image });
      return;
    }
    if (!sizeOk) return;
    let cancelled = false;
    setPreview((p) => ({ ...p, busy: true }));
    const t = setTimeout(async () => {
      try {
        const dpiPreview = Math.min(192, 1400 / Math.max(inches.w, inches.h));
        const r = await host.call("plot.render", { commId: plot.commId, format: "png", widthIn: inches.w, heightIn: inches.h, dpi: dpiPreview });
        if (!cancelled) setPreview({ src: `data:${r.mime_type};base64,${r.data}` });
      } catch (e: any) {
        if (!cancelled) setPreview({ error: e.message });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [inches.w, inches.h, plot.commId]);

  const ext = FORMATS.find((f) => f.value === format)!.ext;
  const stem = name.trim().replace(new RegExp(`\\.(${FORMATS.map((f) => f.ext).join("|")}|jpeg|tif)$`, "i"), "");
  const path = `${dir.replace(/\/+$/, "")}/${stem}.${ext}`;
  const pxW = Math.round(inches.w * dpiNum);
  const pxH = Math.round(inches.h * dpiNum);
  const summary = raster
    ? `${pxW} × ${pxH} 픽셀 · ${dpiNum || "?"} DPI · ${inches.w.toFixed(2)} × ${inches.h.toFixed(2)} in`
    : `${inches.w.toFixed(2)} × ${inches.h.toFixed(2)} in (${(inches.w * 2.54).toFixed(1)} × ${(inches.h * 2.54).toFixed(1)} cm) · 벡터`;
  const canSave = !!dir && !!stem && sizeOk && dpiOk && !busy && dir.startsWith("/");

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const params = {
        commId: closed ? undefined : plot.commId,
        data: closed ? plot.image?.split(",")[1] : undefined,
        path,
        format,
        widthIn: inches.w,
        heightIn: inches.h,
        dpi: raster ? dpiNum : undefined,
      };
      let r = await host.call("plot.save", params);
      if (!r.ok) {
        const ok = await confirmDialog({ title: "파일 덮어쓰기", message: `${stem}.${ext} 파일이 이미 있습니다. 바꿀까요?`, confirm: "바꾸기", danger: true });
        if (!ok) return;
        r = await host.call("plot.save", { ...params, overwrite: true });
      }
      try {
        localStorage.setItem(KEY, JSON.stringify({ dir, format, unit, dpi: dpiNum || 300, lock, size: inches } satisfies Saved));
      } catch {}
      const shown = project && path.startsWith(project + "/") ? path.slice(project.length + 1) : path;
      useStore.getState().notify(`플롯을 저장했습니다: ${shown}`);
      onClose();
    } catch (e: any) {
      useStore.getState().notify(`저장 실패: ${e.message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog save-plot"
        role="dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && !e.nativeEvent.isComposing && (e.target as HTMLElement).tagName === "INPUT") void save();
        }}
      >
        <h3>플롯 저장</h3>
        <div className="sp-grid">
          <label className="sp-wide">
            <span>폴더</span>
            <div className="row">
              <input className="text-input" value={dir} onChange={(e) => setDir(e.target.value)} spellCheck={false} />
              <button
                className="btn"
                onClick={async () => {
                  const p = await pickFolder("플롯을 저장할 폴더", true, dir || undefined);
                  if (p) setDir(p);
                }}
              >
                찾아보기…
              </button>
            </div>
          </label>
          <label className="sp-name">
            <span>이름</span>
            <div className="sp-suffix">
              <input className="text-input" value={name} autoFocus onChange={(e) => setName(e.target.value)} spellCheck={false} />
              <span className="muted">.{ext}</span>
            </div>
          </label>
          <label>
            <span>형식</span>
            <select className="text-input" value={format} disabled={closed} onChange={(e) => setFormat(e.target.value as PlotExportFormat)}>
              {FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>너비</span>
            <input className="text-input" inputMode="decimal" value={text.w} disabled={closed} onChange={(e) => editSize("w", e.target.value)} />
          </label>
          <button
            className={`sp-lock ${lock ? "on" : ""}`}
            title={lock ? "비율 고정됨" : "비율 고정 안 함"}
            disabled={closed}
            onClick={() => setLock(!lock)}
          >
            <svg viewBox="0 0 16 16">
              {lock ? (
                <path d="M6.5 9.5 9.5 6.5M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1" />
              ) : (
                <path d="M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1" />
              )}
            </svg>
          </button>
          <label>
            <span>높이</span>
            <input className="text-input" inputMode="decimal" value={text.h} disabled={closed} onChange={(e) => editSize("h", e.target.value)} />
          </label>
          <label>
            <span>단위</span>
            <select className="text-input" value={unit} disabled={closed} onChange={(e) => setUnit(e.target.value as Unit)}>
              <option value="px">픽셀</option>
              <option value="in">인치</option>
              <option value="cm">cm</option>
            </select>
          </label>
          <label className={raster ? "" : "sp-disabled"}>
            <span>해상도 (DPI)</span>
            <input className="text-input" list="sp-dpi" inputMode="numeric" value={raster ? dpi : "—"} disabled={!raster || closed} onChange={(e) => setDpi(e.target.value)} />
            <datalist id="sp-dpi">
              {DPI_PRESETS.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
        </div>
        <div className={`sp-summary small ${dpiOk && sizeOk ? "muted" : "sp-error"}`}>
          {closed
            ? "세션이 다시 시작되어 R이 이 플롯을 다시 그릴 수 없습니다. 화면의 이미지를 PNG로 저장합니다."
            : !sizeOk
              ? "너비와 높이를 확인하세요."
              : !dpiOk
                ? "DPI는 10에서 2400 사이여야 합니다."
                : `저장될 파일: ${summary}`}
        </div>
        <div className="sp-preview">
          {preview.src ? <img src={preview.src} alt="미리보기" className={preview.busy ? "stale" : ""} /> : null}
          {preview.error && <span className="sp-error small">{preview.error}</span>}
          {!preview.src && !preview.error && <span className="muted small">미리보기를 만드는 중…</span>}
        </div>
        <div className="dialog-actions">
          <span className="muted small sp-path" title={path}>
            <bdi>{path}</bdi>
          </span>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn btn-primary" disabled={!canSave} onClick={save}>
            {busy ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
