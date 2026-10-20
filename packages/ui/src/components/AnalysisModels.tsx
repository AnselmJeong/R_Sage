// Form controls for analyses that compare models built from structured
// terms (regression): model cards with term chips, a model picker, a term
// picker, and a picker for one value of a column. Terms and models are
// options data ({id, kind, variable | components}), never formula text.

import { useEffect, useState } from "react";
import type { AnalysisDataset, AnalysisFormControl } from "@rsage/shared";
import { getPath, setPath } from "@rsage/shared";
import { host } from "../host/client";
import { keyOf, lowerParts, mainId, predictorsOf, termLabel, termVars, type Model, type ModelsControl, type Term } from "../analysisModels";

/** Model cards: terms as chips, + 항 to add a main effect or interaction, copy, rename, delete. */
export function ModelsField({ control: c, options, disabled, onOptions }: { control: ModelsControl; options: any; disabled: boolean; onOptions: (o: any) => void }) {
  const preds = predictorsOf(c, options);
  const terms = ((getPath(options, c.terms) as Term[] | null) ?? []) as Term[];
  const models = ((getPath(options, c.bind) as Model[] | null) ?? []) as Model[];
  const byId = new Map(terms.map((t) => [t.id, t]));
  const outcome = c.outcome ? (getPath(options, c.outcome) as string | null) : null;
  const maxOrder = c.maxOrder ?? 3;
  const save = (ms: Model[], ts: Term[] = terms) => onOptions(setPath(setPath(options, c.terms, ts), c.bind, ms));
  const setModel = (i: number, m: Model, ts?: Term[]) => save(models.map((x, j) => (j === i ? m : x)), ts);

  /** The term for these main components, made (with its lower parts) if new. */
  const ensure = (comps: string[], ts: Term[]): { id: string; ids: string[]; ts: Term[] } => {
    if (comps.length === 1) return { id: comps[0]!, ids: [comps[0]!], ts };
    const k = keyOf(comps);
    let t = ts.find((x) => x.kind === "interaction" && keyOf(x.components ?? []) === k);
    let next = ts;
    if (!t) {
      let n = ts.length + 1;
      while (ts.some((x) => x.id === `i${n}`)) n++;
      t = { id: `i${n}`, kind: "interaction", components: comps };
      next = [...ts, t];
    }
    let ids = [t.id];
    for (const part of lowerParts(comps)) {
      const r = ensure(part, next);
      next = r.ts;
      ids = [...r.ids.filter((x) => !ids.includes(x)), ...ids];
    }
    return { id: t.id, ids, ts: next };
  };
  const addTerm = (i: number, comps: string[]) => {
    const m = models[i]!;
    const r = ensure(comps, terms);
    setModel(i, { ...m, termIds: [...m.termIds, ...r.ids.filter((x) => !m.termIds.includes(x))] }, r.ts);
  };
  /** Removing a term removes the interactions built on it (strong hierarchy). */
  const removeTerm = (i: number, id: string) => {
    const m = models[i]!;
    const gone = new Set(termVars(byId.get(id)!, byId));
    const drop = (t: Term | undefined) => {
      if (!t) return false;
      const v = termVars(t, byId);
      return t.id === id || (v.length > gone.size && [...gone].every((g) => v.includes(g)));
    };
    setModel(i, { ...m, termIds: m.termIds.filter((x) => !drop(byId.get(x))) });
  };
  const allTwoWay = (i: number) => {
    const m = models[i]!;
    const mains = m.termIds.filter((x) => byId.get(x)?.kind === "main");
    let ts = terms;
    let ids = [...m.termIds];
    for (let a = 0; a < mains.length; a++)
      for (let b = a + 1; b < mains.length; b++) {
        const r = ensure([mains[a]!, mains[b]!], ts);
        ts = r.ts;
        for (const x of r.ids) if (!ids.includes(x)) ids.push(x);
      }
    setModel(i, { ...m, termIds: ids }, ts);
  };
  const newId = () => {
    let n = models.length + 1;
    while (models.some((m) => m.id === `m${n}`)) n++;
    return `m${n}`;
  };
  const copy = (i: number) => {
    const id = newId();
    save([...models.slice(0, i + 1), { ...models[i]!, id, label: `${models[i]!.label} 사본` }, ...models.slice(i + 1)]);
  };
  const addModel = () => {
    const id = newId();
    const last = models[models.length - 1];
    save([...models, { id, label: `모형 ${id.slice(1)}`, termIds: last ? [...last.termIds] : preds.map(mainId), intercept: true }]);
  };

  if (!preds.length) return <p className="muted small">설명변수를 넣으면 모형을 만들 수 있습니다.</p>;
  return (
    <div className="an-models">
      {models.map((m, i) => {
        const inModel = new Set(m.termIds);
        const mains = m.termIds.filter((x) => byId.get(x)?.kind === "main");
        const missingMains = preds.map(mainId).filter((x) => !inModel.has(x));
        const combos: string[][] = [];
        for (let a = 0; a < mains.length; a++)
          for (let b = a + 1; b < mains.length; b++) {
            combos.push([mains[a]!, mains[b]!]);
            if (maxOrder >= 3) for (let d = b + 1; d < mains.length; d++) combos.push([mains[a]!, mains[b]!, mains[d]!]);
          }
        const newCombos = combos.filter((cs) => !terms.some((t) => t.kind === "interaction" && keyOf(t.components ?? []) === keyOf(cs) && inModel.has(t.id)));
        const formula = `${outcome ?? "결과"} ~ ${m.termIds.length ? m.termIds.map((x) => (byId.get(x) ? termVars(byId.get(x)!, byId).join(":") : x)).join(" + ") : "1"}${m.intercept === false ? " - 1" : ""}`;
        return (
          <div key={m.id} className="an-model">
            <div className="an-model-head">
              <ModelName value={m.label} disabled={disabled} onCommit={(label) => setModel(i, { ...m, label })} />
              <button className="an-icon-btn" disabled={disabled} title="이 모형 복사" onClick={() => copy(i)}>
                ⧉
              </button>
              <button className="an-icon-btn" disabled={disabled || models.length < 2} title="이 모형 지우기" onClick={() => save(models.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
            <div className="an-chips">
              {m.termIds.map((x) => {
                const t = byId.get(x);
                return (
                  <span key={x} className={`an-chip ${t?.kind === "interaction" ? "int" : ""}`}>
                    {t ? termLabel(t, byId) : x}
                    <button disabled={disabled} title="빼기 (이 항을 포함한 상호작용도 함께 빠집니다)" onClick={() => removeTerm(i, x)}>
                      ✕
                    </button>
                  </span>
                );
              })}
              {!m.termIds.length && <span className="muted small">절편만</span>}
              <select
                className="an-chip-add"
                disabled={disabled || (!missingMains.length && !newCombos.length)}
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "*2") allTwoWay(i);
                  else if (v) addTerm(i, v.split("\u001f"));
                }}
              >
                <option value="">+ 항</option>
                {missingMains.length > 0 && (
                  <optgroup label="주효과">
                    {missingMains.map((x) => (
                      <option key={x} value={x}>
                        {byId.get(x)?.variable ?? x.slice(2)}
                      </option>
                    ))}
                  </optgroup>
                )}
                {newCombos.length > 0 && (
                  <optgroup label="상호작용 (주효과도 함께 들어갑니다)">
                    {mains.length > 2 && <option value="*2">모든 2원 상호작용</option>}
                    {newCombos.map((cs) => (
                      <option key={cs.join()} value={cs.join("\u001f")}>
                        {cs.map((x) => byId.get(x)?.variable).join(" × ")}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <label className="an-check small">
              <input type="checkbox" disabled={disabled} checked={m.intercept !== false} onChange={(e) => setModel(i, { ...m, intercept: e.target.checked })} />
              <span>절편</span>
            </label>
            <code className="an-formula" title="R 공식으로 쓰면">
              {formula}
            </code>
          </div>
        );
      })}
      <button className="btn btn-small" disabled={disabled} onClick={addModel}>
        + 모형 추가
      </button>
    </div>
  );
}

function ModelName({ value, disabled, onCommit }: { value: string; disabled: boolean; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const done = () => v.trim() && v !== value && onCommit(v.trim());
  return (
    <input
      className="an-model-name"
      disabled={disabled}
      value={v}
      title="모형 이름"
      onChange={(e) => setV(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => e.key === "Enter" && done()}
    />
  );
}

/** One of the models, by id. */
export function ModelPicker({ control: c, options, disabled, onChange }: { control: Extract<AnalysisFormControl, { type: "model" }>; options: any; disabled: boolean; onChange: (v: unknown) => void }) {
  const models = ((getPath(options, c.models) as Model[] | null) ?? []) as Model[];
  const value = getPath(options, c.bind) as string | null;
  return (
    <label className={`an-field an-inline${disabled ? " disabled" : ""}`}>
      <span>{c.label}</span>
      <span className="an-colpick">
        <select disabled={disabled} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">{c.emptyLabel ?? "(선택)"}</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

/** Several terms, as chips to toggle. */
export function TermChoice({ control: c, options, disabled, onChange }: { control: Extract<AnalysisFormControl, { type: "termChoice" }>; options: any; disabled: boolean; onChange: (v: unknown) => void }) {
  const terms = ((getPath(options, c.terms) as Term[] | null) ?? []) as Term[];
  const byId = new Map(terms.map((t) => [t.id, t]));
  const value = ((getPath(options, c.bind) as string[] | null) ?? []) as string[];
  return (
    <div className={`an-opt${disabled ? " disabled" : ""}`}>
      <div className="an-rows-label">
        <span>{c.label}</span>
      </div>
      <div className="an-chips">
        {terms.map((t) => {
          const on = value.includes(t.id);
          return (
            <button
              key={t.id}
              className={`an-chip toggle ${on ? "on" : ""} ${t.kind === "interaction" ? "int" : ""}`}
              disabled={disabled}
              onClick={() => onChange(on ? value.filter((x) => x !== t.id) : [...value, t.id])}
            >
              {termLabel(t, byId)}
            </button>
          );
        })}
        {!terms.length && <span className="muted small">항이 없습니다</span>}
      </div>
      {!value.length && c.emptyLabel && <span className="muted small an-desc">{c.emptyLabel}</span>}
    </div>
  );
}

const levelCache = new Map<string, Promise<{ values: string[]; truncated: boolean }>>();

/** A column's values from the R session, refetched when the data set or column changes. */
export function useLevels(dataset: AnalysisDataset | undefined, column: string | null | undefined) {
  const [state, setState] = useState<{ values: string[]; truncated: boolean } | null>(null);
  const key = dataset && column ? `${dataset.name}\u001f${dataset.rows}\u001f${column}` : "";
  useEffect(() => {
    if (!key) return setState(null);
    let live = true;
    if (!levelCache.has(key)) levelCache.set(key, host.call("analysis.levels", { dataset: dataset!.name, column: column! }).catch(() => ({ values: [], truncated: true })));
    void levelCache.get(key)!.then((r) => live && setState(r));
    return () => {
      live = false;
    };
  }, [key]);
  return state;
}

/** A select of the column's values; a text box when there are too many or none could be read. */
export function LevelSelect({
  dataset,
  column,
  value,
  disabled,
  emptyLabel,
  title,
  onChange,
}: {
  dataset?: AnalysisDataset;
  column: string | null | undefined;
  value: string | null;
  disabled: boolean;
  emptyLabel?: string;
  title?: string;
  onChange: (v: string | null) => void;
}) {
  const lv = useLevels(dataset, column);
  if (lv && (lv.truncated || !lv.values.length))
    return <input disabled={disabled} value={value ?? ""} title={title} placeholder="값" onChange={(e) => onChange(e.target.value || null)} />;
  return (
    <select disabled={disabled || !column} value={value ?? ""} title={title} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel ?? "(선택)"}</option>
      {(lv?.values ?? []).map((x) => (
        <option key={x} value={x}>
          {x}
        </option>
      ))}
      {value && lv && !lv.values.includes(value) && <option value={value}>{value} (없음)</option>}
    </select>
  );
}
