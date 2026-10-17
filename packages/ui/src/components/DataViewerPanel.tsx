import { useCallback, useEffect, useRef, useState } from "react";
import type { IDockviewPanelProps } from "dockview";
import { rpc, useComms } from "../comms";
import { useStore } from "../store";

// Data explorer comm (Ark's DataExplorerBackendRequest). Rows are fetched
// in blocks as the grid scrolls, so large data frames stay responsive.

const ROW_H = 24;
const BLOCK = 200;
const MAX_COLS = 500;
const FORMAT = { large_num_digits: 2, small_num_digits: 4, max_integral_digits: 7, max_value_length: 1000, thousands_sep: "" };

interface Column {
  column_name: string;
  column_index: number;
  type_display: string;
}
interface TableState {
  display_name: string;
  table_shape: { num_rows: number; num_columns: number };
  table_unfiltered_shape: { num_rows: number; num_columns: number };
  has_row_labels: boolean;
}
interface SortKey {
  column_index: number;
  ascending: boolean;
}

/** Ark encodes missing values as numeric codes instead of strings. */
const special = (v: unknown) => (typeof v === "string" ? v : v === 0 ? "NULL" : v === 1 ? "NA" : v === 2 ? "NaN" : v === 3 ? "NaT" : v === 4 ? "None" : v === 10 ? "Inf" : v === 11 ? "-Inf" : "?");

export function DataViewerPanel(props: IDockviewPanelProps<{ commId: string }>) {
  const commId = props.params.commId;
  const version = useComms((s) => s.dataViewers[commId]?.version ?? -1);
  const alive = version >= 0;
  const [state, setState] = useState<TableState>();
  const [columns, setColumns] = useState<Column[]>([]);
  const [sort, setSort] = useState<SortKey | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const blocks = useRef(new Map<number, { cells: unknown[][]; labels?: string[] }>());
  const loading = useRef(new Set<number>());
  const [, bump] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  const reset = useCallback(async () => {
    blocks.current.clear();
    loading.current.clear();
    try {
      const st = await rpc<TableState>(commId, "get_state");
      const n = Math.min(st.table_shape.num_columns, MAX_COLS);
      const schema = await rpc<{ columns: Column[] }>(commId, "get_schema", { column_indices: [...Array(n).keys()] });
      setState(st);
      setColumns(schema.columns);
      bump((x) => x + 1);
    } catch (e: any) {
      useStore.getState().notify(e.message, "error");
    }
  }, [commId]);

  useEffect(() => {
    if (alive) void reset();
  }, [alive, version, reset]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setHeight(e!.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = state?.table_shape.num_rows ?? 0;
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 10);
  const last = Math.min(rows - 1, Math.ceil((scrollTop + height) / ROW_H) + 10);

  // Fetch the blocks the viewport needs.
  useEffect(() => {
    if (!state || !columns.length || rows === 0) return;
    for (let b = Math.floor(first / BLOCK); b <= Math.floor(last / BLOCK); b++) {
      if (blocks.current.has(b) || loading.current.has(b)) continue;
      loading.current.add(b);
      const lo = b * BLOCK;
      const hi = Math.min(rows - 1, lo + BLOCK - 1);
      const spec = { first_index: lo, last_index: hi };
      void Promise.all([
        rpc<{ columns: unknown[][] }>(commId, "get_data_values", {
          columns: columns.map((c) => ({ column_index: c.column_index, spec })),
          format_options: FORMAT,
        }),
        state.has_row_labels
          ? rpc<{ row_labels: string[][] }>(commId, "get_row_labels", { selection: spec, format_options: FORMAT }).catch(() => null)
          : Promise.resolve(null),
      ])
        .then(([data, labels]) => {
          blocks.current.set(b, { cells: data.columns, labels: labels?.row_labels?.[0] });
          bump((x) => x + 1);
        })
        .catch(() => {})
        .finally(() => loading.current.delete(b));
    }
  }, [first, last, state, columns, rows, commId]);

  const toggleSort = async (col: number) => {
    const next: SortKey | null = sort?.column_index !== col ? { column_index: col, ascending: true } : sort.ascending ? { column_index: col, ascending: false } : null;
    setSort(next);
    try {
      await rpc(commId, "set_sort_columns", { sort_keys: next ? [next] : [] });
      await reset();
    } catch (e: any) {
      useStore.getState().notify(e.message, "error");
    }
  };

  const cell = (r: number, c: number) => blocks.current.get(Math.floor(r / BLOCK))?.cells[c]?.[r % BLOCK];
  const label = (r: number) => blocks.current.get(Math.floor(r / BLOCK))?.labels?.[r % BLOCK] ?? String(r + 1);
  const gridCols = `64px ${columns.map(() => "minmax(90px, 180px)").join(" ")}`;

  const visible: number[] = [];
  for (let r = first; r <= last; r++) visible.push(r);

  return (
    <div className="dataviewer">
      <div className="panel-toolbar">
        <strong>{state?.display_name ?? "…"}</strong>
        {state && (
          <span className="muted small">
            {state.table_shape.num_rows.toLocaleString()}행 × {state.table_shape.num_columns.toLocaleString()}열
            {state.table_shape.num_columns > MAX_COLS ? ` (처음 ${MAX_COLS}열만 표시)` : ""}
          </span>
        )}
        <span className="spacer" />
        {!alive && <span className="muted small">세션이 끝나 갱신되지 않습니다</span>}
      </div>
      <div className="dv-scroll" ref={scroller} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div className="dv-header" style={{ gridTemplateColumns: gridCols }}>
          <div className="dv-cell dv-rowlabel" />
          {columns.map((c) => (
            <button key={c.column_index} className="dv-cell dv-colhead" onClick={() => toggleSort(c.column_index)} title={`${c.column_name} · ${c.type_display}`}>
              <span className="ellipsis">{c.column_name}</span>
              <span className="muted small">
                {c.type_display}
                {sort?.column_index === c.column_index ? (sort.ascending ? " ▲" : " ▼") : ""}
              </span>
            </button>
          ))}
        </div>
        <div style={{ height: rows * ROW_H, position: "relative" }}>
          {visible.map((r) => (
            <div key={r} className="dv-row" style={{ top: r * ROW_H, gridTemplateColumns: gridCols }}>
              <div className="dv-cell dv-rowlabel">{label(r)}</div>
              {columns.map((c, ci) => {
                const raw = cell(r, ci);
                const v = raw === undefined ? "" : special(raw);
                return (
                  <div key={ci} className={`dv-cell ${raw !== undefined && typeof raw !== "string" ? "dv-na" : ""}`} title={v}>
                    {v}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
