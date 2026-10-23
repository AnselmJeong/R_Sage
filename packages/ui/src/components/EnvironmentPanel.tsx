import { useState } from "react";
import type { RVariable } from "@rsage/shared";
import { rpc, useComms } from "../comms";
import { useStore } from "../store";
import { confirmDialog } from "./Dialogs";
import { exploreDataset } from "../hints";

/** Global environment from the variables comm, with expandable children. */
export function EnvironmentPanel() {
  const variables = useComms((s) => s.variables);
  const comm = useComms((s) => s.variablesComm);
  const [filter, setFilter] = useState("");
  const q = filter.toLowerCase();
  const shown = variables.filter((v) => !q || v.display_name.toLowerCase().includes(q));

  const clear = async () => {
    if (!comm) return;
    const ok = await confirmDialog({ title: "환경 비우기", message: "전역 환경의 모든 객체를 삭제할까요?", confirm: "삭제", danger: true });
    if (ok) await rpc(comm, "clear", { include_hidden_objects: false });
  };

  return (
    <div className="env">
      <div className="panel-toolbar">
        <input className="text-input" placeholder="변수 검색" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="btn btn-small" disabled={!comm || variables.length === 0} onClick={clear} title="환경 비우기">
          비우기
        </button>
      </div>
      <div className="env-list">
        {!comm && <div className="empty">R 세션이 시작되면 변수가 여기에 표시됩니다.</div>}
        {comm && shown.length === 0 && <div className="empty">전역 환경이 비어 있습니다.</div>}
        {comm && shown.map((v) => <VarRow key={v.access_key} v={v} path={[v.access_key]} depth={0} comm={comm} />)}
      </div>
    </div>
  );
}

function VarRow({ v, path, depth, comm }: { v: RVariable; path: string[]; depth: number; comm: string }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<RVariable[] | null>(null);
  // Variables update in place; refetch children when the parent changes.
  const [loadedAt, setLoadedAt] = useState(0);

  const toggle = async () => {
    if (!v.has_children) return;
    if (!open && (children === null || loadedAt !== v.updated_time)) {
      try {
        const r = await rpc<{ children: RVariable[] }>(comm, "inspect", { path });
        setChildren(r.children);
        setLoadedAt(v.updated_time);
      } catch (e: any) {
        useStore.getState().notify(e.message, "error");
        return;
      }
    }
    setOpen(!open);
  };

  const view = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await rpc(comm, "view", { path });
    } catch (err: any) {
      useStore.getState().notify(err.message, "error");
    }
  };

  return (
    <>
      <div className="env-row" style={{ paddingLeft: 6 + depth * 14 }} onClick={toggle} title={v.display_value}>
        <span className="env-twisty">{v.has_children ? (open ? "▾" : "▸") : ""}</span>
        <span className="env-name">{v.display_name}</span>
        <span className="env-type muted">{v.display_type}</span>
        <span className="env-value">{v.display_value}</span>
        {v.has_viewer && (
          <button className="btn btn-small env-view" onClick={view} title="데이터 뷰어로 보기">
            표
          </button>
        )}
        {depth === 0 && v.has_viewer && /data\.frame|tbl|tibble|data\.table/i.test(`${v.display_type} ${v.display_value}`) && (
          <button
            className="btn btn-small env-view"
            onClick={(e) => {
              e.stopPropagation();
              void exploreDataset(v.display_name);
            }}
            title="탐색 안내로 이 데이터를 두루 살펴봅니다"
          >
            탐색
          </button>
        )}
      </div>
      {open &&
        children?.map((c) => <VarRow key={c.access_key} v={c} path={[...path, c.access_key]} depth={depth + 1} comm={comm} />)}
    </>
  );
}
