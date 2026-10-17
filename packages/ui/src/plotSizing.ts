// Plot sizing policies and zoom for the plot pane, after Positron's
// (Auto, Square, Landscape, Portrait, Fill, Intrinsic, custom sizes).
// Sizes are CSS pixels; R renders 96 of them per inch on macOS.

export interface Size {
  width: number;
  height: number;
}

export type SizingPolicy = "auto" | "square" | "landscape" | "portrait" | "fill" | "intrinsic" | `custom:${number}x${number}`;
export type Zoom = "fit" | 0.5 | 0.75 | 1 | 2;

export const ZOOMS: { value: Zoom; label: string }[] = [
  { value: "fit", label: "맞춤" },
  { value: 0.5, label: "50%" },
  { value: 0.75, label: "75%" },
  { value: 1, label: "100%" },
  { value: 2, label: "200%" },
];

export const POLICIES: { value: SizingPolicy; label: string }[] = [
  { value: "auto", label: "자동" },
  { value: "square", label: "정사각형" },
  { value: "landscape", label: "가로 (4:3)" },
  { value: "portrait", label: "세로 (3:4)" },
  { value: "fill", label: "채우기" },
  { value: "intrinsic", label: "원래 크기" },
];

const GOLDEN = 1.618;
const MIN = 50;

export const customPolicy = (s: Size): SizingPolicy => `custom:${Math.round(s.width)}x${Math.round(s.height)}`;

export function parseCustom(p: SizingPolicy): Size | undefined {
  const m = /^custom:(\d+)x(\d+)$/.exec(p);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
}

export function policyLabel(p: SizingPolicy): string {
  const c = parseCustom(p);
  if (c) return `${c.width}×${c.height}`;
  return POLICIES.find((x) => x.value === p)?.label ?? p;
}

/** Largest box of the given aspect ratio (width / height) inside the viewport. */
function fitAspect(v: Size, aspect: number): Size {
  return v.width / v.height > aspect ? { width: v.height * aspect, height: v.height } : { width: v.width, height: v.width / aspect };
}

/**
 * The size R should draw the plot at for a viewport. Auto fills the pane but
 * keeps the aspect ratio between 1:1.618 and 1.618:1, so a very wide or very
 * tall pane doesn't stretch the plot. Intrinsic falls back to auto when the
 * plot has no intrinsic size.
 */
export function plotSize(policy: SizingPolicy, viewport: Size, intrinsic?: Size): Size {
  const v = { width: Math.max(MIN, viewport.width), height: Math.max(MIN, viewport.height) };
  let s: Size;
  const custom = parseCustom(policy);
  if (custom) s = custom;
  else if (policy === "intrinsic" && intrinsic) s = intrinsic;
  else if (policy === "square") s = fitAspect(v, 1);
  else if (policy === "landscape") s = fitAspect(v, 4 / 3);
  else if (policy === "portrait") s = fitAspect(v, 3 / 4);
  else if (policy === "fill") s = v;
  else {
    const r = v.width / v.height;
    s = r > GOLDEN ? fitAspect(v, GOLDEN) : r < 1 / GOLDEN ? fitAspect(v, 1 / GOLDEN) : v;
  }
  return { width: Math.max(MIN, Math.round(s.width)), height: Math.max(MIN, Math.round(s.height)) };
}

/** How much the rendered plot is scaled on screen. Fit only ever shrinks. */
export function displayScale(zoom: Zoom, plot: Size, viewport: Size): number {
  if (zoom !== "fit") return zoom;
  return Math.min(1, viewport.width / plot.width, viewport.height / plot.height);
}

// ---- export units ----

export type Unit = "px" | "in" | "cm";
const PER_INCH: Record<Unit, number> = { px: 96, in: 1, cm: 2.54 };

export function toInches(v: number, unit: Unit): number {
  return v / PER_INCH[unit];
}
export function fromInches(v: number, unit: Unit): number {
  return v * PER_INCH[unit];
}
/** Round for display in an input: whole pixels, two decimals otherwise. */
export function roundUnit(v: number, unit: Unit): number {
  return unit === "px" ? Math.round(v) : Math.round(v * 100) / 100;
}

export const RASTER = ["png", "jpeg", "tiff"] as const;
export const isRaster = (f: string) => (RASTER as readonly string[]).includes(f);

/** "my plot 1" → "my-plot-1", safe as a file name on macOS. */
export function fileStem(name: string): string {
  const s = name
    .trim()
    .replace(/[\/\\:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "plot";
}
