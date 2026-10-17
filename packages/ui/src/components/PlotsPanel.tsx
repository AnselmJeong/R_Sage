import { useEffect, useRef, useState } from "react";
import { host } from "../host/client";
import { closedPlots, renderPlot, useComms, type PlotEntry } from "../comms";
import { useStore } from "../store";
import { openFile } from "../editor/files";
import { promptDialog } from "./Dialogs";

type Format = "png" | "svg" | "pdf" | "jpeg";

/** Plot pane: the current plot fitted to the panel, history strip, export and copy. */
export function PlotsPanel() {
  const plots = useComms((s) => s.plots);
  const currentId = useComms((s) => s.currentPlot);
  const current = plots.find((p) => p.commId === currentId) ?? plots[plots.length - 1];
  const idx = current ? plots.indexOf(current) : -1;
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; height: number }>();
  const [format, setFormat] = useState<Format>("png");

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(([e]) => {
      clearTimeout(t);
      t = setTimeout(() => setBox({ width: e!.contentRect.width, height: e!.contentRect.height }), 150);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, []);

  // Re-render the current plot at the panel's size (and after R redraws it).
  useEffect(() => {
    if (!current || !box || box.width < 50 || box.height < 50 || closedPlots.has(current.commId)) return;
    let cancelled = false;
    renderPlot(current.commId, box)
      .then((r) => {
        if (cancelled) return;
        useComms.setState((s) => ({
          plots: s.plots.map((p) => (p.commId === current.commId ? { ...p, image: `data:${r.mime_type};base64,${r.data}`, size: box } : p)),
        }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [current?.commId, current?.version, box?.width, box?.height]);

  const go = (d: number) => {
    const p = plots[idx + d];
    if (p) useComms.setState({ currentPlot: p.commId });
  };

  const remove = (p: PlotEntry) => {
    if (!closedPlots.has(p.commId)) void host.call("comm.close", { commId: p.commId }).catch(() => {});
    useComms.setState((s) => {
      const rest = s.plots.filter((x) => x.commId !== p.commId);
      return { plots: rest, currentPlot: rest[Math.min(idx, rest.length - 1)]?.commId };
    });
  };

  const clearAll = () => {
    for (const p of plots) if (!closedPlots.has(p.commId)) void host.call("comm.close", { commId: p.commId }).catch(() => {});
    useComms.setState({ plots: [], currentPlot: undefined });
  };

  const exportPlot = async () => {
    if (!current) return;
    const root = useStore.getState().project?.path;
    if (!root) return;
    const size = box ?? current.size ?? { width: 800, height: 600 };
    const name = await promptDialog({
      title: "플롯 내보내기",
      message: `${format.toUpperCase()} · ${Math.round(size.width)}×${Math.round(size.height)} (프로젝트 기준 경로)`,
      value: `figures/plot-${idx + 1}.${format}`,
      selectBaseName: true,
      confirm: "저장",
    });
    if (!name) return;
    try {
      let data: string;
      if (closedPlots.has(current.commId)) {
        if (format !== "png" || !current.image) throw new Error("세션이 바뀐 플롯은 PNG로만 저장할 수 있습니다.");
        data = current.image.split(",")[1]!;
      } else {
        // Vector formats are sized in inches by the device; use 1x for them.
        data = (await renderPlot(current.commId, size, format, format === "png" || format === "jpeg" ? 2 : 1)).data;
      }
      const path = `${root}/${name}`;
      const dir = path.slice(0, path.lastIndexOf("/"));
      if (dir !== root) await host.call("fs.create", { path: dir, kind: "dir" }).catch(() => {});
      await host.call("fs.writeBase64", { path, data });
      useStore.getState().notify(`저장함: ${name}`);
    } catch (e: any) {
      useStore.getState().notify(e.message, "error");
    }
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

  const exec = current?.executionId ? useStore.getState().executions[current.executionId] : undefined;

  return (
    <div className="plots">
      <div className="panel-toolbar">
        <button className="btn btn-small" disabled={idx <= 0} onClick={() => go(-1)} title="이전 플롯">
          ‹
        </button>
        <span className="muted small">{plots.length ? `${idx + 1} / ${plots.length}` : "0"}</span>
        <button className="btn btn-small" disabled={idx < 0 || idx >= plots.length - 1} onClick={() => go(1)} title="다음 플롯">
          ›
        </button>
        <span className="spacer" />
        <select className="select-small" value={format} onChange={(e) => setFormat(e.target.value as Format)}>
          <option value="png">PNG</option>
          <option value="svg">SVG</option>
          <option value="pdf">PDF</option>
          <option value="jpeg">JPEG</option>
        </select>
        <button className="btn btn-small" disabled={!current} onClick={exportPlot}>
          내보내기
        </button>
        <button className="btn btn-small" disabled={!current?.image} onClick={copy}>
          복사
        </button>
        <button className="btn btn-small" disabled={!current} onClick={() => current && remove(current)} title="이 플롯 삭제">
          삭제
        </button>
        <button className="btn btn-small" disabled={!plots.length} onClick={clearAll} title="모든 플롯 삭제">
          모두
        </button>
      </div>
      <div className="plot-stage" ref={boxRef}>
        {current?.image ? (
          <img className="plot-img" src={current.image} alt="R plot" draggable={false} />
        ) : (
          <div className="empty">플롯을 그리면 여기에 표시됩니다.</div>
        )}
      </div>
      {exec && (
        <div className="plot-source" title={exec.code}>
          <span className="muted">만든 코드</span>
          {exec.source ? (
            <button className="c-srclink" onClick={() => openFile(exec.source!.file, { line: exec.source!.line })}>
              {exec.source.file.split("/").pop()}:{exec.source.line}
            </button>
          ) : null}
          <code className="ellipsis">{exec.code.split("\n")[0]}</code>
        </div>
      )}
      {plots.length > 1 && (
        <div className="plot-strip">
          {plots.map((p) => (
            <button
              key={p.commId}
              className={`plot-thumb ${p.commId === current?.commId ? "active" : ""}`}
              onClick={() => useComms.setState({ currentPlot: p.commId })}
            >
              {p.image ? <img src={p.image} alt="" /> : <span className="muted">…</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
