import { useEffect, useState } from "react";
import { create } from "zustand";
import type { AssistantProviderId } from "@rsage/shared";
import { host } from "../host/client";
import { useStore } from "../store";
import { refreshStatus, useAssistant } from "../assistant";

export const useAiSettings = create<{ open: boolean }>(() => ({ open: false }));

const PROVIDERS: { id: AssistantProviderId; label: string; placeholder: string; keyUrl: string; note: string }[] = [
  {
    id: "anthropic",
    label: "Claude (Anthropic)",
    placeholder: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
    note: "Anthropic은 외부 앱에서 Claude 구독(Pro/Max) 로그인을 허용하지 않아 API 키로 연결합니다. 사용량은 API 요금으로 청구됩니다.",
  },
  {
    id: "openai",
    label: "GPT (OpenAI)",
    placeholder: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
    note: "ChatGPT 구독으로 로그인(Sign in with ChatGPT)은 OpenAI에 앱 등록 후 제공할 예정입니다. 그때까지는 API 키를 씁니다.",
  },
];

const SOURCE: Record<string, string> = { keychain: "키체인", file: "설정 파일", env: "환경 변수" };

/** App-wide AI connection settings: provider keys and how much the assistant may do alone. */
export function AiSettingsDialog() {
  const open = useAiSettings((s) => s.open);
  const status = useAssistant((s) => s.status);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setKeys({});
      void refreshStatus().catch(() => {});
    }
  }, [open]);
  if (!open) return null;
  const close = () => useAiSettings.setState({ open: false });

  const save = async (provider: AssistantProviderId, key: string | null) => {
    setBusy(provider);
    try {
      await host.call("assistant.setKey", { provider, key });
      setKeys((k) => ({ ...k, [provider]: "" }));
      const s = await refreshStatus(true);
      const p = s.providers.find((x) => x.id === provider);
      if (key && p?.error) useStore.getState().notify(p.error, "error");
      else if (key) useStore.getState().notify(`${p?.label ?? provider} 연결됨`);
    } catch (e: any) {
      useStore.getState().notify(e.message, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog settings ai-settings">
        <h3>AI 연결</h3>
        <p className="muted small">키는 이 Mac의 키체인에 저장되고, 이 앱에서 해당 서비스로 직접 보낼 때만 쓰입니다.</p>
        {PROVIDERS.map((p) => {
          const st = status?.providers.find((x) => x.id === p.id);
          return (
            <div key={p.id} className="ai-provider">
              <div className="ai-provider-head">
                <strong>{p.label}</strong>
                {st?.configured ? (
                  <span className={`badge ${st.error ? "badge-error" : "badge-done"}`}>
                    {st.error ? "오류" : "연결됨"}
                    {st.source ? ` · ${SOURCE[st.source] ?? st.source}` : ""}
                  </span>
                ) : (
                  <span className="badge">연결 안 됨</span>
                )}
              </div>
              {st?.error && <div className="error small">{st.error}</div>}
              <div className="ai-key-row">
                <input
                  className="text-input"
                  type="password"
                  autoComplete="off"
                  placeholder={st?.configured ? "새 키로 바꾸기" : p.placeholder}
                  value={keys[p.id] ?? ""}
                  onChange={(e) => setKeys({ ...keys, [p.id]: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && keys[p.id]?.trim() && save(p.id, keys[p.id]!.trim())}
                />
                <button className="btn btn-primary" disabled={busy === p.id || !keys[p.id]?.trim()} onClick={() => save(p.id, keys[p.id]!.trim())}>
                  {busy === p.id ? "확인 중…" : "저장"}
                </button>
                {st?.configured && st.source !== "env" && (
                  <button className="btn" disabled={busy === p.id} onClick={() => save(p.id, null)}>
                    삭제
                  </button>
                )}
              </div>
              <p className="muted small">
                {p.note}{" "}
                <a href={p.keyUrl} target="_blank" rel="noreferrer">
                  키 만들기
                </a>
              </p>
            </div>
          );
        })}
        <label className="check">
          <input
            type="checkbox"
            checked={status?.autoRunR ?? false}
            onChange={async (e) => {
              await host.call("assistant.setOptions", { autoRunR: e.target.checked });
              await refreshStatus();
            }}
          />
          R 코드를 묻지 않고 실행 (파일 변경은 항상 확인을 받습니다)
        </label>
        <div className="dialog-actions">
          <button className="btn btn-primary" onClick={close}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
