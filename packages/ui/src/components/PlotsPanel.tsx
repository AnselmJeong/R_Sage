// Plot pane, after Positron's: history navigation, save and copy, zoom (Fit,
// 50–200%), sizing policy (Auto, Square, Landscape, Portrait, Fill,
// Intrinsic, custom sizes), a dark filter, the code that drew the plot, and a
// thumbnail history. R re-renders the plot whenever the size it needs changes.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { host } from "../host/client";
import { closedPlots, renderPlot, useComms, type PlotEntry } from "../comms";
import { useStore } from "../store";
import { openFile } from "../editor/files";
import { confirmDialog, formDialog } from "./Dialogs";
import { PlotIcon } from "./plotIcons";
import { SavePlotDialog } from "./SavePlotDialog";
import {
  customPolicy,
  displayScale,
  parseCustom,
  plotSize,
  policyLabel,
  POLICIES,
  ZOOMS,
  type Size,
  type SizingPolicy,
  type Zoom,
} from "../plotSizing";

type HistoryPos = "auto" | "bottom" | "right" | "hidden";
type DarkFilter = "off" | "on";

interface Prefs {
  policy: SizingPolicy;
  zoom: Zoom;
  customSizes: Size[];
  darkFilter: DarkFilter;
  history: HistoryPos;
}

const KEY = "rsage.plots";
const DEFAULTS: Prefs = { policy: "auto", zoom: "fit", customSizes: [], darkFilter: "off", history: "auto" };
export const usePlotPrefs = create<Prefs>(() => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
});
usePlotPrefs.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
});

/** Intrinsic sizes (CSS px) by plot, from Ark (e.g. a Quarto chunk's fig-width). null = none. */
const useIntrinsic = create<Record<string, Size | null>>(() => ({}));

async function fetchIntrinsic(commId: string) {
  if (commId in useIntrinsic.getState() || closedPlots.has(commId)) return;
  useIntrinsic.setState({ [commId]: null });
  try {
    const r = (await host.call("comm.rpc", { commId, method: "get_intrinsic_size" })) as { width: number; height: number; unit: string } | null;
    if (r && r.width > 0 && r.height > 0) {
      const k = r.unit === "inches" ? 96 : 1;
      useIntrinsic.setState({ [commId]: { width: Math.round(r.width * k), height: Math.round(r.height * k) } });
    }
  } catch {}
}

type MenuItem = { label: string; checked?: boolean; disabled?: boolean; hint?: string; run: () => void } | "-";

/** Toolbar button with a dropdown, placed with fixed positioning so the panel doesn't clip it. */
function ToolMenu({ icon, label, title, items, disabled }: { icon: JSX.Element; label?: string; title: string; items: () => MenuItem[]; disabled?: boolean }) {
  const [pos, setPos] = useState<{ x: number; y: number }>();
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pos) return;
    const close = (e: MouseEvent) => !menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node) && setPos(undefined);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPos(undefined);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    window.addEventListener("blur", () => setPos(undefined), { once: true });
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [pos]);
  useLayoutEffect(() => {
    // Keep the menu on screen.
    const m = menu.current;
    if (!m || !pos) return;
    const r = m.getBoundingClientRect();
    if (r.right > window.innerWidth - 4) m.style.left = `${Math.max(4, window.innerWidth - r.width - 4)}px`;
  }, [pos]);
  return (
    <>
      <button
        ref={btn}
        className={`pt-btn ${label ? "pt-labeled" : ""} ${pos ? "active" : ""}`}
        title={title}
        disabled={disabled}
        onClick={() => {
          if (pos) return setPos(undefined);
          const r = btn.current!.getBoundingClientRect();
          setPos({ x: r.left, y: r.bottom + 2 });
        }}
      >
        {icon}
        {label && <span className="pt-label">{label}</span>}
        {PlotIcon.chevron}
      </button>
      {pos &&
        createPortal(
          <div ref={menu} className="context-menu pt-menu" style={{ left: pos.x, top: pos.y }}>
            {items().map((it, i) =>
              it === "-" ? (
                <div key={i} className="tb-sep" />
              ) : (
                <div
                  key={i}
                  className={`pt-item ${it.disabled ? "disabled" : ""}`}
                  onClick={() => {
                    if (it.disabled) return;
                    setPos(undefined);
                    it.run();
                  }}
                >
                  <span className="pt-check">{it.checked ? "✓" : ""}</span>
                  <span className="ellipsis">{it.label}</span>
                  {it.hint && <span className="muted small pt-hint">{it.hint}</span>}
                </div>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

function ToolButton({ icon, title, onClick, disabled }: { icon: JSX.Element; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="pt-btn" title={title} onClick={onClick} disabled={disabled}>
      {icon}
    </button>
  );
}

export function PlotsPanel() {
  const plots = useComms((s) => s.plots);
  const currentId = useComms((s) => s.currentPlot);
  const current = plots.find((p) => p.commId === currentId) ?? plots[plots.length - 1];
  const idx = current ? plots.indexOf(current) : -1;
  const prefs = usePlotPrefs();
  const intrinsic = useIntrinsic((s) => (current ? s[current.commId] : undefined)) ?? undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>();
  const [panel, setPanel] = useState<Size>();
  const [saving, setSaving] = useState<PlotEntry>();

  // Track the stage (for sizing) and the whole pane (for the history layout).
  useEffect(() => {
    const stage = stageRef.current;
    const root = rootRef.current;
    if (!stage || !root) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const cs = getComputedStyle(stage);
        const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        setViewport({ width: Math.floor(stage.clientWidth - padX), height: Math.floor(stage.clientHeight - padY) });
        setPanel({ width: root.clientWidth, height: root.clientHeight });
      }, 120);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    ro.observe(root);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    void fetchIntrinsic(current.commId);
    rootRef.current?.querySelector(".plot-thumb.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current?.commId]);

  const size = viewport && plotSize(prefs.policy, viewport, intrinsic);
  const scale = size && viewport ? displayScale(prefs.zoom, size, viewport) : 1;
  const dpr = window.devicePixelRatio || 1;
  const pixelRatio = Math.min(4, dpr * Math.max(1, scale));
  // The image on screen may be an older render at another size (R can't draw
  // into a tiny pane, for one), so scale what is actually shown.
  const shownScale = current?.size && viewport ? displayScale(prefs.zoom, current.size, viewport) : scale;

  // Re-render the current plot at the size the policy asks for (and after R redraws it).
  useEffect(() => {
    if (!current || !size || viewport!.width < 30 || viewport!.height < 30 || closedPlots.has(current.commId)) return;
    const have = current.size;
    if (have && have.width === size.width && have.height === size.height && (current.pixelRatio ?? 0) >= pixelRatio && current.renderedVersion === current.version) return;
    let cancelled = false;
    renderPlot(current.commId, size, "png", pixelRatio)
      .then((r) => {
        if (cancelled) return;
        useComms.setState((s) => ({
          plots: s.plots.map((p) =>
            p.commId === current.commId ? { ...p, image: `data:${r.mime_type};base64,${r.data}`, size, pixelRatio, renderedVersion: current.version } : p,
          ),
        }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [current?.commId, current?.version, size?.width, size?.height, pixelRatio]);

  const go = (d: number) => {
    const p = plots[idx + d];
    if (p) useComms.setState({ currentPlot: p.commId });
  };

  const remove = (p: PlotEntry) => {
    if (!closedPlots.has(p.commId)) void host.call("comm.close", { commId: p.commId }).catch(() => {});
    useComms.setState((s) => {
      const i = s.plots.findIndex((x) => x.commId === p.commId);
      const rest = s.plots.filter((x) => x.commId !== p.commId);
      const cur = s.currentPlot === p.commId ? rest[Math.min(i, rest.length - 1)]?.commId : s.currentPlot;
      return { plots: rest, currentPlot: cur };
    });
  };

  const clearAll = async () => {
    if (!plots.length) return;
    const ok = await confirmDialog({ title: "모든 플롯 지우기", message: `플롯 ${plots.length}개를 모두 지울까요?`, confirm: "지우기", danger: true });
    if (!ok) return;
    for (const p of plots) if (!closedPlots.has(p.commId)) void host.call("comm.close", { commId: p.commId }).catch(() => {});
    useComms.setState({ plots: [], currentPlot: undefined });
  };

  const copy = async () => {
    if (!current?.image) return;
    try {
      const blob = await (await fetch(current.image)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      useStore.getState().notify("플롯을 클립보드에 복사했습니다.");
    } catch (e: any) {
      useStore.getState().notify(`복사 실패: ${e.message}`, "error");
    }
  };

  const newCustomSize = async () => {
    const base = size ?? { width: 800, height: 600 };
    const v = await formDialog({
      title: "새 사용자 지정 크기",
      message: "플롯을 그릴 크기 (픽셀, 96픽셀 = 1인치)",
      fields: [
        { key: "w", label: "너비", value: String(base.width), required: true },
        { key: "h", label: "높이", value: String(base.height), required: true },
      ],
      confirm: "추가",
    });
    if (!v) return;
    const w = Math.round(Number(v.w));
    const h = Math.round(Number(v.h));
    if (!(w >= 50 && h >= 50 && w <= 10000 && h <= 10000)) {
      useStore.getState().notify("너비와 높이는 50에서 10000 사이의 숫자여야 합니다.", "error");
      return;
    }
    const s = { width: w, height: h };
    usePlotPrefs.setState((p) => ({
      policy: customPolicy(s),
      customSizes: [s, ...p.customSizes.filter((c) => c.width !== w || c.height !== h)].slice(0, 6),
    }));
  };

  const exec = current?.executionId ? useStore.getState().executions[current.executionId] : undefined;
  const code = exec?.code;

  const historyPos: Exclude<HistoryPos, "auto"> =
    prefs.history === "auto" ? (panel && panel.width > panel.height * 1.4 ? "right" : "bottom") : prefs.history;
  const showHistory = plots.length > 1 && historyPos !== "hidden";
  const set = (p: Partial<Prefs>) => usePlotPrefs.setState(p);
  const isCustom = !!parseCustom(prefs.policy);
  const zoomLabel = ZOOMS.find((z) => z.value === prefs.zoom)?.label ?? "맞춤";

  return (
    <div className={`plots history-${showHistory ? historyPos : "none"}`} ref={rootRef}>
      <div className="plot-toolbar">
        <ToolButton icon={PlotIcon.back} title="이전 플롯" disabled={idx <= 0} onClick={() => go(-1)} />
        <ToolButton icon={PlotIcon.forward} title="다음 플롯" disabled={idx < 0 || idx >= plots.length - 1} onClick={() => go(1)} />
        <span className="pt-sep" />
        <ToolButton icon={PlotIcon.save} title="플롯 저장…" disabled={!current} onClick={() => current && setSaving(current)} />
        <ToolButton icon={PlotIcon.copy} title="클립보드에 복사" disabled={!current?.image} onClick={copy} />
        <span className="pt-sep" />
        <ToolMenu
          icon={PlotIcon.zoom}
          label={zoomLabel}
          title="확대/축소"
          items={() => ZOOMS.map((z) => ({ label: z.label, checked: prefs.zoom === z.value, run: () => set({ zoom: z.value }) }))}
        />
        <ToolMenu
          icon={PlotIcon.size}
          label={policyLabel(prefs.policy === "intrinsic" && !intrinsic ? "auto" : prefs.policy)}
          title="플롯 크기"
          items={() => [
            ...POLICIES.map((p) => ({
              label: p.label,
              checked: prefs.policy === p.value,
              disabled: p.value === "intrinsic" && !intrinsic,
              hint: p.value === "intrinsic" && intrinsic ? `${intrinsic.width}×${intrinsic.height}` : undefined,
              run: () => set({ policy: p.value }),
            })),
            ...(prefs.customSizes.length ? (["-"] as MenuItem[]) : []),
            ...prefs.customSizes.map((c) => ({
              label: `${c.width} × ${c.height}`,
              checked: prefs.policy === customPolicy(c),
              hint: `${(c.width / 96).toFixed(1)}×${(c.height / 96).toFixed(1)} in`,
              run: () => set({ policy: customPolicy(c) }),
            })),
            "-",
            { label: "새 사용자 지정 크기…", run: newCustomSize },
            ...(isCustom
              ? [
                  {
                    label: "이 사용자 지정 크기 삭제",
                    run: () =>
                      usePlotPrefs.setState((p) => ({
                        policy: "auto",
                        customSizes: p.customSizes.filter((c) => customPolicy(c) !== p.policy),
                      })),
                  },
                ]
              : []),
          ]}
        />
        <ToolMenu
          icon={PlotIcon.filter}
          title="다크 필터"
          items={() => [
            { label: "다크 필터 끄기", checked: prefs.darkFilter === "off", run: () => set({ darkFilter: "off" }) },
            { label: "다크 필터 켜기 (어두운 테마에 맞춰 색 반전)", checked: prefs.darkFilter === "on", run: () => set({ darkFilter: "on" }) },
          ]}
        />
        <ToolMenu
          icon={PlotIcon.code}
          title="플롯을 만든 코드"
          disabled={!code}
          items={() => [
            {
              label: exec?.source ? `원본 열기 (${exec.source.file.split("/").pop()}:${exec.source.line})` : "원본 열기",
              disabled: !exec?.source,
              run: () => exec?.source && openFile(exec.source.file, { line: exec.source.line }),
            },
            { label: "코드 다시 실행", run: () => code && void host.call("console.execute", { code, origin: "console" }) },
            {
              label: "코드 복사",
              run: () => code && void navigator.clipboard.writeText(code).then(() => useStore.getState().notify("코드를 복사했습니다.")),
            },
          ]}
        />
        <span className="spacer" />
        {current && size && (
          <span className="pt-info muted small" title="R이 그리는 크기">
            {size.width}×{size.height}
            {plots.length > 1 ? ` · ${idx + 1}/${plots.length}` : ""}
          </span>
        )}
        <ToolMenu
          icon={PlotIcon.history}
          title="플롯 기록 위치"
          items={() =>
            (
              [
                ["auto", "자동"],
                ["bottom", "아래"],
                ["right", "오른쪽"],
                ["hidden", "숨김"],
              ] as [HistoryPos, string][]
            ).map(([v, l]) => ({ label: `기록: ${l}`, checked: prefs.history === v, run: () => set({ history: v }) }))
          }
        />
        <ToolButton icon={PlotIcon.close} title="이 플롯 지우기" disabled={!current} onClick={() => current && remove(current)} />
        <ToolButton icon={PlotIcon.clear} title="모든 플롯 지우기" disabled={!plots.length} onClick={clearAll} />
      </div>
      <div className="plot-body">
        <div className={`plot-stage ${prefs.zoom === "fit" ? "fit" : "zoomed"}`} ref={stageRef}>
          {current?.image && current.size ? (
            <img
              className={`plot-img ${prefs.darkFilter === "on" ? "dark-filter" : ""}`}
              src={current.image}
              alt="R plot"
              draggable={false}
              style={{ width: current.size.width * shownScale, height: current.size.height * shownScale }}
            />
          ) : current?.image ? (
            <img className="plot-img" src={current.image} alt="R plot" draggable={false} style={{ maxWidth: "100%", maxHeight: "100%" }} />
          ) : (
            <div className="plot-empty">
              {PlotIcon.size}
              <span>R에서 플롯을 그리면 여기에 표시됩니다.</span>
            </div>
          )}
        </div>
        {showHistory && (
          <div className="plot-history">
            {plots.map((p, i) => (
              <div
                key={p.commId}
                className={`plot-thumb ${p.commId === current?.commId ? "active" : ""}`}
                title={`플롯 ${i + 1}`}
                onClick={() => useComms.setState({ currentPlot: p.commId })}
              >
                {p.image ? <img src={p.image} alt="" className={prefs.darkFilter === "on" ? "dark-filter" : ""} /> : <span className="muted">…</span>}
                <button
                  className="plot-thumb-close"
                  title="이 플롯 지우기"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(p);
                  }}
                >
                  {PlotIcon.close}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {saving && <SavePlotDialog plot={saving} initialSize={saving.size ?? size ?? { width: 800, height: 600 }} onClose={() => setSaving(undefined)} />}
    </div>
  );
}
