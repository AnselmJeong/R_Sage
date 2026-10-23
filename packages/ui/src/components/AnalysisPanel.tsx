// An analysis tab, JASP-style: options on the left, results on the right.
// Every change to the options is saved as a new revision and re-run; the
// results always show the latest finished run.

import { useEffect, useMemo, useRef, useState } from "react";
import type { IDockviewPanelProps } from "dockview";
import type { AnalysisDataset, AnalysisForm, AnalysisFormControl, AnalysisHint, AnalysisInstance, AnalysisResult, AnalysisShowcase, AnalysisTable } from "@rsage/shared";
import { getPath, setPath } from "@rsage/shared";
import { host } from "../host/client";
import { useStore } from "../store";
import { deleteAnalysis, findDef, insertIntoDocument, prepareModule, refreshDatasets, useAnalyses } from "../analysis";
import { installPackages } from "../packages";
import { openFile } from "../editor/files";
import { TransferBlock, VarIcon, holds, isRole, roleNames, type RoleControl } from "./AnalysisVariables";
import { KIND_LABEL, accepts, varKind } from "../analysisVars";
import { LevelSelect, ModelPicker, ModelsField, TermChoice } from "./AnalysisModels";
import { syncModels } from "../analysisModels";
import { askAboutHint, clearGuide, guideAvailable, insertExplorationLog, openSuggestion, requestGuide, showAssistant, suggestionAvailable } from "../hints";

const notifyError = (e: any) => useStore.getState().notify(e?.message ?? String(e), "error");

/** The JSON Schema node for a dotted option path. */
function schemaAt(schema: any, path: string): any {
  return path.split(".").reduce((s, k) => s?.properties?.[k], schema);
}

/** Variable roles: the form's roles, or (older forms) role controls inside sections. */
function formRoles(form: AnalysisForm): RoleControl[] {
  return form.roles ?? form.sections.flatMap((sec) => sec.controls).filter(isRole);
}

/** Every option a control list binds, sub-options included. */
function bindsIn(controls: AnalysisFormControl[]): string[] {
  return controls.flatMap((c) => (c.type === "group" ? bindsIn(c.controls) : [c.bind, ...(c.type === "checkbox" && c.controls ? bindsIn(c.controls) : [])]));
}

const WIDTH_KEY = "rsage.analysis.optionsWidth";
function storedWidth() {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    if (n >= 260 && n <= 900) return n;
  } catch {}
  return 380;
}

export function AnalysisPanel(props: IDockviewPanelProps<{ id: string }>) {
  const id = props.params.id;
  const inst = useAnalyses((s) => s.instances[id]);
  const datasets = useAnalyses((s) => s.datasets);
  const found = inst ? findDef(inst.analysis) : undefined;
  const runtime = useAnalyses((s) => (found ? s.runtime[found.mod.id] : undefined));
  const sessionState = useStore((s) => s.session.state);
  const pick = useAnalyses((s) => s.picks[id]);
  const [draft, setDraft] = useState<{ dataset: string; options: any } | null>(null);
  const [showCode, setShowCode] = useState<string | null>(null);
  const sent = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const run = async () => {
    try {
      await host.call("analysis.run", { id });
    } catch (e) {
      notifyError(e);
    }
  };

  // Take the saved options unless the user is editing (or a newer revision came from elsewhere, e.g. the assistant).
  useEffect(() => {
    if (inst && (!draft || inst.revision > sent.current)) {
      sent.current = inst.revision;
      setDraft({ dataset: inst.dataset, options: inst.options });
    }
  }, [inst?.revision]);

  useEffect(() => {
    if (found && runtime === undefined) void prepareModule(found.mod.id);
  }, [found?.mod.id, runtime]);

  useEffect(() => {
    void refreshDatasets();
  }, [sessionState === "stopped"]);

  const roles = useMemo(() => (found ? formRoles(found.def.form) : []), [found?.def]);
  const ds = datasets.find((d) => d.name === draft?.dataset);
  // Sections the user opened or closed; the rest follow the form's `open`.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [width, setWidth] = useState(storedWidth);

  // The first run: an analysis opened with a data set and no result yet.
  useEffect(() => {
    if (inst && inst.dataset && !inst.lastRun && runtime && runtime !== "checking" && runtime.ready) void run();
  }, [inst?.id, runtime]);

  if (!inst || !found || !draft) return <div className="analysis-empty muted">분석을 불러오는 중…</div>;
  const { def, mod } = found;

  const commit = (next: { dataset: string; options: any }) => {
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const saved = await host.call("analysis.update", { id, dataset: next.dataset, options: next.options });
        sent.current = saved.revision;
        if (saved.dataset) await host.call("analysis.run", { id });
      } catch (e) {
        notifyError(e);
      }
    }, 450);
  };

  const setOptions = (options: any) => commit({ ...draft, options: syncModels(def.form, options) });
  const turnOn = (sc: AnalysisShowcase) => {
    let o = draft.options;
    for (const [k, v] of Object.entries(sc.enable)) o = setPath(o, k, v);
    setOptions(o);
    const keys = Object.keys(sc.enable);
    setOpen((cur) => ({ ...cur, ...Object.fromEntries(def.form.sections.filter((sec) => bindsIn(sec.controls).some((b) => keys.includes(b))).map((sec) => [sec.title, true])) }));
  };
  const startResize = (e: React.MouseEvent) => {
    const x0 = e.clientX;
    const w0 = width;
    let w = w0;
    const move = (ev: MouseEvent) => setWidth((w = Math.min(900, Math.max(260, w0 + ev.clientX - x0))));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      try {
        localStorage.setItem(WIDTH_KEY, String(w));
      } catch {}
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const chooseDataset = (name: string) => {
    useAnalyses.setState((s) => {
      const { [id]: _, ...rest } = s.picks;
      return { picks: rest };
    });
    // Variables the new data set doesn't have leave their roles.
    const have = new Set(datasets.find((d) => d.name === name)?.columns.map((c) => c.name) ?? []);
    let options = draft.options;
    for (const r of roles) {
      const cur = roleNames(r, options);
      if (cur.every((n) => have.has(n))) continue;
      options = setPath(options, r.bind, r.type === "variables" ? cur.filter((n) => have.has(n)) : null);
    }
    commit({ dataset: name, options: syncModels(def.form, options) });
  };
  const reason =
    pick && pick.name === draft.dataset ? `자동 선택: ${pick.reason}` : inst.createdBy === "assistant" && draft.dataset === inst.dataset ? "어시스턴트가 지정한 데이터" : null;
  const running = inst.lastRun?.status === "running";
  const stale = inst.result && inst.resultRevision !== inst.revision;
  const rt = runtime === "checking" ? undefined : runtime;

  return (
    <div className="analysis">
      <div className="analysis-options" style={{ width }}>
        <div className="analysis-head">
          <strong className="ellipsis" title={def.title}>
            {def.title}
          </strong>
          <span className="muted small">{mod.title} {mod.version}</span>
        </div>
        <label className="an-field">
          <span>데이터</span>
          <select
            value={draft.dataset}
            onMouseDown={() => void refreshDatasets()}
            onChange={(e) => chooseDataset(e.target.value)}
          >
            <option value="">데이터 프레임 선택…</option>
            {datasets.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name} ({d.rows}×{d.columns.length})
              </option>
            ))}
            {draft.dataset && !ds && <option value={draft.dataset}>{draft.dataset} (세션에 없음)</option>}
          </select>
        </label>
        {reason && <p className="muted small an-pick-reason">{reason}. 다른 데이터는 위에서 고르세요.</p>}
        {!draft.dataset && datasets.length > 1 && <p className="muted small">세션에 데이터 프레임이 {datasets.length}개 있습니다. 분석할 것을 고르세요.</p>}
        {!datasets.length && <p className="muted small">R 세션에 데이터 프레임이 없습니다. 데이터를 먼저 불러오세요 (예: <code>df &lt;- read.csv(...)</code>).</p>}
        {def.form.about && <About about={def.form.about} options={draft.options} onTurnOn={turnOn} />}
        {roles.length > 0 && <TransferBlock roles={roles} options={draft.options} columns={ds?.columns ?? []} onOptions={setOptions} />}
        {def.form.sections.map((sec, i) => {
          const controls = sec.controls.filter((c) => !isRole(c));
          if (!controls.length) return null;
          const isOpen = open[sec.title] ?? sec.open ?? i === 0;
          return (
            <section key={sec.title} className={`an-section ${isOpen ? "open" : ""}`}>
              <button className="an-section-head" onClick={() => setOpen({ ...open, [sec.title]: !isOpen })}>
                <span className="an-caret">{isOpen ? "▾" : "▸"}</span>
                {sec.title}
              </button>
              {isOpen && (
                <div className="an-section-body">
                  {sec.description && <p className="muted small an-sec-desc">{sec.description}</p>}
                  <Controls controls={controls} schema={def.schema} options={draft.options} dataset={ds} onOptions={setOptions} />
                </div>
              )}
            </section>
          );
        })}
      </div>
      <div className="analysis-resizer" onMouseDown={startResize} title="옵션 창 너비" />
      <div className="analysis-results">
        <div className="analysis-toolbar">
          <span className={`an-status an-${inst.lastRun?.status ?? "none"}`}>
            {running ? "실행 중…" : inst.lastRun?.status === "error" ? "실패" : inst.lastRun?.status === "cancelled" ? "취소됨" : stale ? "이전 옵션의 결과" : ""}
          </span>
          <span className="spacer" />
          {running ? (
            <button className="btn btn-small" onClick={() => void host.call("analysis.cancel", { id })}>
              중단
            </button>
          ) : (
            <button className="btn btn-small btn-primary" disabled={!draft.dataset || !rt?.ready} onClick={() => void run()}>
              실행
            </button>
          )}
          <button
            className="btn btn-small"
            onClick={async () => setShowCode(showCode === null ? await host.call("analysis.code", { id }).catch((e) => (notifyError(e), null)) : null)}
          >
            R 코드
          </button>
          <DeleteButton disabled={running} onDelete={() => void deleteAnalysis(id)} />
        </div>
        {showCode !== null && (
          <div className="an-code">
            <pre>{showCode}</pre>
            <div className="an-code-actions">
              <button className="btn btn-small" onClick={() => void navigator.clipboard.writeText(showCode).then(() => useStore.getState().notify("복사했습니다."))}>
                복사
              </button>
              <button className="btn btn-small" onClick={() => insertIntoDocument(showCode, `${def.id}-${inst.id.slice(2)}`)}>
                문서에 넣기
              </button>
              <span className="muted small">Quarto에서는 같은 표와 그림이 출력됩니다.</span>
            </div>
          </div>
        )}
        <RuntimeBanner moduleId={mod.id} />
        {inst.lastRun?.status === "error" && <div className="an-note an-warning">{inst.lastRun.error?.message}</div>}
        {!draft.dataset && <p className="muted an-hint">왼쪽에서 분석할 데이터 프레임을 고르세요.</p>}
        {inst.result && <ResultView inst={inst} result={inst.result} dim={running || !!stale} />}
      </div>
    </div>
  );
}

function RuntimeBanner({ moduleId }: { moduleId: string }) {
  const rt = useAnalyses((s) => s.runtime[moduleId]);
  const mod = useAnalyses((s) => s.modules.find((m) => m.id === moduleId));
  const [busy, setBusy] = useState(false);
  if (rt === "checking") return <div className="an-note muted">R 패키지 확인 중… (처음에는 분석 패키지를 설치합니다)</div>;
  if (!rt || !mod) return null;
  const install = async (pkgs: string[]) => {
    setBusy(true);
    try {
      await installPackages(pkgs);
      await prepareModule(moduleId);
    } finally {
      setBusy(false);
    }
  };
  if (rt.error) return <div className="an-note an-warning">{rt.error}</div>;
  if (rt.missing.length)
    return (
      <div className="an-note an-warning">
        이 분석에 필요한 R 패키지가 없습니다: <strong>{rt.missing.join(", ")}</strong>{" "}
        <button className="btn btn-small" disabled={busy} onClick={() => void install(rt.missing)}>
          콘솔에서 설치
        </button>
      </div>
    );
  if (rt.missingOptional.length) {
    const roles = mod.backends.filter((b) => rt.missingOptional.includes(b.package));
    return (
      <div className="an-note">
        설치하면 더 쓸 수 있는 패키지: {roles.map((b) => `${b.package} (${b.role})`).join(", ")}{" "}
        <button className="btn btn-small" disabled={busy} onClick={() => void install(rt.missingOptional)}>
          설치
        </button>
      </div>
    );
  }
  return null;
}

/** What the analysis can do: the backend package's showcased uses, each one click away. */
function About({ about, options, onTurnOn }: { about: NonNullable<AnalysisForm["about"]>; options: any; onTurnOn: (sc: AnalysisShowcase) => void }) {
  const [open, setOpen] = useState(false);
  const isOn = (sc: AnalysisShowcase) => !sc.planned && Object.entries(sc.enable).every(([k, v]) => getPath(options, k) === v);
  const n = about.showcase?.length ?? 0;
  return (
    <div className={`an-about ${open ? "open" : ""}`}>
      <button className="an-about-head" onClick={() => setOpen(!open)}>
        <span className="an-caret">{open ? "▾" : "▸"}</span>
        이 분석으로 할 수 있는 것{n ? ` (${n})` : ""}
      </button>
      {open && (
        <div className="an-about-body">
          {about.summary && <p className="small">{about.summary}</p>}
          {about.showcase?.map((sc) => {
            const on = isOn(sc);
            return (
              <div key={sc.title} className={`an-showcase ${on ? "on" : ""}`}>
                <div className="an-showcase-text">
                  <strong>{sc.title}</strong>
                  <span className="muted small">{sc.description}</span>
                  {sc.fn && (
                    <span className="an-fns">
                      {sc.fn.map((f) => (
                        <code key={f}>{f}</code>
                      ))}
                    </span>
                  )}
                  {on && sc.needs && (sc.needsFilled ?? []).some((b) => !holds({ bind: b, filled: true }, options)) && <span className="small an-needs">{sc.needs}</span>}
                </div>
                {sc.planned ? (
                  <span className="an-planned small" title="다음 버전에서 씁니다">
                    예정
                  </span>
                ) : (
                  <button className="btn btn-small" disabled={on} onClick={() => onTurnOn(sc)}>
                    {on ? "켜짐" : "켜기"}
                  </button>
                )}
              </div>
            );
          })}
          {!!about.links?.length && (
            <div className="an-links small">
              {about.links.map((l) => (
                <a key={l.url} href={l.url} onClick={(e) => (e.preventDefault(), void host.call("shell.openExternal", { path: l.url }))}>
                  {l.label} ↗
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Controls({
  controls,
  schema,
  options,
  dataset,
  onOptions,
  disabled = false,
}: {
  controls: AnalysisFormControl[];
  schema: any;
  options: any;
  dataset?: AnalysisDataset;
  onOptions: (o: any) => void;
  disabled?: boolean;
}) {
  return (
    <>
      {controls.map((c) => {
        if (!holds(c.visibleWhen, options)) return null;
        if (c.type === "group")
          return (
            <div key={`g:${c.label}`} className="an-group">
              <div className="an-group-label">{c.label}</div>
              {c.description && <p className="muted small an-desc">{c.description}</p>}
              <Controls controls={c.controls} schema={schema} options={options} dataset={dataset} onOptions={onOptions} disabled={disabled} />
            </div>
          );
        if (isRole(c)) return null;
        const off = disabled || !holds(c.enabledWhen, options);
        if (c.type === "models") return <ModelsField key={c.bind} control={c} options={options} disabled={off} onOptions={onOptions} />;
        return (
          <Control
            key={c.bind}
            control={c}
            schema={schema}
            options={options}
            dataset={dataset}
            disabled={off}
            onChange={(v) => onOptions(setPath(options, c.bind, v))}
          >
            {c.type === "checkbox" && c.controls && (
              <div className="an-sub">
                <Controls controls={c.controls} schema={schema} options={options} dataset={dataset} onOptions={onOptions} disabled={off || !getPath(options, c.bind)} />
              </div>
            )}
          </Control>
        );
      })}
    </>
  );
}

/** Tags after a label: the backend function and packages the option needs. */
function Tags({ c }: { c: Exclude<AnalysisFormControl, { type: "group" }> }) {
  if (!c.fn && !c.requires?.length) return null;
  return (
    <span className="an-fns">
      {c.fn && <code>{c.fn}</code>}
      {c.requires?.map((p) => (
        <span key={p} className="an-req" title={`${p} 패키지가 필요합니다`}>
          {p}
        </span>
      ))}
    </span>
  );
}

function Control({
  control: c,
  schema,
  options,
  dataset,
  disabled,
  onChange,
  children,
}: {
  control: Exclude<AnalysisFormControl, { type: "group" }>;
  schema: any;
  options: any;
  dataset?: AnalysisDataset;
  disabled: boolean;
  onChange: (v: unknown) => void;
  children?: React.ReactNode;
}) {
  const value = getPath(options, c.bind);
  const s = schemaAt(schema, c.bind) ?? {};
  const why = disabled && c.disabledHint && !holds(c.enabledWhen, options) ? <span className="small an-needs">{c.disabledHint}</span> : null;
  const desc = c.description ? <span className="muted small an-desc">{c.description}</span> : null;
  const hint = c.hint ? <span className="muted small an-hint-line">{c.hint}</span> : null;
  const cls = disabled ? " disabled" : "";
  switch (c.type) {
    case "checkbox":
      return (
        <div className={`an-opt${cls}`}>
          <label className="an-check">
            <input type="checkbox" disabled={disabled} checked={!!value} onChange={(e) => onChange(e.target.checked)} />
            <span>{c.label}</span>
            <Tags c={c} />
          </label>
          {desc}
          {why}
          {children}
        </div>
      );
    case "model":
      return <ModelPicker control={c} options={options} disabled={disabled} onChange={onChange} />;
    case "termChoice":
      return <TermChoice control={c} options={options} disabled={disabled} onChange={onChange} />;
    case "level":
      return (
        <div className={`an-opt${cls}`}>
          <label className="an-field an-inline">
            <span>{c.label}</span>
            <span className="an-colpick">
              <LevelSelect dataset={dataset} column={getPath(options, c.column) as string | null} value={(value as string) ?? null} disabled={disabled} emptyLabel={c.emptyLabel} onChange={onChange} />
            </span>
          </label>
          {desc}
        </div>
      );
    case "column": {
      const only = c.from ? new Set(c.from.flatMap((b) => [getPath(options, b)].flat().filter(Boolean) as string[])) : null;
      const cols = (dataset?.columns ?? []).filter((x) => accepts(c.types, x.type) && (!only || only.has(x.name)));
      const col = dataset?.columns.find((x) => x.name === value);
      return (
        <label className={`an-field an-inline${cls}`}>
          <span>{c.label}</span>
          <span className="an-colpick">
            {col && <VarIcon type={col.type} />}
            <select disabled={disabled} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
              <option value="">{c.emptyLabel ?? "(선택)"}</option>
              {cols.map((x) => (
                <option key={x.name} value={x.name}>
                  {x.name} · {KIND_LABEL[varKind(x.type)]}
                </option>
              ))}
              {value && !cols.some((x) => x.name === value) && <option value={value}>{value} (없음)</option>}
            </select>
          </span>
        </label>
      );
    }
    case "rows":
      return (
        <div className={`an-opt${cls}`}>
          <div className="an-rows-label">
            <span>{c.label}</span>
            <Tags c={c} />
          </div>
          {desc}
          {why}
          <RowsField control={c} item={s.items ?? {}} value={value ?? []} dataset={dataset} disabled={disabled} onChange={onChange} />
          {hint}
        </div>
      );
    case "list":
      return (
        <div className={`an-opt${cls}`}>
          <ListField label={c.label} placeholder={c.placeholder} value={value ?? []} onChange={onChange} hint={hint} />
          {desc}
        </div>
      );
    case "text":
      return (
        <label className={`an-field${cls}`}>
          <span>{c.label}</span>
          <TextInput value={value ?? ""} placeholder={c.placeholder} onCommit={(v) => onChange(v)} pattern={s.pattern} />
          {desc}
          {hint}
        </label>
      );
    case "number":
      return (
        <label className={`an-field an-inline${cls}`}>
          <span>
            {c.label}
            {c.hint && <span className="muted small"> · {c.hint}</span>}
          </span>
          <span className="an-num">
            <input
              type="number"
              disabled={disabled}
              value={value ?? ""}
              min={s.minimum}
              max={s.maximum}
              step={s.type === "integer" ? 1 : "any"}
              onChange={(e) => {
                const n = s.type === "integer" ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
                if (Number.isFinite(n) && (s.minimum === undefined || n >= s.minimum) && (s.maximum === undefined || n <= s.maximum)) onChange(n);
              }}
            />
            {c.unit && <span className="muted small">{c.unit}</span>}
          </span>
        </label>
      );
    case "select": {
      const by = c.choicesBy ? c.choicesBy.values[String(getPath(options, c.choicesBy.bind))] : undefined;
      const choices: string[] = by ? (s.enum ?? []).filter((v: string) => by.includes(v)) : (s.enum ?? []);
      return (
        <label className={`an-field${cls}`}>
          <span>{c.label}</span>
          <select disabled={disabled || choices.length < 2} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
            {choices.map((v: string) => (
              <option key={v} value={v}>
                {c.labels?.[v] ?? v}
              </option>
            ))}
          </select>
          {desc}
          {hint}
        </label>
      );
    }
  }
  return null;
}

/**
 * Rule rows: one line per rule with a picker or text box per field, a ✕ to
 * remove it, and a button to add one. Field names head the columns once.
 */
function RowsField({
  control: c,
  item,
  value,
  dataset,
  disabled,
  onChange,
}: {
  control: Extract<AnalysisFormControl, { type: "rows" }>;
  item: any;
  value: Record<string, unknown>[];
  dataset?: AnalysisDataset;
  disabled: boolean;
  onChange: (v: Record<string, unknown>[]) => void;
}) {
  const props = item.properties ?? {};
  const blank = () => Object.fromEntries(c.fields.map((f) => [f.key, props[f.key]?.default ?? (f.type === "column" || f.type === "level" ? null : "")]));
  const set = (i: number, key: string, v: unknown) => onChange(value.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  const grid = { gridTemplateColumns: `${c.fields.map((f) => (f.type === "select" ? "64px" : "minmax(0, 1fr)")).join(" ")} 18px` };
  return (
    <div className="an-rows">
      {value.length > 0 && (
        <div className="an-rows-grid an-rows-head muted small" style={grid}>
          {c.fields.map((f) => (
            <span key={f.key}>{f.label}</span>
          ))}
          <span />
        </div>
      )}
      {value.map((row, i) => (
        <div key={i} className="an-rows-grid" style={grid}>
          {c.fields.map((f) => {
            const v = row[f.key];
            if (f.type === "column") {
              const cols = (dataset?.columns ?? []).filter((x) => accepts(f.types, x.type));
              return (
                <select key={f.key} disabled={disabled} value={(v as string) ?? ""} title={f.label} onChange={(e) => set(i, f.key, e.target.value || null)}>
                  <option value="">{f.emptyLabel ?? "(선택)"}</option>
                  {cols.map((x) => (
                    <option key={x.name} value={x.name}>
                      {x.name}
                    </option>
                  ))}
                  {typeof v === "string" && v && !cols.some((x) => x.name === v) && <option value={v}>{v} (없음)</option>}
                </select>
              );
            }
            if (f.type === "level")
              return (
                <LevelSelect
                  key={f.key}
                  dataset={dataset}
                  column={f.column ? (row[f.column] as string | null) : null}
                  value={(v as string) ?? null}
                  disabled={disabled}
                  title={f.label}
                  emptyLabel={f.emptyLabel}
                  onChange={(t) => set(i, f.key, t)}
                />
              );
            if (f.type === "select")
              return (
                <select key={f.key} disabled={disabled} value={(v as string) ?? ""} title={f.label} onChange={(e) => set(i, f.key, e.target.value)}>
                  {(props[f.key]?.enum ?? []).map((o: string) => (
                    <option key={o} value={o}>
                      {f.labels?.[o] ?? o}
                    </option>
                  ))}
                </select>
              );
            return <TextInput key={f.key} value={(v as string) ?? ""} placeholder={f.placeholder} onCommit={(t) => set(i, f.key, t)} />;
          })}
          <button className="an-rows-del" disabled={disabled} title="이 규칙 지우기" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button className="btn btn-small an-rows-add" disabled={disabled} onClick={() => onChange([...value, blank()])}>
        + {c.addLabel ?? "추가"}
      </button>
    </div>
  );
}

/** Text that is saved when the user stops typing (on blur or Enter), not on every key. */
function TextInput({ value, placeholder, onCommit, pattern }: { value: string; placeholder?: string; onCommit: (v: string) => void; pattern?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const ok = !pattern || new RegExp(pattern).test(v);
  const done = () => ok && v !== value && onCommit(v);
  return (
    <input
      className={ok ? "" : "invalid"}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => e.key === "Enter" && done()}
    />
  );
}

/** Comma-separated values; "" stands for the empty string. */
function ListField({ label, placeholder, value, onChange, hint }: { label: string; placeholder?: string; value: string[]; onChange: (v: string[]) => void; hint: JSX.Element | null }) {
  const text = value.map((x) => (x === "" ? '""' : x)).join(", ");
  return (
    <label className="an-field">
      <span>{label}</span>
      <TextInput
        value={text}
        placeholder={placeholder}
        onCommit={(t) =>
          onChange(
            t
              .split(",")
              .map((x) => x.trim())
              .filter((x) => x.length)
              .map((x) => (x === '""' || x === "''" ? "" : x)),
          )
        }
      />
      {hint}
    </label>
  );
}

function ResultView({ inst, result, dim }: { inst: AnalysisInstance; result: AnalysisResult; dim: boolean }) {
  return (
    <div className={`an-result ${dim ? "dim" : ""}`}>
      {result.notes
        .filter((n) => n.level === "warning")
        .map((n, i) => (
          <div key={i} className="an-note an-warning">
            {n.text}
          </div>
        ))}
      {(!!result.hints?.length || guideAvailable(inst)) && <HintCards inst={inst} result={result} />}
      {resultSections(result).map((sec) => (
        <div key={sec.name || "_"} className="an-rsection">
          {sec.name && resultSections(result).length > 1 && <h2 className="an-rsection-title">{sec.name}</h2>}
          {sec.tables.map((t) => (
            <ResultTable key={t.id} table={t} />
          ))}
          {sec.plots.map((p) => (
            <Figure key={p.id} inst={inst} plot={p} />
          ))}
        </div>
      ))}
      {result.notes
        .filter((n) => n.level !== "warning")
        .map((n, i) => (
          <div key={i} className="an-note muted">
            {n.text}
            {n.file && (
              <button className="btn btn-small an-note-open" onClick={() => void openFile(n.file!)}>
                열기
              </button>
            )}
          </div>
        ))}
      <div className="muted small an-prov">
        {result.dataInfo.dataset} · {result.dataInfo.rows}행 × {result.dataInfo.columns}열 · {result.provenance.r}
        {result.provenance.packages &&
          " · " +
            Object.entries(result.provenance.packages)
              .map(([k, v]) => `${k} ${v}`)
              .join(", ")}
      </div>
    </div>
  );
}

const EXPLORE_KEY = "org.rsage.explore/explore";

/** Hint cards: what was found, its numbers and figure, and where to go next. */
function HintCards({ inst, result }: { inst: AnalysisInstance; result: AnalysisResult }) {
  const plots = new Map(result.plots.map((p) => [p.id, p]));
  const guide = inst.guide;
  const cards = (hints: AnalysisHint[]) => (
    <div className="an-hints">
      {hints.map((h) => (
        <HintCard key={h.id} inst={inst} hint={h} plot={h.plot ? plots.get(h.plot) : undefined} />
      ))}
    </div>
  );
  const rules = result.hints ?? [];
  return (
    <div className="an-rsection">
      <h2 className="an-rsection-title">
        살펴볼 만한 것
        {inst.analysis === EXPLORE_KEY && (
          <button
            className="btn btn-small an-rsection-action"
            onClick={() => void insertExplorationLog(inst)}
            title="보이는 카드, 질문, 카드에서 연 분석과 R 청크를 열린 .qmd에 넣습니다"
          >
            탐색 기록 넣기
          </button>
        )}
      </h2>
      {guideAvailable(inst) && <GuideBar inst={inst} result={result} />}
      {!!guide?.hints.length && cards(guide.hints)}
      {guide?.hints.length ? (
        !!rules.length && (
          <details className="an-hint-rules">
            <summary>규칙으로 찾은 카드 {rules.length}장</summary>
            {cards(rules)}
          </details>
        )
      ) : (
        cards(rules)
      )}
    </div>
  );
}

/** Question box, question chips and guessed variable meanings for assistant-written hints. */
function GuideBar({ inst, result }: { inst: AnalysisInstance; result: AnalysisResult }) {
  const guide = inst.guide;
  const [question, setQuestion] = useState(guide?.question ?? "");
  useEffect(() => setQuestion(guide?.question ?? ""), [guide?.createdAt]);
  const stale = !!guide && guide.runId !== result.runId;
  const ask = (q: string) => {
    setQuestion(q);
    void requestGuide(inst, q);
  };
  return (
    <div className="an-guide">
      <div className="an-guide-ask">
        <input
          className="an-guide-input"
          value={question}
          placeholder="궁금한 것을 적으세요. 예: 치료 반응과 관련된 요인이 궁금해요 (비워 두면 두루 살펴봅니다)"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) ask(question);
          }}
        />
        <button className="btn btn-small btn-primary" onClick={() => ask(question)} title="어시스턴트가 신호 표에서 질문에 맞는 것을 골라 카드로 정리합니다">
          {guide ? "힌트 다시 받기" : "힌트 받기"}
        </button>
        {guide && (
          <button className="btn btn-small" onClick={() => void clearGuide(inst)} title="어시스턴트가 쓴 카드를 지우고 규칙 카드만 봅니다">
            지우기
          </button>
        )}
      </div>
      {guide && (
        <div className="muted small">
          어시스턴트가 신호 표에서 골라 쓴 카드입니다. 숫자는 R이 계산한 신호에서만 가져왔습니다.
          {stale && <span className="an-guide-stale"> 이전 결과 기준이라 지금 신호와 다를 수 있습니다.</span>}
        </div>
      )}
      {guide?.ask && (
        <div className="an-note an-guide-question">
          <b>어시스턴트의 질문:</b> {guide.ask}
          <button className="btn btn-small an-note-open" onClick={() => showAssistant()}>
            답하기
          </button>
        </div>
      )}
      {!!guide?.questions.length && (
        <div className="an-guide-chips">
          {guide.questions.map((q) => (
            <button key={q} className="an-qchip" onClick={() => ask(q)} title="이 질문으로 카드를 다시 받습니다">
              {q}
            </button>
          ))}
        </div>
      )}
      {!!guide?.variables.length && (
        <details className="an-guide-vars">
          <summary>변수 뜻 (추측) {guide.variables.length}개</summary>
          <ul>
            {guide.variables.map((v) => (
              <li key={v.name}>
                <code>{v.name}</code> {v.meaning}
                {v.role && <span className="muted"> · {v.role}</span>}
              </li>
            ))}
          </ul>
          <div className="muted small">이름과 범주로 짐작한 것입니다. 틀리면 어시스턴트에게 알려 주세요.</div>
        </details>
      )}
    </div>
  );
}

function HintCard({ inst, hint, plot }: { inst: AnalysisInstance; hint: AnalysisHint; plot?: Plot }) {
  return (
    <article className="an-hint-card">
      <h3>{hint.title}</h3>
      {hint.evidence && <div className="muted small an-hint-evidence">{hint.evidence}</div>}
      <p>{hint.text}</p>
      {plot && <img className="an-hint-plot" src={plot.src} alt={plot.alt} style={{ aspectRatio: `${plot.width} / ${plot.height}` }} />}
      <div className="an-hint-actions">
        {hint.suggestions.map((s, i) =>
          suggestionAvailable(s) ? (
            <button key={i} className="btn btn-small btn-primary" onClick={() => void openSuggestion(inst, s, hint.id)} title="옵션을 채운 새 분석 탭을 엽니다">
              {s.label}
            </button>
          ) : (
            <span key={i} className="an-hint-planned" title="아직 이 앱에 없는 분석입니다">
              {s.label} · 예정
            </span>
          ),
        )}
        <button className="btn btn-small" onClick={() => void askAboutHint(inst, hint)} title="이 카드를 어시스턴트에게 넘겨 더 살펴봅니다">
          어시스턴트에게 묻기
        </button>
      </div>
    </article>
  );
}

/** Tables and plots grouped by section, in the result's section order (unsectioned first). Plots on hint cards are left out. */
function resultSections(result: AnalysisResult) {
  const onCards = new Set((result.hints ?? []).map((h) => h.plot).filter(Boolean));
  const plots = result.plots.filter((p) => !onCards.has(p.id));
  const names = [...new Set(["", ...(result.sections ?? []), ...result.tables.map((t) => t.section ?? ""), ...plots.map((p) => p.section ?? "")])];
  return names
    .map((name) => ({ name, tables: result.tables.filter((t) => (t.section ?? "") === name), plots: plots.filter((p) => (p.section ?? "") === name) }))
    .filter((s) => s.tables.length || s.plots.length);
}

function fmt(v: unknown, type: string): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (type === "integer" || Number.isInteger(v)) return String(v);
    if (Math.abs(v) < 0.001 && v !== 0) return v.toExponential(2);
    return v.toFixed(Math.abs(v) >= 100 ? 1 : 3);
  }
  if (typeof v === "boolean") return v ? "예" : "아니오";
  return String(v);
}

function ResultTable({ table }: { table: AnalysisTable }) {
  const numeric = useMemo(() => new Set(table.columns.filter((c) => c.type === "number" || c.type === "integer").map((c) => c.id)), [table]);
  return (
    <section className="an-table">
      <h3>{table.title}</h3>
      {table.description && <p className="muted small an-read">{table.description}</p>}
      <div className="an-table-scroll">
        <table>
          <thead>
            <tr>
              {table.columns.map((c) => (
                <th key={c.id} className={numeric.has(c.id) ? "num" : ""}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>
                {table.columns.map((c) => (
                  <td key={c.id} className={numeric.has(c.id) ? "num" : ""}>
                    {fmt(r[c.id], c.type)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.notes.map((n, i) => (
        <p key={i} className="muted small an-table-note">
          {n}
        </p>
      ))}
    </section>
  );
}

type Plot = AnalysisResult["plots"][number];

/** CSS pixels per inch: a figure at 100% shows at the size it prints. */
const PX_PER_IN = 96;

const ASPECTS: { label: string; ratio: number }[] = [
  { label: "가로 16:9", ratio: 9 / 16 },
  { label: "가로 4:3", ratio: 3 / 4 },
  { label: "정사각", ratio: 1 },
  { label: "세로 3:4", ratio: 4 / 3 },
];

/**
 * A result figure with its size controls. The module picks a size from what
 * the figure shows; the user can pick an aspect or type a size in inches,
 * which re-runs the analysis and draws the figure again at that size (so
 * text keeps its point size instead of being stretched). "실제 크기" shows it
 * as it prints; "플롯 창" redraws it in the Plots pane, with its own fit,
 * aspect and Save Plot.
 */
function Figure({ inst, plot }: { inst: AnalysisInstance; plot: Plot }) {
  const custom = !!inst.figures?.[plot.id];
  const [actual, setActual] = useState(false);
  const [editing, setEditing] = useState(false);
  const [w, setW] = useState(String(plot.width));
  const [h, setH] = useState(String(plot.height));
  useEffect(() => {
    setW(String(plot.width));
    setH(String(plot.height));
  }, [plot.width, plot.height]);

  const resize = async (size: { width: number; height: number } | null) => {
    const figures: Record<string, { width: number; height: number } | null> = { ...(inst.figures ?? {}), [plot.id]: size };
    try {
      await host.call("analysis.update", { id: inst.id, figures });
      await host.call("analysis.run", { id: inst.id });
    } catch (e) {
      notifyError(e);
    }
  };
  const round = (x: number) => Math.round(x * 10) / 10;

  return (
    <figure className="an-plot">
      <figcaption>
        <span>{plot.title}</span>
        <span className="spacer" />
        <span className="muted small" title="인치 (너비 × 높이)">
          {plot.width} × {plot.height} in{custom ? "" : " · 자동"}
        </span>
        <select
          className="an-fig-select"
          value=""
          title="그림 크기"
          onChange={(e) => {
            const v = e.target.value;
            if (v === "auto") void resize(null);
            else if (v === "custom") setEditing(true);
            else if (v.startsWith("r:")) void resize({ width: plot.width, height: round(plot.width * Number(v.slice(2))) });
            else if (v === "bigger") void resize({ width: round(plot.width * 1.25), height: round(plot.height * 1.25) });
            else if (v === "smaller") void resize({ width: round(plot.width * 0.8), height: round(plot.height * 0.8) });
          }}
        >
          <option value="">크기…</option>
          <option value="auto" disabled={!custom}>
            자동 ({plot.autoWidth} × {plot.autoHeight})
          </option>
          {ASPECTS.map((a) => (
            <option key={a.label} value={`r:${a.ratio}`}>
              {a.label}
            </option>
          ))}
          <option value="bigger">크게 (글자는 상대적으로 작게)</option>
          <option value="smaller">작게 (글자는 상대적으로 크게)</option>
          <option value="custom">직접 입력…</option>
        </select>
        <button className="btn btn-small" onClick={() => setActual(!actual)} title="인쇄될 크기로 보기 / 탭 너비에 맞추기">
          {actual ? "맞춤" : "실제 크기"}
        </button>
        <button
          className="btn btn-small"
          disabled={!plot.rds}
          title="플롯 창에서 열기: 창 크기에 맞추기, 비율, 그림 저장(PNG·SVG·PDF…)"
          onClick={() => void host.call("analysis.showPlot", { id: inst.id, plotId: plot.id }).catch(notifyError)}
        >
          플롯 창
        </button>
      </figcaption>
      {plot.description && <p className="muted small an-read">{plot.description}</p>}
      {editing && (
        <div className="an-fig-size">
          <label>
            너비 <input type="number" min={1} max={30} step={0.5} value={w} onChange={(e) => setW(e.target.value)} /> in
          </label>
          <label>
            높이 <input type="number" min={1} max={30} step={0.5} value={h} onChange={(e) => setH(e.target.value)} /> in
          </label>
          <button
            className="btn btn-small btn-primary"
            onClick={() => {
              const width = Number(w);
              const height = Number(h);
              if (width > 0 && height > 0) {
                setEditing(false);
                void resize({ width, height });
              }
            }}
          >
            적용
          </button>
          <button className="btn btn-small" onClick={() => setEditing(false)}>
            취소
          </button>
        </div>
      )}
      <div className={`an-plot-frame ${actual ? "actual" : ""}`}>
        <img
          src={plot.src}
          alt={plot.alt}
          style={actual ? { width: plot.width * PX_PER_IN } : { width: "100%", maxWidth: plot.width * PX_PER_IN, aspectRatio: `${plot.width} / ${plot.height}` }}
        />
      </div>
    </figure>
  );
}

/** Deletes on a second click, since a dialog may not show in the app's web view. */
function DeleteButton({ disabled, onDelete }: { disabled?: boolean; onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`btn btn-small ${armed ? "btn-danger" : ""}`}
      disabled={disabled}
      title="이 분석과 결과를 프로젝트에서 지웁니다"
      onClick={() => (armed ? onDelete() : setArmed(true))}
    >
      {armed ? "한 번 더 누르면 삭제" : "삭제"}
    </button>
  );
}
