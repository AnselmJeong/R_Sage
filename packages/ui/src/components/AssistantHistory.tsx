// Past assistant conversations of this project: search, grouped by age, open, delete, clear all.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ConversationSummary } from "@rsage/shared";
import { clearConversations, deleteConversation, openConversation, useAssistant } from "../assistant";
import { confirmDialog } from "./Dialogs";

const DAY = 24 * 60 * 60 * 1000;

export function groupOf(updatedAt: string, now: Date): string {
  const t = new Date(updatedAt);
  if (t.toDateString() === now.toDateString()) return "오늘";
  if (now.getTime() - t.getTime() < 30 * DAY) return "최근 30일";
  return "이전";
}

export function HistoryMenu({ onClose }: { onClose: () => void }) {
  const conversations = useAssistant((s) => s.conversations);
  const current = useAssistant((s) => s.current);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // Next tick, so the click that opened the menu does not close it.
    const t = setTimeout(() => document.addEventListener("mousedown", down));
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);

  const groups = useMemo(() => {
    const now = new Date();
    const needle = q.trim().toLowerCase();
    const out = new Map<string, ConversationSummary[]>([
      ["오늘", []],
      ["최근 30일", []],
      ["이전", []],
    ]);
    for (const c of conversations) {
      if (needle && !c.title.toLowerCase().includes(needle)) continue;
      out.get(groupOf(c.updatedAt, now))!.push(c);
    }
    return [...out.entries()].filter(([, cs]) => cs.length);
  }, [conversations, q]);

  return (
    <div className="conv-history" ref={ref}>
      <input className="conv-history-search" autoFocus placeholder="대화 검색" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="conv-history-list">
        {groups.length === 0 && <div className="muted small conv-history-empty">{conversations.length ? "찾는 대화가 없습니다" : "저장된 대화가 없습니다"}</div>}
        {groups.map(([label, cs]) => (
          <div key={label}>
            <div className="conv-history-group">{label}</div>
            {cs.map((c) => (
              <div
                key={c.id}
                className={`conv-history-item ${c.id === current?.id ? "sel" : ""}`}
                onClick={() => {
                  void openConversation(c.id);
                  onClose();
                }}
              >
                <span className="ellipsis">{c.title}</span>
                <button
                  className="conv-history-del"
                  title="이 대화 삭제"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (await confirmDialog({ title: "대화 삭제", message: `"${c.title}" 대화를 삭제할까요?`, confirm: "삭제", danger: true }))
                      await deleteConversation(c.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
      {conversations.length > 0 && (
        <button
          className="conv-history-clear"
          onClick={async () => {
            if (await confirmDialog({ title: "대화 모두 지우기", message: `이 프로젝트의 대화 ${conversations.length}개를 모두 삭제할까요?`, confirm: "모두 삭제", danger: true })) {
              await clearConversations();
              onClose();
            }
          }}
        >
          대화 모두 지우기
        </button>
      )}
    </div>
  );
}
