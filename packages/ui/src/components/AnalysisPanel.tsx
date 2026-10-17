// An analysis tab, JASP-style: options on the left, results on the right.
// Every change to the options is saved as a new revision and re-run; the
// results always show the latest finished run.

import { useEffect, useMemo, useRef, useState } from "react";
import type { IDockviewPanelProps } from "dockview";
import type { AnalysisDataset, AnalysisFormControl, AnalysisInstance, AnalysisResult, AnalysisTable } from "@rsage/shared";
import { getPath, setPath } from "@rsage/shared";
import { host } from "../host/client";
import { useStore } from "../store";
import { findDef, insertIntoDocument, prepareModule, refreshDatasets, useAnalyses } from "../analysis";
import { installPackages } from "../packages";
import { RoleBox, VariableSource, isRole, isVisible, roleNames, useRoleApi, type RoleApi } from "./AnalysisVariables";

const notifyError = (e: any) => useStore.getState().notify(e?.message ?? String(e), "error");

/** The JSON Schema node for a dotted option path. */
function schemaAt(schema: any, path: string): any {
  return path.split(".").reduce((s, k) => s?.properties?.[k], schema);
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

  const roles = useMemo(() => (found ? found.def.form.sections.flatMap((sec) => sec.controls).filter(isRole) : []), [found?.def]);
  const ds = datasets.find((d) => d.name === draft?.dataset);
  const setOptions = useRef<(o: any) => void>(() => {});
  const roleApi = useRoleApi(roles, draft?.options, ds?.columns ?? [], (o) => setOptions.current(o));
  useEffect(() => roleApi.setChosen([]), [draft?.dataset]);

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

  setOptions.current = (o) => commit({ ...draft, options: o });
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
    commit({ dataset: name, options });
  };
  const used = new Set(roles.filter((r) => isVisible(r, draft.options)).flatMap((r) => roleNames(r, draft.options)));
  const reason =
    pick && pick.name === draft.dataset ? `자동 선택: ${pick.reason}` : inst.createdBy === "assistant" && draft.dataset === inst.dataset ? "어시스턴트가 지정한 데이터" : null;
  const running = inst.lastRun?.status === "running";
  const stale = inst.result && inst.resultRevision !== inst.revision;
  const rt = runtime === "checking" ? undefined : runtime;

  return (
    <div className="analysis">
      <div className="analysis-options">
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
        {roles.length > 0 && <VariableSource api={roleApi} used={used} />}
        {def.form.sections.map((sec) => (
          <details key={sec.title} className="an-section" open>
            <summary>{sec.title}</summary>
            {sec.controls.map((c) => (
              <Control
                key={c.bind}
                control={c}
                schema={def.schema}
                options={draft.options}
                roleApi={roleApi}
                onChange={(v) => commit({ ...draft, options: setPath(draft.options, c.bind, v) })}
              />
            ))}
          </details>
        ))}
      </div>
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

function Control({
  control: c,
  schema,
  options,
  roleApi,
  onChange,
}: {
  control: AnalysisFormControl;
  schema: any;
  options: any;
  roleApi: RoleApi;
  onChange: (v: unknown) => void;
}) {
  const value = getPath(options, c.bind);
  const s = schemaAt(schema, c.bind) ?? {};
  if (!isVisible(c, options)) return null;
  const hint = c.hint ? <span className="muted small an-hint-line">{c.hint}</span> : null;
  switch (c.type) {
    case "variables":
    case "variable":
      return <RoleBox control={c} api={roleApi} options={options} hint={hint} />;
    case "list":
      return <ListField label={c.label} placeholder={c.placeholder} value={value ?? []} onChange={onChange} hint={hint} />;
    case "text":
      return (
        <label className="an-field">
          <span>{c.label}</span>
          <TextInput value={value ?? ""} placeholder={c.placeholder} onCommit={(v) => onChange(v)} pattern={s.pattern} />
          {hint}
        </label>
      );
    case "checkbox":
      return (
        <label className="an-check">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          <span>{c.label}</span>
          {hint}
        </label>
      );
    case "number":
      return (
        <label className="an-field an-inline">
          <span>{c.label}</span>
          <input
            type="number"
            value={value ?? ""}
            min={s.minimum}
            max={s.maximum}
            step={s.type === "integer" ? 1 : "any"}
            onChange={(e) => {
              const n = s.type === "integer" ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
              if (Number.isFinite(n) && (s.minimum === undefined || n >= s.minimum) && (s.maximum === undefined || n <= s.maximum)) onChange(n);
            }}
          />
        </label>
      );
    case "select":
      return (
        <label className="an-field">
          <span>{c.label}</span>
          <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
            {(s.enum ?? []).map((v: string) => (
              <option key={v} value={v}>
                {c.labels?.[v] ?? v}
              </option>
            ))}
          </select>
          {hint}
        </label>
      );
  }
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
      {result.tables.map((t) => (
        <ResultTable key={t.id} table={t} />
      ))}
      {result.plots.map((p) => (
        <Figure key={p.id} inst={inst} plot={p} />
      ))}
      {result.notes
        .filter((n) => n.level !== "warning")
        .map((n, i) => (
          <div key={i} className="an-note muted">
            {n.text}
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
