import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { IDockviewPanelProps } from "dockview";
import { rpc, useComms } from "../comms";
import { host } from "../host/client";
import { useStore } from "../store";
import type { BackendState, ColumnSchema, RowFilter, SortKey } from "../dataviewer/types";
import { FORMAT, isNumeric, special, typeLabel } from "../dataviewer/types";
import { CONVERT_TARGETS, canModify, convertCode, renameCode } from "../dataviewer/rcode";
import { CodeDialog, FactorDialog, FilterDialog, RenameDialog, describeFilter } from "../dataviewer/dialogs";
import { SummaryPanel, TypeIcon } from "../dataviewer/SummaryPanel";

// Data explorer comm (Ark's DataExplorerBackendRequest), laid out like
// Positron's Data Explorer: column summary on the left, a filter bar, and
// the grid with a ⋮ menu per column. Sorting and filtering are views kept
// by Ark; changes to the data (types, factor levels, names) run as R code
// in the console so they are visible and reproducible.
// Rows are fetched in blocks as the grid scrolls, so large data frames stay responsive.

const ROW_H = 26;
const BLOCK = 200;
const MAX_COLS = 500;
const DEFAULT_W = 150;
const SUMMARY_KEY = "rsage.dataviewer.summary";

type Dialog =
  | { kind: "filter"; initial?: RowFilter; column?: number }
  | { kind: "factor"; column: ColumnSchema }
  | { kind: "rename"; column: ColumnSchema }
  | { kind: "code"; code: string };

const readPref = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const writePref = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode */
  }
};

export function DataViewerPanel(props: IDockviewPanelProps<{ commId: string }>) {
  const commId = props.params.commId;
  const version = useComms((s) => s.dataViewers[commId]?.version ?? -1);
  const alive = version >= 0;
  const [state, setState] = useState<BackendState>();
  const [columns, setColumns] = useState<ColumnSchema[]>([]);
  const [filterGen, setFilterGen] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [widths, setWidths] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<number>();
  const [menu, setMenu] = useState<{ col: ColumnSchema; x: number; y: number }>();
  const [dialog, setDialog] = useState<Dialog>();
  const [summary, setSummary] = useState<{ open: boolean; width: number }>(() => readPref(SUMMARY_KEY, { open: true, width: 340 }));
  const blocks = useRef(new Map<number, { cells: unknown[][]; labels?: string[] }>());
  const loading = useRef(new Set<number>());
  const generation = useRef(0);
  const [, bump] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  const notifyError = (e: any) => useStore.getState().notify(e?.message ?? String(e), "error");

  const reset = useCallback(async () => {
    generation.current++;
    blocks.current.clear();
    loading.current.clear();
    try {
      const st = await rpc<BackendState>(commId, "get_state");
      const n = Math.min(st.table_shape.num_columns, MAX_COLS);
      const schema = await rpc<{ columns: ColumnSchema[] }>(commId, "get_schema", { column_indices: [...Array(n).keys()] });
      setState(st);
      setColumns(schema.columns);
      bump((x) => x + 1);
    } catch (e: any) {
      notifyError(e);
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

  useEffect(() => writePref(SUMMARY_KEY, summary), [summary]);

  const rows = state?.table_shape.num_rows ?? 0;
  const totalRows = state?.table_unfiltered_shape.num_rows ?? 0;
  const sortKeys = state?.sort_keys ?? [];
  const rowFilters = state?.row_filters ?? [];
  const object = state?.display_name ?? "";
  const modifiable = canModify(object);
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 10);
  const last = Math.min(rows - 1, Math.ceil((scrollTop + height) / ROW_H) + 10);

  // Fetch the blocks the viewport needs.
  useEffect(() => {
    if (!state || !columns.length || rows === 0) return;
    const gen = generation.current;
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
          if (gen !== generation.current) return;
          blocks.current.set(b, { cells: data.columns, labels: labels?.row_labels?.[0] });
          bump((x) => x + 1);
        })
        .catch(() => {})
        .finally(() => loading.current.delete(b));
    }
  }, [first, last, state, columns, rows, commId]);

  // ---- view operations (kept by Ark, the data is untouched) ----

  const setSort = async (keys: SortKey[]) => {
    try {
      await rpc(commId, "set_sort_columns", { sort_keys: keys });
      await reset();
    } catch (e) {
      notifyError(e);
    }
  };

  const sortBy = (col: number, ascending: boolean | null) => {
    const others = sortKeys.filter((k) => k.column_index !== col);
    if (ascending === null) return setSort(others);
    const existing = sortKeys.findIndex((k) => k.column_index === col);
    const next =
      existing >= 0 ? sortKeys.map((k) => (k.column_index === col ? { column_index: col, ascending } : k)) : [...sortKeys, { column_index: col, ascending }];
    return setSort(next);
  };

  const setFilters = async (filters: RowFilter[]) => {
    try {
      await rpc(commId, "set_row_filters", { filters });
      setFilterGen((g) => g + 1);
      scroller.current?.scrollTo({ top: 0 });
      await reset();
    } catch (e) {
      notifyError(e);
    }
  };

  const saveFilter = (f: RowFilter) => {
    setDialog(undefined);
    const exists = rowFilters.some((x) => x.filter_id === f.filter_id);
    void setFilters(exists ? rowFilters.map((x) => (x.filter_id === f.filter_id ? f : x)) : [...rowFilters, f]);
  };

  const convertToCode = async () => {
    try {
      const r = await rpc<{ converted_code: string[] }>(commId, "convert_to_code", {
        column_filters: [],
        row_filters: rowFilters,
        sort_keys: sortKeys,
        code_syntax_name: { code_syntax_name: "dplyr" },
      });
      setDialog({ kind: "code", code: r.converted_code.join("\n") });
    } catch (e) {
      notifyError(e);
    }
  };

  // ---- data changes: visible R code in the console ----

  const runInConsole = async (code: string) => {
    setDialog(undefined);
    setMenu(undefined);
    try {
      await host.call("console.execute", { code, origin: "console" });
    } catch (e) {
      notifyError(e);
    }
  };

  // ---- layout ----

  const width = (c: ColumnSchema) => widths[c.column_index] ?? DEFAULT_W;
  const gridCols = `64px ${columns.map((c) => `${width(c)}px`).join(" ")}`;

  const startResize = (e: React.MouseEvent, c: ColumnSchema) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = width(c);
    const move = (ev: MouseEvent) => setWidths((w) => ({ ...w, [c.column_index]: Math.max(60, Math.min(800, w0 + ev.clientX - x0)) }));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("dv-resizing");
    };
    document.body.classList.add("dv-resizing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const startSplit = (e: React.MouseEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = summary.width;
    const move = (ev: MouseEvent) => setSummary((s) => ({ ...s, width: Math.max(240, Math.min(640, w0 + ev.clientX - x0)) }));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("dv-resizing");
    };
    document.body.classList.add("dv-resizing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  /** Select a column and bring it into view (from the summary pane). */
  const revealColumn = (col: number) => {
    setSelected(col);
    const el = scroller.current;
    if (!el) return;
    let x = 64;
    for (const c of columns) {
      if (c.column_index === col) break;
      x += width(c);
    }
    const c = columns.find((k) => k.column_index === col);
    if (!c) return;
    if (x < el.scrollLeft + 64 || x + width(c) > el.scrollLeft + el.clientWidth) el.scrollTo({ left: Math.max(0, x - 64 - 40), behavior: "smooth" });
  };

  const cell = (r: number, c: number) => blocks.current.get(Math.floor(r / BLOCK))?.cells[c]?.[r % BLOCK];
  const label = (r: number) => blocks.current.get(Math.floor(r / BLOCK))?.labels?.[r % BLOCK] ?? String(r + 1);

  const visible: number[] = [];
  for (let r = first; r <= last; r++) visible.push(r);

  const sortIndex = (col: number) => sortKeys.findIndex((k) => k.column_index === col);

  return (
    <div className="dataviewer">
      <div className="panel-toolbar dv-toolbar">
        {!summary.open && (
          <button className="dv-icon-btn" title="열 요약 열기" onClick={() => setSummary((s) => ({ ...s, open: true }))}>
            ›
          </button>
        )}
        <strong className="ellipsis">{object || "…"}</strong>
        <span className="spacer" />
        {!alive && <span className="muted small">세션이 끝나 갱신되지 않습니다</span>}
        {sortKeys.length > 0 && (
          <button className="btn btn-small btn-icon dv-tool" onClick={() => void setSort([])} title="모든 열의 정렬을 해제합니다">
            ⇅ 정렬 해제
          </button>
        )}
        <button
          className="btn btn-small btn-icon dv-tool"
          disabled={!alive || (!sortKeys.length && !rowFilters.length)}
          onClick={() => void convertToCode()}
          title="지금의 필터와 정렬을 dplyr 코드로 만듭니다"
        >
          {"</>"} 코드로 변환
        </button>
      </div>
      <div className="dv-filterbar">
        <svg className="dv-filter-icon" viewBox="0 0 16 16" aria-label="행 필터">
          <path d="M2 3h12l-4.5 5.5V13l-3 1.5V8.5z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
        {rowFilters.map((f) => (
          <span key={f.filter_id} className={`dv-chip ${f.is_valid === false ? "invalid" : ""}`} title={f.error_message ?? "눌러서 편집"}>
            <button className="dv-chip-label" onClick={() => setDialog({ kind: "filter", initial: f })}>
              {describeFilter(f)}
            </button>
            <button className="dv-chip-x" title="필터 지우기" onClick={() => void setFilters(rowFilters.filter((x) => x.filter_id !== f.filter_id))}>
              ×
            </button>
          </span>
        ))}
        <button className="btn btn-small dv-add-filter" disabled={!alive || !columns.length} onClick={() => setDialog({ kind: "filter" })} title="필터 추가">
          + 필터
        </button>
        {rowFilters.length > 1 && (
          <button className="btn btn-small btn-icon dv-tool" onClick={() => void setFilters([])}>
            모두 지우기
          </button>
        )}
      </div>
      <div className="dv-body">
        {summary.open && alive && state && (
          <>
            <div className="dv-summary" style={{ width: summary.width }}>
              <SummaryPanel
                commId={commId}
                version={version * 10000 + filterGen}
                rows={rows}
                totalColumns={state.table_shape.num_columns}
                selected={selected}
                onSelect={revealColumn}
                onClose={() => setSummary((s) => ({ ...s, open: false }))}
              />
            </div>
            <div className="dv-splitter" onMouseDown={startSplit} />
          </>
        )}
        <div className="dv-scroll" ref={scroller} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
          <div className="dv-header" style={{ gridTemplateColumns: gridCols }}>
            <div className="dv-cell dv-rowlabel dv-corner" />
            {columns.map((c) => {
              const si = sortIndex(c.column_index);
              const key = si >= 0 ? sortKeys[si] : undefined;
              return (
                <div
                  key={c.column_index}
                  className={`dv-colhead ${selected === c.column_index ? "selected" : ""}`}
                  onClick={() => setSelected(c.column_index)}
                  title={`${c.column_name} · ${c.type_name}${c.column_label ? `\n${c.column_label}` : ""}`}
                >
                  <div className="dv-colhead-text">
                    <span className="dv-colname ellipsis">{c.column_name}</span>
                    <span className="dv-coltype">
                      <TypeIcon type={c.type_display} typeName={c.type_name} />
                      {typeLabel(c)}
                    </span>
                  </div>
                  {key && (
                    <span className="dv-sort-ind" title={key.ascending ? "오름차순" : "내림차순"}>
                      {key.ascending ? "↑" : "↓"}
                      {sortKeys.length > 1 ? <sub>{si + 1}</sub> : null}
                    </span>
                  )}
                  <button
                    className={`dv-colmenu ${menu?.col.column_index === c.column_index ? "open" : ""}`}
                    title="열 메뉴"
                    onClick={(e) => {
                      e.stopPropagation();
                      const r = e.currentTarget.getBoundingClientRect();
                      setSelected(c.column_index);
                      setMenu({ col: c, x: r.right, y: r.bottom + 2 });
                    }}
                  >
                    ⋮
                  </button>
                  <span
                    className="dv-resize"
                    onMouseDown={(e) => startResize(e, c)}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={() =>
                      setWidths((w) => {
                        const n = { ...w };
                        delete n[c.column_index];
                        return n;
                      })
                    }
                  />
                </div>
              );
            })}
          </div>
          <div style={{ height: rows * ROW_H, position: "relative" }}>
            {visible.map((r) => (
              <div key={r} className="dv-row" style={{ top: r * ROW_H, gridTemplateColumns: gridCols }}>
                <div className="dv-cell dv-rowlabel">{label(r)}</div>
                {columns.map((c, ci) => {
                  const raw = cell(r, ci);
                  const v = raw === undefined ? "" : special(raw);
                  const cls = ["dv-cell"];
                  if (raw !== undefined && typeof raw !== "string") cls.push("dv-na");
                  if (isNumeric(c.type_display)) cls.push("dv-numcell");
                  if (selected === c.column_index) cls.push("dv-colsel");
                  return (
                    <div key={ci} className={cls.join(" ")} title={v}>
                      {v}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {state && rows === 0 && <div className="dv-empty muted">{rowFilters.length ? "필터에 맞는 행이 없습니다" : "행이 없습니다"}</div>}
        </div>
      </div>
      <div className="dv-status">
        <span className={`dv-status-dot ${alive ? "on" : ""}`} />
        {state && (
          <span>
            {rows !== totalRows ? (
              <>
                <strong>{rows.toLocaleString()}</strong>행 표시 (전체 {totalRows.toLocaleString()}행)
              </>
            ) : (
              <>{rows.toLocaleString()}행</>
            )}
            <span className="muted"> · </span>
            {state.table_shape.num_columns.toLocaleString()}열
            {state.table_shape.num_columns > MAX_COLS ? <span className="muted"> (그리드에는 처음 {MAX_COLS}열)</span> : null}
          </span>
        )}
      </div>

      {createPortal(
        <>
          {menu && (
            <ColumnMenu
              col={menu.col}
              x={menu.x}
              y={menu.y}
              sortKey={sortKeys.find((k) => k.column_index === menu.col.column_index)}
              modifiable={modifiable && alive}
              object={object}
              onClose={() => setMenu(undefined)}
              onSort={(asc) => {
                setMenu(undefined);
                void sortBy(menu.col.column_index, asc);
              }}
              onFilter={() => {
                setMenu(undefined);
                setDialog({ kind: "filter", column: menu.col.column_index });
              }}
              onConvert={(code) => void runInConsole(code)}
              onFactor={() => {
                setMenu(undefined);
                setDialog({ kind: "factor", column: menu.col });
              }}
              onRename={() => {
                setMenu(undefined);
                setDialog({ kind: "rename", column: menu.col });
              }}
            />
          )}
          {dialog?.kind === "filter" && (
            <FilterDialog columns={columns} initial={dialog.initial} column={dialog.column} onSave={saveFilter} onClose={() => setDialog(undefined)} />
          )}
          {dialog?.kind === "factor" && (
            <FactorDialog object={object} column={dialog.column} onRun={(code) => void runInConsole(code)} onClose={() => setDialog(undefined)} />
          )}
          {dialog?.kind === "rename" && (
            <RenameDialog
              column={dialog.column.column_name}
              onRename={(to) => void runInConsole(renameCode(object, dialog.column.column_name, to))}
              onClose={() => setDialog(undefined)}
            />
          )}
          {dialog?.kind === "code" && (
            <CodeDialog
              title="코드로 변환"
              note="지금의 필터와 정렬을 재현하는 dplyr 코드입니다."
              code={dialog.code}
              onRun={() => void runInConsole(dialog.code)}
              onClose={() => setDialog(undefined)}
            />
          )}
        </>,
        document.body,
      )}
    </div>
  );
}

function ColumnMenu(props: {
  col: ColumnSchema;
  x: number;
  y: number;
  sortKey?: SortKey;
  modifiable: boolean;
  object: string;
  onClose: () => void;
  onSort: (ascending: boolean | null) => void;
  onFilter: () => void;
  onConvert: (code: string) => void;
  onFactor: () => void;
  onRename: () => void;
}) {
  const { col, sortKey, modifiable, object } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });
  const [sub, setSub] = useState(false);

  // Open below the ⋮ button, right-aligned to it, and keep it on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(4, Math.min(props.x - r.width, window.innerWidth - r.width - 4));
    const top = props.y + r.height > window.innerHeight - 4 ? Math.max(4, props.y - r.height - 30) : props.y;
    setPos({ left, top });
  }, [props.x, props.y]);

  const why = modifiable ? undefined : "View(이름)으로 연 데이터 프레임만 바꿀 수 있습니다";
  const item = (label: React.ReactNode, onClick: () => void, opts: { disabled?: boolean; title?: string; checked?: boolean } = {}) => (
    <div
      className={`menu-item ${opts.disabled ? "disabled" : ""} ${opts.checked ? "checked" : ""}`}
      title={opts.title}
      onClick={() => !opts.disabled && onClick()}
      onMouseEnter={() => setSub(false)}
    >
      {label}
    </div>
  );

  return (
    <>
      <div
        className="dv-menu-shield"
        onMouseDown={props.onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          props.onClose();
        }}
      />
      <div ref={ref} className="context-menu dv-menu" style={pos} onKeyDown={(e) => e.key === "Escape" && props.onClose()}>
        <div className="menu-title ellipsis">{col.column_name}</div>
        {item("오름차순 정렬", () => props.onSort(true), { checked: sortKey?.ascending === true })}
        {item("내림차순 정렬", () => props.onSort(false), { checked: sortKey?.ascending === false })}
        {sortKey && item("정렬 해제", () => props.onSort(null))}
        <div className="menu-sep" />
        {item("필터 추가…", props.onFilter)}
        <div className="menu-sep" />
        <div
          className={`menu-item dv-submenu-anchor ${!modifiable ? "disabled" : ""} ${sub ? "active" : ""}`}
          title={why}
          onMouseEnter={() => modifiable && setSub(true)}
          onClick={() => modifiable && setSub((v) => !v)}
        >
          타입 변경 <span className="dv-submenu-caret">›</span>
          {sub && (
            <div className="context-menu dv-menu dv-submenu" onClick={(e) => e.stopPropagation()}>
              {CONVERT_TARGETS.map((t) => (
                <div key={t.target} className="menu-item" onClick={() => props.onConvert(convertCode(object, col.column_name, t.target, col.type_name))}>
                  {t.label}
                </div>
              ))}
            </div>
          )}
        </div>
        {item("범주형(factor)으로, 수준 지정…", props.onFactor, { disabled: !modifiable, title: why })}
        {item("열 이름 바꾸기…", props.onRename, { disabled: !modifiable, title: why })}
        <div className="menu-sep" />
        {item("열 이름 복사", () => {
          void navigator.clipboard.writeText(col.column_name);
          props.onClose();
        })}
      </div>
    </>
  );
}
