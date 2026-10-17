// JASP-style variable assignment for analysis forms: one searchable list of
// the data set's columns (with type icons), and a box for each variable role
// in the form. Columns move into a role by double-click, the arrow button or
// drag and drop, and back by × or by dragging them out.

import { useMemo, useState } from "react";
import type { AnalysisDataset, AnalysisFormControl } from "@rsage/shared";
import { getPath, setPath } from "@rsage/shared";
import { KIND_LABEL, accepts, varKind, type VarKind } from "../analysisVars";

export type RoleControl = Extract<AnalysisFormControl, { type: "variables" | "variable" }>;

const DRAG = "application/x-rsage-vars";

export const isRole = (c: AnalysisFormControl): c is RoleControl => c.type === "variables" || c.type === "variable";

export function isVisible(c: AnalysisFormControl, options: any) {
  return !("visibleWhen" in c && c.visibleWhen) || getPath(options, c.visibleWhen.bind) === c.visibleWhen.equals;
}

/** Names held by a role, whatever its kind. */
export function roleNames(c: RoleControl, options: any): string[] {
  const v = getPath(options, c.bind);
  return c.type === "variables" ? ((v as string[]) ?? []) : v ? [v as string] : [];
}

/** Shared state of the variable list and the role boxes of one form. */
export interface RoleApi {
  columns: AnalysisDataset["columns"];
  chosen: string[];
  setChosen(names: string[]): void;
  /** Puts names into a role (or the first role that takes them), taking them out of the others. */
  assign(names: string[], to?: RoleControl): void;
  unassign(names: string[]): void;
  canTake(c: RoleControl, names: string[]): boolean;
}

export function useRoleApi(roles: RoleControl[], options: any, columns: AnalysisDataset["columns"], onOptions: (o: any) => void): RoleApi {
  const [chosen, setChosen] = useState<string[]>([]);
  const typeOf = (n: string) => columns.find((c) => c.name === n)?.type ?? "";
  const shown = roles.filter((r) => isVisible(r, options));
  const canTake = (c: RoleControl, names: string[]) => names.length > 0 && names.every((n) => accepts(c.types, typeOf(n)));
  const without = (opts: any, names: string[], except?: RoleControl) => {
    for (const r of roles) {
      if (r === except) continue;
      const cur = roleNames(r, opts);
      if (!cur.some((n) => names.includes(n))) continue;
      opts = setPath(opts, r.bind, r.type === "variables" ? cur.filter((n) => !names.includes(n)) : null);
    }
    return opts;
  };
  return {
    columns,
    chosen,
    setChosen,
    canTake,
    assign(names, to) {
      const target =
        to ?? shown.find((r) => canTake(r, names) && (r.type === "variables" || (names.length === 1 && roleNames(r, options).length === 0))) ?? shown.find((r) => canTake(r, names));
      if (!target || !canTake(target, names)) return;
      let opts = without(options, names, target);
      if (target.type === "variables") {
        const cur = roleNames(target, opts);
        opts = setPath(opts, target.bind, [...cur, ...names.filter((n) => !cur.includes(n))]);
      } else {
        opts = setPath(opts, target.bind, names[0]);
      }
      onOptions(opts);
      setChosen([]);
    },
    unassign(names) {
      onOptions(without(options, names));
    },
  };
}

export function VarIcon({ type }: { type: string }) {
  const k = varKind(type);
  const title = `${KIND_LABEL[k]} (${type})`;
  return (
    <svg className={`an-vicon an-vicon-${k}`} viewBox="0 0 16 16" aria-label={title}>
      <title>{title}</title>
      {ICONS[k]}
    </svg>
  );
}

const ICONS: Record<VarKind, JSX.Element> = {
  // A ruler: continuous scale.
  numeric: <path d="M2 10.5h12v3H2zM4.5 10.5v-2M7 10.5v-3M9.5 10.5v-2M12 10.5v-3" />,
  // Three separate groups.
  factor: (
    <>
      <circle cx="5" cy="5.5" r="2.5" />
      <circle cx="11" cy="5.5" r="2.5" />
      <circle cx="8" cy="11" r="2.5" />
    </>
  ),
  // Rising bars: ordered levels.
  ordered: <path d="M2.5 13.5v-3h3v3zM6.5 13.5v-6h3v6zM10.5 13.5v-10h3v10z" />,
  character: <path d="M3 4h7M6.5 4v9M9 9h5M11.5 9v4.5" />,
  logical: (
    <>
      <rect x="1.5" y="4.5" width="13" height="7" rx="3.5" />
      <circle cx="11" cy="8" r="2" />
    </>
  ),
  date: <path d="M2.5 4h11v9.5h-11zM2.5 7h11M5.5 2.5v3M10.5 2.5v3" />,
  other: <circle cx="8" cy="8" r="2" />,
};

const dragNames = (e: React.DragEvent): string[] => {
  try {
    return JSON.parse(e.dataTransfer.getData(DRAG));
  } catch {
    return [];
  }
};

/** The data set's columns not yet in a role. */
export function VariableSource({ api, used }: { api: RoleApi; used: Set<string> }) {
  const [q, setQ] = useState("");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const free = api.columns.filter((c) => !used.has(c.name));
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? free.filter((c) => c.name.toLowerCase().includes(s) || KIND_LABEL[varKind(c.type)].includes(s)) : free;
  }, [q, free]);
  const chosen = new Set(api.chosen);
  const click = (e: React.MouseEvent, name: string) => {
    if (e.shiftKey && anchor) {
      const a = shown.findIndex((c) => c.name === anchor);
      const b = shown.findIndex((c) => c.name === name);
      if (a >= 0 && b >= 0) return api.setChosen(shown.slice(Math.min(a, b), Math.max(a, b) + 1).map((c) => c.name));
    }
    setAnchor(name);
    if (e.metaKey || e.ctrlKey) api.setChosen(chosen.has(name) ? api.chosen.filter((n) => n !== name) : [...api.chosen, name]);
    else api.setChosen([name]);
  };
  return (
    <div className="an-field">
      <span>변수 목록</span>
      {api.columns.length > 8 && <input className="an-vsearch" placeholder="변수 찾기" value={q} onChange={(e) => setQ(e.target.value)} />}
      <div
        className={`an-varlist an-source ${over ? "drop" : ""}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG)) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          api.unassign(dragNames(e).filter((n) => used.has(n)));
        }}
      >
        {!api.columns.length && <span className="muted small">데이터를 고르면 변수가 나옵니다.</span>}
        {api.columns.length > 0 && !shown.length && <span className="muted small">{q ? "맞는 변수가 없습니다." : "모든 변수를 배정했습니다."}</span>}
        {shown.map((c) => (
          <div
            key={c.name}
            className={`an-var ${chosen.has(c.name) ? "chosen" : ""}`}
            draggable
            onDragStart={(e) => {
              const names = chosen.has(c.name) ? api.chosen : [c.name];
              e.dataTransfer.setData(DRAG, JSON.stringify(names));
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={(e) => click(e, c.name)}
            onDoubleClick={() => api.assign([c.name])}
          >
            <VarIcon type={c.type} />
            <span className="ellipsis">{c.name}</span>
          </div>
        ))}
      </div>
      <span className="muted small">
        {free.length}/{api.columns.length}개 · 두 번 클릭하거나 끌어서 아래 칸에 넣습니다
      </span>
    </div>
  );
}

/** One variable role of the form (e.g. "분석할 변수", "그룹 변수"). */
export function RoleBox({ control: c, api, options, hint }: { control: RoleControl; api: RoleApi; options: any; hint: JSX.Element | null }) {
  const [over, setOver] = useState<"ok" | "no" | null>(null);
  const names = roleNames(c, options);
  const typeOf = (n: string) => api.columns.find((x) => x.name === n)?.type;
  const take = api.canTake(c, api.chosen);
  const allowed = c.types?.length ? c.types.map((t) => KIND_LABEL[t]).join(", ") : null;
  return (
    <div className="an-field">
      <div className="an-role-head">
        <button
          className="an-role-add"
          disabled={!take}
          title={api.chosen.length ? (take ? "선택한 변수 넣기" : `이 칸에는 ${allowed} 변수만 넣을 수 있습니다`) : "위 목록에서 변수를 고르세요"}
          onClick={() => api.assign(c.type === "variable" ? api.chosen.slice(0, 1) : api.chosen, c)}
        >
          <svg viewBox="0 0 16 16">
            <path d="M3 8h9M8.5 4.5L12 8l-3.5 3.5" />
          </svg>
        </button>
        <span>{c.label}</span>
        {allowed && <span className="muted small">({allowed})</span>}
      </div>
      <div
        className={`an-role ${c.type === "variable" ? "single" : ""} ${over ? `drop-${over}` : ""}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG)) return;
          e.preventDefault();
          setOver("ok");
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => {
          setOver(null);
          const dropped = dragNames(e);
          api.assign(c.type === "variable" ? dropped.slice(0, 1) : dropped, c);
        }}
      >
        {!names.length && <span className="muted small an-role-empty">{c.type === "variable" ? "(없음)" : "비어 있음"}</span>}
        {names.map((n) => {
          const t = typeOf(n);
          return (
            <div
              key={n}
              className={`an-var ${t ? "" : "missing"}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG, JSON.stringify([n]));
                e.dataTransfer.effectAllowed = "move";
              }}
              onDoubleClick={() => api.unassign([n])}
              title={t ? undefined : "이 데이터에 없는 변수입니다"}
            >
              {t ? <VarIcon type={t} /> : <span className="an-vicon" />}
              <span className="ellipsis">{n}</span>
              <button className="an-var-x" title="빼기" onClick={() => api.unassign([n])}>
                ×
              </button>
            </div>
          );
        })}
      </div>
      {hint}
    </div>
  );
}
