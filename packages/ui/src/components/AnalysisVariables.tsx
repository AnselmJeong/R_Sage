// The variable transfer block every analysis form shares, as in JASP and
// SPSS: the data set's variables in a list on the left, the analysis's
// variable roles (e.g. "변수", "그룹") as boxes on the right, and a ▶ button
// beside each box. Select variables on the left and press ▶ to move them in;
// select them in a box and the button turns to ◀ to move them back.
// Double-click and drag and drop work too.

import { useMemo, useState } from "react";
import type { AnalysisDataset, AnalysisFormControl } from "@rsage/shared";
import { getPath, setPath } from "@rsage/shared";
import { KIND_LABEL, accepts, varKind, type VarKind } from "../analysisVars";

export type RoleControl = Extract<AnalysisFormControl, { type: "variables" | "variable" }>;

const DRAG = "application/x-rsage-vars";

export const isRole = (c: AnalysisFormControl): c is RoleControl => c.type === "variables" || c.type === "variable";

/** Whether a condition on the options holds. */
export function holds(cond: { bind: string; equals?: unknown; in?: unknown[]; filled?: boolean } | undefined, options: any): boolean {
  if (!cond) return true;
  const v = getPath(options, cond.bind);
  if (cond.filled) return Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== "";
  if (cond.in) return cond.in.includes(v);
  return v === cond.equals;
}

/** Names held by a role, whatever its kind. */
export function roleNames(c: RoleControl, options: any): string[] {
  const v = getPath(options, c.bind);
  return c.type === "variables" ? ((v as string[]) ?? []) : v ? [v as string] : [];
}

/** Where the selected variables are: the variable list, or a role box (its bind). */
interface Selection {
  from: string;
  names: string[];
}
const SOURCE = "";

export function TransferBlock({
  roles,
  options,
  columns,
  onOptions,
}: {
  roles: RoleControl[];
  options: any;
  columns: AnalysisDataset["columns"];
  onOptions: (o: any) => void;
}) {
  const [sel, setSel] = useState<Selection>({ from: SOURCE, names: [] });
  const [anchor, setAnchor] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [over, setOver] = useState<string | null>(null);
  const shown = roles.filter((r) => holds(r.visibleWhen, options));
  const used = new Set(shown.flatMap((r) => roleNames(r, options)));
  const typeOf = (n: string) => columns.find((c) => c.name === n)?.type ?? "";
  const canTake = (r: RoleControl, names: string[]) => names.length > 0 && names.every((n) => accepts(r.types, typeOf(n)));
  const free = columns.filter((c) => !used.has(c.name));
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? free.filter((c) => c.name.toLowerCase().includes(s) || KIND_LABEL[varKind(c.type)].includes(s)) : free;
  }, [q, free]);

  const without = (opts: any, names: string[], except?: RoleControl) => {
    for (const r of roles) {
      if (r === except) continue;
      const cur = roleNames(r, opts);
      if (!cur.some((n) => names.includes(n))) continue;
      opts = setPath(opts, r.bind, r.type === "variables" ? cur.filter((n) => !names.includes(n)) : null);
    }
    return opts;
  };
  const assign = (names: string[], to?: RoleControl) => {
    const target =
      to ??
      shown.find((r) => canTake(r, names) && (r.type === "variables" || (names.length === 1 && roleNames(r, options).length === 0))) ??
      shown.find((r) => canTake(r, names));
    if (!target) return;
    const take = target.type === "variable" ? names.slice(0, 1) : names;
    if (!canTake(target, take)) return;
    let opts = without(options, take, target);
    if (target.type === "variables") {
      const cur = roleNames(target, opts);
      opts = setPath(opts, target.bind, [...cur, ...take.filter((n) => !cur.includes(n))]);
    } else {
      opts = setPath(opts, target.bind, take[0]);
    }
    onOptions(opts);
    setSel({ from: SOURCE, names: [] });
  };
  const unassign = (names: string[]) => {
    onOptions(without(options, names));
    setSel({ from: SOURCE, names: [] });
  };

  // Click, ⌘/Ctrl-click and Shift-click selection within one list.
  const click = (e: React.MouseEvent, from: string, name: string, order: string[]) => {
    const same = sel.from === from;
    if (e.shiftKey && same && anchor && order.includes(anchor)) {
      const a = order.indexOf(anchor);
      const b = order.indexOf(name);
      return setSel({ from, names: order.slice(Math.min(a, b), Math.max(a, b) + 1) });
    }
    setAnchor(name);
    if ((e.metaKey || e.ctrlKey) && same) setSel({ from, names: sel.names.includes(name) ? sel.names.filter((n) => n !== name) : [...sel.names, name] });
    else setSel({ from, names: [name] });
  };
  const dragStart = (e: React.DragEvent, from: string, name: string) => {
    const names = sel.from === from && sel.names.includes(name) ? sel.names : [name];
    e.dataTransfer.setData(DRAG, JSON.stringify({ from, names }));
    e.dataTransfer.effectAllowed = "move";
  };
  const dropped = (e: React.DragEvent): Selection => {
    try {
      return JSON.parse(e.dataTransfer.getData(DRAG));
    } catch {
      return { from: SOURCE, names: [] };
    }
  };
  const dropZone = (id: string, onDrop: (s: Selection) => void) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG)) return;
      e.preventDefault();
      setOver(id);
    },
    onDragLeave: () => setOver(null),
    onDrop: (e: React.DragEvent) => {
      setOver(null);
      onDrop(dropped(e));
    },
  });

  const item = (from: string, name: string, order: string[], extra?: JSX.Element) => {
    const t = typeOf(name);
    return (
      <div
        key={name}
        className={`an-var ${sel.from === from && sel.names.includes(name) ? "chosen" : ""} ${t ? "" : "missing"}`}
        draggable
        title={t ? `${name} · ${KIND_LABEL[varKind(t)]}` : "이 데이터에 없는 변수입니다"}
        onDragStart={(e) => dragStart(e, from, name)}
        onClick={(e) => click(e, from, name, order)}
        onDoubleClick={() => (from === SOURCE ? assign([name]) : unassign([name]))}
      >
        {t ? <VarIcon type={t} /> : <span className="an-vicon" />}
        <span className="ellipsis">{name}</span>
        {extra}
      </div>
    );
  };

  return (
    <div className="an-transfer" style={{ gridTemplateRows: `repeat(${shown.length}, auto)` }}>
      <div className="an-tsource" style={{ gridRow: `1 / span ${Math.max(1, shown.length)}` }}>
        {columns.length > 8 && <input className="an-vsearch" placeholder="변수 찾기" value={q} onChange={(e) => setQ(e.target.value)} />}
        <div className={`an-varlist ${over === SOURCE ? "drop" : ""}`} {...dropZone(SOURCE, (s) => s.from !== SOURCE && unassign(s.names))}>
          {!columns.length && <span className="muted small">데이터를 고르면 변수가 나옵니다.</span>}
          {columns.length > 0 && !list.length && <span className="muted small">{q ? "맞는 변수가 없습니다." : "모두 넣었습니다."}</span>}
          {list.map((c) =>
            item(
              SOURCE,
              c.name,
              list.map((x) => x.name),
            ),
          )}
        </div>
        <span className="muted small an-tcount">
          {free.length}/{columns.length}개
        </span>
      </div>
      {shown.map((r, i) => {
        const names = roleNames(r, options);
        const back = sel.from === r.bind && sel.names.length > 0;
        const fwd = sel.from === SOURCE && canTake(r, r.type === "variable" ? sel.names.slice(0, 1) : sel.names);
        const allowed = r.types?.length ? r.types.map((t) => KIND_LABEL[t]).join(", ") : null;
        return [
          <button
            key={`b-${r.bind}`}
            className="an-tarrow"
            style={{ gridRow: i + 1 }}
            disabled={!back && !fwd}
            title={back ? "목록으로 빼기" : fwd ? `${r.label}에 넣기` : allowed && sel.names.length ? `이 칸에는 ${allowed} 변수만 넣을 수 있습니다` : "왼쪽에서 변수를 고르세요"}
            onClick={() => (back ? unassign(sel.names) : assign(sel.names, r))}
          >
            {back ? "◀" : "▶"}
          </button>,
          <div key={`r-${r.bind}`} className="an-trole" style={{ gridRow: i + 1 }}>
            <div className="an-trole-label">
              {r.label}
              {allowed && <span className="muted small"> ({allowed})</span>}
            </div>
            <div
              className={`an-role ${r.type === "variable" ? "single" : ""} ${over === r.bind ? "drop-ok" : ""}`}
              {...dropZone(r.bind, (s) => s.from !== r.bind && assign(s.names, r))}
            >
              {names.map((n) => item(r.bind, n, names))}
            </div>
            {r.hint && <div className="muted small an-hint-line">{r.hint}</div>}
          </div>,
        ];
      })}
    </div>
  );
}

export function VarIcon({ type }: { type: string }) {
  const k = varKind(type);
  return (
    <svg className={`an-vicon an-vicon-${k}`} viewBox="0 0 16 16" aria-label={KIND_LABEL[k]}>
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
