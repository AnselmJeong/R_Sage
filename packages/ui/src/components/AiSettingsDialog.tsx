import { useEffect, useState } from "react";
import { create } from "zustand";
import type { AssistantProviderId, AssistantProviderStatus, SubscriptionQuota } from "@rsage/shared";
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
    note: "구독 대신 API 요금으로 쓰려면 키를 넣으세요.",
  },
  {
    id: "openai",
    label: "GPT (OpenAI)",
    placeholder: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
    note: "구독 대신 API 요금으로 쓰려면 키를 넣으세요.",
  },
];

const SOURCE: Record<string, string> = { keychain: "키체인", file: "설정 파일", env: "환경 변수", login: "로그인됨" };

const SUBSCRIPTIONS: { id: AssistantProviderId; title: string; via: string; account: string; installUrl: string; usageUrl: string; usageLabel: string }[] = [
  {
    id: "claude-code",
    title: "Claude · 구독 연결",
    via: "공식 Claude Code를 통해 Claude 구독 한도를 함께 사용합니다.",
    account: "Claude",
    installUrl: "https://docs.claude.com/en/docs/claude-code/setup",
    usageUrl: "https://claude.ai/settings/usage",
    usageLabel: "Claude 사용량 확인",
  },
  {
    id: "codex",
    title: "GPT · 구독 연결",
    via: "공식 Codex를 통해 ChatGPT 구독 한도를 함께 사용합니다.",
    account: "ChatGPT",
    installUrl: "https://developers.openai.com/codex/cli",
    usageUrl: "https://chatgpt.com/codex/settings/usage",
    usageLabel: "ChatGPT 사용량 확인",
  },
];

const openUrl = (url: string) => void host.call("shell.openExternal", { path: url });

function quotaText(q: SubscriptionQuota) {
  const parts = [q.label];
  if (q.usedPercent !== undefined) parts.push(`${Math.max(0, 100 - q.usedPercent).toFixed(0)}% 남음`);
  if (q.status === "rejected") parts.push("한도 도달");
  else if (q.status === "allowed_warning") parts.push("한도에 가까움");
  if (q.resetsAt) parts.push(`초기화 ${new Date(q.resetsAt * 1000).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`);
  return parts.join(" · ");
}

/** One subscription login, like ScholarPen's connection cards. */
function SubscriptionCard({ spec, st }: { spec: (typeof SUBSCRIPTIONS)[number]; st?: AssistantProviderStatus }) {
  const [busy, setBusy] = useState(false);
  const sub = st?.subscription;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refreshStatus();
    } catch (e: any) {
      useStore.getState().notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const call = (m: "assistant.login" | "assistant.logout" | "assistant.cancelLogin") => act(() => host.call(m, { provider: spec.id }));
  const state = sub?.state;
  let line: string;
  if (!sub) line = "확인 중…";
  else if (state === "connected") line = ["연결됨", sub.email, sub.plan].filter(Boolean).join(" · ");
  else if (state === "signingIn") line = `브라우저에서 ${spec.account} 로그인을 마쳐 주세요.`;
  else if (state === "signedOut") line = `${spec.account} 계정으로 로그인하면 바로 쓸 수 있습니다.`;
  else if (state === "unavailable") line = spec.id === "codex" ? "Codex를 설치해야 합니다." : "Claude Code를 설치해야 합니다.";
  else line = "연결에 문제가 있습니다.";
  return (
    <div className="ai-provider ai-sub">
      <div className="ai-provider-head">
        <strong>{spec.title}</strong>
        {sub?.cliVersion && (
          <span className="muted small" title={sub.cliPath}>
            {spec.id === "codex" ? "Codex" : "Claude Code"} {sub.cliVersion}
          </span>
        )}
      </div>
      <p className="muted small">{spec.via} 유료 API로 자동 전환하지 않습니다.</p>
      <div className={`ai-sub-state ${state === "connected" ? "ok" : state === "error" ? "error" : ""}`}>{line}</div>
      {sub?.error && <div className="error small">{sub.error}</div>}
      <div className="ai-key-row ai-sub-actions">
        {state === "unavailable" && (
          <button className="btn btn-primary" onClick={() => openUrl(spec.installUrl)}>
            설치 안내
          </button>
        )}
        {(state === "signedOut" || state === "error") && (
          <button className="btn btn-primary" disabled={busy} onClick={() => call("assistant.login")}>
            로그인
          </button>
        )}
        {state === "signingIn" && (
          <button className="btn" disabled={busy} onClick={() => call("assistant.cancelLogin")}>
            로그인 취소
          </button>
        )}
        {state === "connected" && (
          <>
            <button className="btn" disabled={busy} onClick={() => call("assistant.login")}>
              계정 변경
            </button>
            <button className="btn" disabled={busy} onClick={() => call("assistant.logout")}>
              로그아웃
            </button>
          </>
        )}
        <button className="btn" disabled={busy} onClick={() => act(() => refreshStatus(true))}>
          새로고침
        </button>
      </div>
      {state === "connected" && (
        <div className="ai-quota small">
          {sub!.quotas.length ? (
            sub!.quotas.map((q) => <div key={q.label}>{quotaText(q)}</div>)
          ) : (
            <div className="muted">{spec.id === "claude-code" ? "남은 사용량은 첫 답변 뒤에 표시됩니다." : "사용량 정보가 없습니다."}</div>
          )}
          <a
            href={spec.usageUrl}
            onClick={(e) => {
              e.preventDefault();
              openUrl(spec.usageUrl);
            }}
          >
            {spec.usageLabel}
          </a>
        </div>
      )}
      <p className="muted small">이 로그인은 R Sage 전용입니다. 터미널의 {spec.id === "codex" ? "codex" : "claude"} 로그인과 따로 관리됩니다.</p>
    </div>
  );
}

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
  // Follow a sign-in in the browser closely, and usage now and then.
  const signingIn = !!status?.providers.some((p) => p.subscription?.state === "signingIn");
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => void refreshStatus().catch(() => {}), signingIn ? 3000 : 30_000);
    return () => clearInterval(t);
  }, [open, signingIn]);
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
        <h4 className="ai-section">구독으로 연결</h4>
        {SUBSCRIPTIONS.map((p) => (
          <SubscriptionCard key={p.id} spec={p} st={status?.providers.find((x) => x.id === p.id)} />
        ))}
        <h4 className="ai-section">API 키로 연결</h4>
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
