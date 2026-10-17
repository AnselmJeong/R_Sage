// Dialogs of the data viewer: row filter, factor levels, and the code view.

import { useEffect, useState } from "react";
import { host } from "../host/client";
import type { CompareOp, ColumnSchema, RowFilter, RowFilterType, TextSearchType } from "./types";
import { isDateLike, isNumeric } from "./types";
import type { FactorLevel } from "./rcode";
import { factorCode } from "./rcode";

function Modal({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? "dv-dialog-wide" : ""}`} role="dialog" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

// ---- row filters ----

/** Filter kinds offered for a column, by its display type. */
type FilterKind =
  | "is_null"
  | "not_null"
  | "is_empty"
  | "not_empty"
  | "is_true"
  | "is_false"
  | "between"
  | "not_between"
  | "set_membership"
  | "not_set_membership"
  | `compare:${CompareOp}`
  | `search:${TextSearchType}`;

const KIND_LABELS: Record<string, string> = {
  is_null: "결측값임",
  not_null: "결측값이 아님",
  is_empty: "빈 문자열",
  not_empty: "빈 문자열이 아님",
  is_true: "TRUE",
  is_false: "FALSE",
  between: "사이",
  not_between: "사이가 아님",
  set_membership: "다음 중 하나",
  not_set_membership: "다음 중 어느 것도 아님",
  "compare:=": "같음 (=)",
  "compare:!=": "같지 않음 (≠)",
  "compare:<": "작음 (<)",
  "compare:<=": "작거나 같음 (≤)",
  "compare:>": "큼 (>)",
  "compare:>=": "크거나 같음 (≥)",
  "search:contains": "포함",
  "search:not_contains": "포함하지 않음",
  "search:starts_with": "로 시작",
  "search:ends_with": "로 끝남",
  "search:regex_match": "정규식과 일치",
};

function kindsFor(c: ColumnSchema): FilterKind[] {
  const t = c.type_display;
  const nulls: FilterKind[] = ["is_null", "not_null"];
  if (isNumeric(t) || isDateLike(t))
    return ["compare:=", "compare:!=", "compare:<", "compare:<=", "compare:>", "compare:>=", "between", "not_between", ...nulls];
  if (t === "boolean") return ["is_true", "is_false", ...nulls];
  if (t === "string")
    return [
      "search:contains",
      "search:not_contains",
      "search:starts_with",
      "search:ends_with",
      "search:regex_match",
      "compare:=",
      "compare:!=",
      "set_membership",
      "not_set_membership",
      "is_empty",
      "not_empty",
      ...nulls,
    ];
  return nulls;
}

function kindOf(f: RowFilter): FilterKind {
  const p: any = f.params;
  if (f.filter_type === "compare") return `compare:${p.op}` as FilterKind;
  if (f.filter_type === "search") return `search:${p.search_type}` as FilterKind;
  if (f.filter_type === "set_membership") return p.inclusive === false ? "not_set_membership" : "set_membership";
  return f.filter_type as FilterKind;
}

const arity = (k: FilterKind) =>
  k === "between" || k === "not_between" ? 2 : k.startsWith("compare:") || k.startsWith("search:") || k.endsWith("set_membership") ? 1 : 0;

export function describeFilter(f: RowFilter): string {
  const k = kindOf(f);
  const p: any = f.params ?? {};
  const name = f.column_schema.column_name;
  if (k === "between" || k === "not_between") return `${name} ${k === "between" ? "∈" : "∉"} [${p.left_value}, ${p.right_value}]`;
  if (k.startsWith("compare:")) return `${name} ${p.op === "!=" ? "≠" : p.op === "<=" ? "≤" : p.op === ">=" ? "≥" : p.op} ${p.value}`;
  if (k.startsWith("search:")) return `${name} ${KIND_LABELS[k]} "${p.term}"`;
  if (k.endsWith("set_membership")) return `${name} ${k === "set_membership" ? "∈" : "∉"} {${(p.values ?? []).join(", ")}}`;
  return `${name}: ${KIND_LABELS[k]}`;
}

function buildFilter(id: string, column: ColumnSchema, kind: FilterKind, a: string, b: string, caseSensitive: boolean): RowFilter {
  const base = { filter_id: id, column_schema: column, condition: "and" as const };
  if (kind.startsWith("compare:")) return { ...base, filter_type: "compare", params: { op: kind.slice(8) as CompareOp, value: a } };
  if (kind.startsWith("search:"))
    return { ...base, filter_type: "search", params: { search_type: kind.slice(7) as TextSearchType, term: a, case_sensitive: caseSensitive } };
  if (kind === "between" || kind === "not_between") return { ...base, filter_type: kind, params: { left_value: a, right_value: b } };
  if (kind.endsWith("set_membership")) {
    const values = a
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return { ...base, filter_type: "set_membership", params: { values, inclusive: kind === "set_membership" } };
  }
  return { ...base, filter_type: kind as RowFilterType };
}

export function FilterDialog({
  columns,
  initial,
  column,
  onSave,
  onClose,
}: {
  columns: ColumnSchema[];
  initial?: RowFilter;
  /** Column to start with (from the column menu). */
  column?: number;
  onSave: (f: RowFilter) => void;
  onClose: () => void;
}) {
  const start = initial?.column_schema.column_index ?? column ?? columns[0]?.column_index ?? 0;
  const [colIndex, setColIndex] = useState(start);
  const col = columns.find((c) => c.column_index === colIndex) ?? initial?.column_schema ?? columns[0]!;
  const kinds = kindsFor(col);
  const [kind, setKind] = useState<FilterKind>(initial ? kindOf(initial) : kinds[0]!);
  const p: any = initial?.params ?? {};
  const [a, setA] = useState<string>(p.value ?? p.term ?? p.left_value ?? (p.values ?? []).join(", ") ?? "");
  const [b, setB] = useState<string>(p.right_value ?? "");
  const [cs, setCs] = useState<boolean>(!!p.case_sensitive);

  useEffect(() => {
    if (!kinds.includes(kind)) setKind(kinds[0]!);
  }, [colIndex]);

  const n = arity(kind);
  const ok = n === 0 || (a.trim() !== "" && (n === 1 || b.trim() !== ""));
  const save = () => ok && onSave(buildFilter(initial?.filter_id ?? crypto.randomUUID(), col, kind, a.trim(), b.trim(), cs));

  return (
    <Modal title={initial ? "필터 편집" : "필터 추가"} onClose={onClose}>
      <label>
        열
        <select value={colIndex} onChange={(e) => setColIndex(Number(e.target.value))}>
          {columns.map((c) => (
            <option key={c.column_index} value={c.column_index}>
              {c.column_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        조건
        <select value={kind} onChange={(e) => setKind(e.target.value as FilterKind)}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      {n >= 1 && (
        <label>
          {n === 2 ? "부터" : kind.endsWith("set_membership") ? "값 (쉼표로 구분)" : "값"}
          <input
            className="text-input"
            autoFocus
            value={a}
            onChange={(e) => setA(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && save()}
          />
        </label>
      )}
      {n === 2 && (
        <label>
          까지
          <input
            className="text-input"
            value={b}
            onChange={(e) => setB(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && save()}
          />
        </label>
      )}
      {kind.startsWith("search:") && (
        <label className="dv-check">
          <input type="checkbox" checked={cs} onChange={(e) => setCs(e.target.checked)} /> 대소문자 구분
        </label>
      )}
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          취소
        </button>
        <button className="btn btn-primary" disabled={!ok} onClick={save}>
          {initial ? "적용" : "추가"}
        </button>
      </div>
    </Modal>
  );
}

// ---- factor levels ----

export function FactorDialog({ object, column, onRun, onClose }: { object: string; column: ColumnSchema; onRun: (code: string) => void; onClose: () => void }) {
  const [levels, setLevels] = useState<FactorLevel[] | null>(null);
  const [removed, setRemoved] = useState<FactorLevel[]>([]);
  const [info, setInfo] = useState<{ numeric: boolean; total: number; factor: boolean }>({ numeric: false, total: 0, factor: false });
  const [ordered, setOrdered] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState<number | null>(null);

  useEffect(() => {
    host
      .call("data.columnValues", { object, column: column.column_name, limit: 500 })
      .then((r) => {
        setLevels(r.values.map((v) => ({ value: v, label: v })));
        setInfo({ numeric: r.numeric, total: r.total, factor: r.factor });
        setOrdered(r.ordered);
      })
      .catch((e: any) => setError(e.message ?? String(e)));
  }, [object, column.column_name]);

  const move = (from: number, to: number) =>
    setLevels((ls) => {
      if (!ls || to < 0 || to >= ls.length) return ls;
      const next = [...ls];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x!);
      return next;
    });

  const code = levels?.length ? factorCode(object, column.column_name, levels, { numeric: info.numeric, ordered }) : "";
  const tooMany = info.total > 500;

  return (
    <Modal title={`'${column.column_name}'을(를) 범주형(factor)으로`} wide onClose={onClose}>
      <p>수준(level)의 순서를 끌어서 바꾸고, 필요하면 표시 이름(label)을 붙이세요. 목록에서 뺀 값은 NA가 됩니다.</p>
      {error && <div className="dv-error">{error}</div>}
      {!levels && !error && <div className="muted small">값을 읽는 중…</div>}
      {tooMany && (
        <div className="dv-error">고유값이 {info.total.toLocaleString()}개라 처음 500개만 보입니다. 범주형으로 바꾸기에 알맞은 열인지 확인하세요.</div>
      )}
      {levels && (
        <div className="dv-levels">
          <div className="dv-level dv-level-head muted small">
            <span />
            <span>값</span>
            <span>표시 이름 (label)</span>
            <span />
          </div>
          {levels.map((l, i) => (
            <div
              key={l.value}
              className={`dv-level ${drag === i ? "dragging" : ""}`}
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => {
                e.preventDefault();
                if (drag !== null && drag !== i) {
                  move(drag, i);
                  setDrag(i);
                }
              }}
              onDragEnd={() => setDrag(null)}
            >
              <span className="dv-grip" title="끌어서 순서 바꾸기">
                ⠿
              </span>
              <span className="dv-level-value ellipsis" title={l.value}>
                {l.value}
              </span>
              <input
                className="text-input"
                value={l.label}
                onChange={(e) => setLevels((ls) => ls!.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))}
              />
              <span className="dv-level-actions">
                <button className="btn btn-icon btn-small" title="위로" onClick={() => move(i, i - 1)} disabled={i === 0}>
                  ↑
                </button>
                <button className="btn btn-icon btn-small" title="아래로" onClick={() => move(i, i + 1)} disabled={i === levels.length - 1}>
                  ↓
                </button>
                <button
                  className="btn btn-icon btn-small"
                  title="수준에서 빼기 (NA가 됨)"
                  onClick={() => {
                    setRemoved((r) => [...r, l]);
                    setLevels((ls) => ls!.filter((_, k) => k !== i));
                  }}
                >
                  ×
                </button>
              </span>
            </div>
          ))}
          {removed.length > 0 && (
            <div className="dv-removed small">
              <span className="muted">뺀 값:</span>
              {removed.map((r) => (
                <button
                  key={r.value}
                  className="dv-chip"
                  title="다시 넣기"
                  onClick={() => {
                    setRemoved((x) => x.filter((y) => y !== r));
                    setLevels((ls) => [...(ls ?? []), r]);
                  }}
                >
                  {r.value} ↺
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <label className="dv-check">
        <input type="checkbox" checked={ordered} onChange={(e) => setOrdered(e.target.checked)} /> 순서형 (ordered factor)
      </label>
      {code && <pre className="dv-code">{code}</pre>}
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          취소
        </button>
        <button className="btn btn-primary" disabled={!code} onClick={() => onRun(code)}>
          콘솔에서 실행
        </button>
      </div>
    </Modal>
  );
}

// ---- code view ----

export function CodeDialog({ title, code, note, onRun, onClose }: { title: string; code: string; note?: string; onRun?: () => void; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal title={title} wide onClose={onClose}>
      {note && <p>{note}</p>}
      <pre className="dv-code">{code}</pre>
      <div className="dialog-actions">
        <button
          className="btn"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => setCopied(true));
          }}
        >
          {copied ? "복사됨" : "복사"}
        </button>
        {onRun && (
          <button className="btn" onClick={onRun}>
            콘솔에서 실행
          </button>
        )}
        <button className="btn btn-primary" onClick={onClose}>
          닫기
        </button>
      </div>
    </Modal>
  );
}

// ---- rename ----

export function RenameDialog({ column, onRename, onClose }: { column: string; onRename: (to: string) => void; onClose: () => void }) {
  const [v, setV] = useState(column);
  const ok = v.trim() && v.trim() !== column;
  return (
    <Modal title="열 이름 바꾸기" onClose={onClose}>
      <input
        className="text-input"
        autoFocus
        value={v}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && ok && onRename(v.trim())}
      />
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          취소
        </button>
        <button className="btn btn-primary" disabled={!ok} onClick={() => onRename(v.trim())}>
          바꾸기
        </button>
      </div>
    </Modal>
  );
}
