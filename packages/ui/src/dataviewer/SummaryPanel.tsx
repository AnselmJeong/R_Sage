// Column summary pane of the data viewer, after Positron's Data Explorer:
// one row per column with its type, a sparkline (histogram for numbers,
// frequency bars for text and logicals) and the share of missing values.
// A row expands into summary statistics and a larger chart. Profiles come
// from Ark (get_column_profiles), computed over the filtered rows.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { columnProfiles, rpc } from "../comms";
import type { ColumnHistogram, ColumnProfile, ColumnSchema, DisplayType, FrequencyTable } from "./types";
import { FORMAT, isDateLike, isNumeric, special, typeLabel } from "./types";

type SchemaSort = "original" | "ascending_name" | "descending_name" | "ascending_type" | "descending_type";

const SORT_LABELS: Record<SchemaSort, string> = {
  original: "원래 순서",
  ascending_name: "이름 (오름차순)",
  descending_name: "이름 (내림차순)",
  ascending_type: "타입 (오름차순)",
  descending_type: "타입 (내림차순)",
};

const HIST_SMALL = { method: "fixed", num_bins: 20 };
const HIST_LARGE = { method: "freedman_diaconis", num_bins: 40, quantiles: [0.25, 0.5, 0.75] };
const FREQ_SMALL = { limit: 8 };
const FREQ_LARGE = { limit: 12 };

const usesHistogram = (t: DisplayType) => isNumeric(t);
const usesFrequency = (t: DisplayType) => t === "string" || t === "boolean";

function smallSpecs(t: DisplayType) {
  const specs: unknown[] = [{ profile_type: "null_count" }];
  if (usesHistogram(t)) specs.push({ profile_type: "small_histogram", params: HIST_SMALL });
  else if (usesFrequency(t)) specs.push({ profile_type: "small_frequency_table", params: FREQ_SMALL });
  return specs;
}

function largeSpecs(t: DisplayType) {
  const specs: unknown[] = [{ profile_type: "null_count" }, { profile_type: "summary_stats" }];
  if (usesHistogram(t)) specs.push({ profile_type: "large_histogram", params: HIST_LARGE });
  else if (usesFrequency(t)) specs.push({ profile_type: "large_frequency_table", params: FREQ_LARGE });
  return specs;
}

export function TypeIcon({ type, typeName }: { type: DisplayType; typeName?: string }) {
  const factor = /fct|factor|ord/.test(typeName ?? "");
  const glyph = isNumeric(type) ? "#" : factor ? "◫" : type === "string" ? "A" : type === "boolean" ? "◐" : isDateLike(type) ? "◷" : "{}";
  const title = isNumeric(type)
    ? "숫자"
    : factor
      ? "범주(factor)"
      : type === "string"
        ? "문자"
        : type === "boolean"
          ? "논리"
          : isDateLike(type)
            ? "날짜"
            : "기타";
  return (
    <span className={`dvs-type ${factor ? "fct" : type}`} title={title}>
      {glyph}
    </span>
  );
}

function Histogram({ h, width, height, interactive }: { h: ColumnHistogram; width: number; height: number; interactive?: boolean }) {
  const max = Math.max(1, ...h.bin_counts);
  const n = h.bin_counts.length;
  if (!n) return <svg width={width} height={height} />;
  const w = width / n;
  return (
    <svg width={width} height={height} className="dvs-chart">
      {h.bin_counts.map((c, i) => {
        const bh = c === 0 ? 0 : Math.max(1, (c / max) * height);
        return (
          <rect key={i} x={i * w + 0.5} y={height - bh} width={Math.max(1, w - 1)} height={bh} className="dvs-bar">
            {interactive && <title>{`${h.bin_edges[i]} – ${h.bin_edges[i + 1]}: ${c.toLocaleString()}`}</title>}
          </rect>
        );
      })}
    </svg>
  );
}

function FrequencyBars({ f, width, height }: { f: FrequencyTable; width: number; height: number }) {
  const total = f.counts.reduce((a, b) => a + b, 0) + (f.other_count ?? 0);
  if (!total) return <svg width={width} height={height} />;
  let x = 0;
  const parts = f.counts.map((c, i) => ({ label: special(f.values[i]), c }));
  if (f.other_count) parts.push({ label: "기타", c: f.other_count });
  return (
    <svg width={width} height={height} className="dvs-chart">
      {parts.map((p, i) => {
        const w = (p.c / total) * width;
        const r = (
          <rect
            key={i}
            x={x}
            y={0}
            width={Math.max(1, w - 1)}
            height={height}
            className={p.label === "기타" && i === parts.length - 1 && f.other_count ? "dvs-bar other" : "dvs-bar"}
          >
            <title>{`${p.label}: ${p.c.toLocaleString()} (${((p.c / total) * 100).toFixed(1)}%)`}</title>
          </rect>
        );
        x += w;
        return r;
      })}
    </svg>
  );
}

function FrequencyList({ f, rows }: { f: FrequencyTable; rows: number }) {
  const max = Math.max(1, ...f.counts, f.other_count ?? 0);
  const items = f.counts.map((c, i) => ({ label: special(f.values[i]), c, na: typeof f.values[i] !== "string" }));
  if (f.other_count) items.push({ label: "(그 외)", c: f.other_count, na: true });
  return (
    <div className="dvs-freq">
      {items.map((it, i) => (
        <div key={i} className="dvs-freq-row" title={`${it.label}: ${it.c.toLocaleString()}`}>
          <span className={`ellipsis ${it.na ? "muted" : ""}`}>{it.label}</span>
          <span className="dvs-freq-bar">
            <span style={{ width: `${(it.c / max) * 100}%` }} />
          </span>
          <span className="dvs-num">{it.c.toLocaleString()}</span>
          <span className="dvs-num muted">{rows ? `${((it.c / rows) * 100).toFixed(1)}%` : ""}</span>
        </div>
      ))}
    </div>
  );
}

function Stats({ p, rows }: { p: ColumnProfile; rows: number }) {
  const s = p.summary_stats;
  const out: [string, string | number | undefined][] = [
    ["결측", p.null_count !== undefined ? `${p.null_count.toLocaleString()} (${pct(p.null_count, rows)})` : undefined],
  ];
  if (s?.number_stats) {
    const n = s.number_stats;
    out.push(["평균", n.mean], ["중앙값", n.median], ["표준편차", n.stdev], ["최소", n.min_value], ["최대", n.max_value]);
  }
  if (s?.string_stats) out.push(["고유값", s.string_stats.num_unique.toLocaleString()], ["빈 문자열", s.string_stats.num_empty.toLocaleString()]);
  if (s?.boolean_stats) out.push(["TRUE", s.boolean_stats.true_count.toLocaleString()], ["FALSE", s.boolean_stats.false_count.toLocaleString()]);
  const d = s?.date_stats ?? s?.datetime_stats;
  if (d) out.push(["고유값", d.num_unique?.toLocaleString()], ["최소", d.min_date], ["중앙값", d.median_date], ["최대", d.max_date]);
  if (s?.other_stats) out.push(["고유값", s.other_stats.num_unique?.toLocaleString()]);
  return (
    <div className="dvs-stats">
      {out
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => (
          <div key={k} className="dvs-stat">
            <span className="muted">{k}</span>
            <span className="dvs-num">{v}</span>
          </div>
        ))}
    </div>
  );
}

const pct = (n: number, rows: number) => (rows ? `${((n / rows) * 100).toFixed(n && n / rows < 0.001 ? 2 : 0)}%` : "0%");

interface Props {
  commId: string;
  /** Bumped whenever the data, schema or filters change. */
  version: number;
  rows: number;
  totalColumns: number;
  selected?: number;
  onSelect: (columnIndex: number) => void;
  onClose: () => void;
}

export function SummaryPanel({ commId, version, rows, totalColumns, selected, onSelect, onClose }: Props) {
  const [sortOrder, setSortOrder] = useState<SchemaSort>("original");
  const [filter, setFilter] = useState("");
  const [columns, setColumns] = useState<ColumnSchema[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);
  const small = useRef(new Map<number, ColumnProfile>());
  const large = useRef(new Map<number, ColumnProfile>());
  const pending = useRef(new Set<number>());
  const queue = useRef(new Set<number>());
  const flushTimer = useRef<ReturnType<typeof setTimeout>>();
  const [, bump] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const byIndex = useRef(new Map<number, ColumnSchema>());
  const observer = useRef<IntersectionObserver>();

  // The column list: Ark's search_schema does the name filter and ordering.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(
      async () => {
        try {
          let indices: number[];
          if (!filter.trim() && sortOrder === "original") {
            indices = [...Array(Math.min(totalColumns, 1000)).keys()];
          } else {
            const filters = filter.trim()
              ? [{ filter_type: "text_search", params: { search_type: "contains", term: filter.trim(), case_sensitive: false } }]
              : [];
            const r = await rpc<{ matches: number[] }>(commId, "search_schema", { filters, sort_order: sortOrder });
            indices = r.matches.slice(0, 1000);
          }
          const schema = indices.length ? await rpc<{ columns: ColumnSchema[] }>(commId, "get_schema", { column_indices: indices }) : { columns: [] };
          if (cancelled) return;
          const map = new Map(schema.columns.map((c) => [c.column_index, c]));
          byIndex.current = map;
          // get_schema returns columns in index order; keep the search order.
          setColumns(indices.map((i) => map.get(i)).filter((c): c is ColumnSchema => !!c));
        } catch {
          /* the comm closed */
        }
      },
      filter ? 200 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [commId, filter, sortOrder, totalColumns, version]);

  // Profiles depend on the data and the row filters.
  useEffect(() => {
    small.current.clear();
    large.current.clear();
    pending.current.clear();
    queue.current.clear();
    bump((x) => x + 1);
    // Rows already on screen won't intersect again; observing anew reports them.
    const io = observer.current;
    listRef.current?.querySelectorAll<HTMLElement>("[data-col]").forEach((el) => {
      io?.unobserve(el);
      io?.observe(el);
    });
  }, [version, commId]);

  useEffect(() => {
    for (const i of expanded) if (!large.current.has(i)) void loadLarge(i);
  }, [expanded, version]);

  const flush = () => {
    flushTimer.current = undefined;
    const ids = [...queue.current].filter((i) => !small.current.has(i) && !pending.current.has(i));
    queue.current.clear();
    if (!ids.length) return;
    ids.forEach((i) => pending.current.add(i));
    const requests = ids.map((i) => ({ column_index: i, profiles: smallSpecs(byIndex.current.get(i)?.type_display ?? "unknown") }));
    void columnProfiles<ColumnProfile>(commId, requests, FORMAT)
      .then((res) => {
        res.forEach((p, k) => small.current.set(ids[k]!, p));
        bump((x) => x + 1);
      })
      .catch(() => {})
      .finally(() => ids.forEach((i) => pending.current.delete(i)));
  };

  const want = (i: number) => {
    if (small.current.has(i) || pending.current.has(i)) return;
    queue.current.add(i);
    if (!flushTimer.current) flushTimer.current = setTimeout(flush, 30);
  };

  const loadLarge = async (i: number) => {
    const c = byIndex.current.get(i);
    if (!c) return;
    try {
      const [p] = await columnProfiles<ColumnProfile>(commId, [{ column_index: i, profiles: largeSpecs(c.type_display) }], FORMAT);
      if (p) large.current.set(i, p);
      bump((x) => x + 1);
    } catch {
      /* ignore */
    }
  };

  // Profile only the rows that scroll into view.
  useEffect(() => {
    observer.current = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) want(Number((e.target as HTMLElement).dataset.col));
      },
      { root: listRef.current, rootMargin: "200px" },
    );
    return () => observer.current?.disconnect();
  }, [commId]);
  const observe = (el: HTMLDivElement | null) => {
    if (el) observer.current?.observe(el);
  };

  // Follow the grid's selection.
  useEffect(() => {
    if (selected === undefined) return;
    listRef.current?.querySelector(`[data-col="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const toggle = (i: number) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  return (
    <div className="dvs">
      <div className="dvs-head">
        <div className="dvs-sort">
          <button
            className="dvs-sort-btn"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setSortMenu((v) => (v ? null : { x: r.left, y: r.bottom + 2 }));
            }}
          >
            {SORT_LABELS[sortOrder]} <span className="caret">▾</span>
          </button>
          {sortMenu &&
            createPortal(
              <>
                <div className="dv-menu-shield" onMouseDown={() => setSortMenu(null)} />
                <div className="context-menu dv-menu" style={{ left: sortMenu.x, top: sortMenu.y }}>
                  {(Object.keys(SORT_LABELS) as SchemaSort[]).map((k) => (
                    <div
                      key={k}
                      className={`menu-item ${k === sortOrder ? "checked" : ""}`}
                      onClick={() => {
                        setSortOrder(k);
                        setSortMenu(null);
                      }}
                    >
                      {SORT_LABELS[k]}
                    </div>
                  ))}
                </div>
              </>,
              document.body,
            )}
        </div>
        <input className="text-input dvs-filter" placeholder="열 찾기" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="dv-icon-btn" title="요약 닫기" onClick={onClose}>
          ‹
        </button>
      </div>
      <div className="dvs-list" ref={listRef}>
        {columns.map((c) => {
          const p = small.current.get(c.column_index);
          const big = large.current.get(c.column_index);
          const open = expanded.has(c.column_index);
          const nulls = p?.null_count;
          return (
            <div
              key={c.column_index}
              data-col={c.column_index}
              ref={observe}
              className={`dvs-item ${selected === c.column_index ? "selected" : ""} ${open ? "open" : ""}`}
            >
              <div className="dvs-row" onClick={() => onSelect(c.column_index)} onDoubleClick={() => toggle(c.column_index)}>
                <button
                  className={`dvs-chevron ${open ? "open" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(c.column_index);
                  }}
                  title={open ? "접기" : "펼치기"}
                >
                  ›
                </button>
                <TypeIcon type={c.type_display} typeName={c.type_name} />
                <span className="dvs-name ellipsis" title={`${c.column_name} · ${typeLabel(c)}${c.column_label ? `\n${c.column_label}` : ""}`}>
                  {c.column_name}
                </span>
                <span className="dvs-spark">
                  {p?.small_histogram && <Histogram h={p.small_histogram} width={80} height={20} />}
                  {p?.small_frequency_table && <FrequencyBars f={p.small_frequency_table} width={80} height={14} />}
                </span>
                <span className="dvs-missing" title={nulls !== undefined ? `결측 ${nulls.toLocaleString()}개` : ""}>
                  <span className="dvs-num">{nulls !== undefined ? pct(nulls, rows) : ""}</span>
                  <span className="dvs-missing-bar">
                    <span style={{ width: nulls !== undefined && rows ? `${Math.max(nulls ? 4 : 0, (nulls / rows) * 100)}%` : 0 }} />
                  </span>
                </span>
              </div>
              {open && (
                <div className="dvs-detail">
                  {!big ? (
                    <div className="muted small">계산 중…</div>
                  ) : (
                    <>
                      <Stats p={big} rows={rows} />
                      {big.large_histogram && (
                        <div className="dvs-big">
                          <Histogram h={big.large_histogram} width={260} height={70} interactive />
                          <div className="dvs-axis muted">
                            <span>{big.large_histogram.bin_edges[0]}</span>
                            <span>{big.large_histogram.bin_edges[big.large_histogram.bin_edges.length - 1]}</span>
                          </div>
                        </div>
                      )}
                      {big.large_frequency_table && <FrequencyList f={big.large_frequency_table} rows={rows} />}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!columns.length && <div className="muted small dvs-empty">{filter ? "맞는 열이 없습니다" : ""}</div>}
      </div>
    </div>
  );
}
