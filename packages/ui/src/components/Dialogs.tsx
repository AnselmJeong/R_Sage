// Promise-based confirm/prompt dialogs rendered by <DialogHost />.

import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

interface ConfirmOpts {
  title: string;
  message: string;
  confirm?: string;
  cancel?: string;
  danger?: boolean;
  /** Show a close button that resolves to null (third choice). */
  allowDismiss?: boolean;
}
interface PromptOpts {
  title: string;
  message?: string;
  value?: string;
  placeholder?: string;
  confirm?: string;
  /** Select only the part before the extension, like Finder renames. */
  selectBaseName?: boolean;
}

export interface FormField {
  key: string;
  label: string;
  value?: string;
  placeholder?: string;
  multiline?: boolean;
  /** Required fields must be filled before the form can be confirmed. */
  required?: boolean;
  /** Adds a "찾아보기" button that fills the field. */
  browse?: () => Promise<string | null>;
}
interface FormOpts {
  title: string;
  message?: string;
  fields: FormField[];
  confirm?: string;
}

type Dialog =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean | null) => void }
  | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void }
  | { kind: "form"; opts: FormOpts; resolve: (v: Record<string, string> | null) => void };

const useDialogs = create<{ current?: Dialog }>(() => ({}));

export function confirmDialog(opts: ConfirmOpts): Promise<boolean | null> {
  return new Promise((resolve) => useDialogs.setState({ current: { kind: "confirm", opts, resolve } }));
}

export function promptDialog(opts: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => useDialogs.setState({ current: { kind: "prompt", opts, resolve } }));
}

/** A small form in the app (WKWebView has no window.prompt). Resolves to the values, or null. */
export function formDialog(opts: FormOpts): Promise<Record<string, string> | null> {
  return new Promise((resolve) => useDialogs.setState({ current: { kind: "form", opts, resolve } }));
}

function FormBody({ opts, close }: { opts: FormOpts; close: (v: Record<string, string> | null) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(opts.fields.map((f) => [f.key, f.value ?? ""])));
  const ok = opts.fields.every((f) => !f.required || values[f.key]?.trim());
  const submit = () => ok && close(values);
  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));
  return (
    <>
      <div className="form-fields">
        {opts.fields.map((f, i) => (
          <label key={f.key} className="form-field">
            <span className="muted small">{f.label}</span>
            <div className="row">
              {f.multiline ? (
                <textarea
                  className="text-input"
                  rows={4}
                  autoFocus={i === 0}
                  value={values[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.key, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && submit()}
                />
              ) : (
                <input
                  className="text-input"
                  autoFocus={i === 0}
                  value={values[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.key, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && submit()}
                />
              )}
              {f.browse && (
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={async () => {
                    const v = await f.browse!();
                    if (v) set(f.key, v);
                  }}
                >
                  찾아보기
                </button>
              )}
            </div>
          </label>
        ))}
      </div>
      <div className="dialog-actions">
        <button className="btn" onClick={() => close(null)}>
          취소
        </button>
        <button className="btn btn-primary" disabled={!ok} onClick={submit}>
          {opts.confirm ?? "확인"}
        </button>
      </div>
    </>
  );
}

export function DialogHost() {
  const current = useDialogs((s) => s.current);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (current?.kind === "prompt") {
      setValue(current.opts.value ?? "");
      setTimeout(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        const v = current.opts.value ?? "";
        const dot = v.lastIndexOf(".");
        if (current.opts.selectBaseName && dot > 0) el.setSelectionRange(0, dot);
        else el.select();
      }, 0);
    }
  }, [current]);

  if (!current) return null;
  const close = (v: any) => {
    useDialogs.setState({ current: undefined });
    current.resolve(v);
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(current.kind === "confirm" && !current.opts.allowDismiss ? false : null)}>
      <div
        className="dialog"
        role="dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") close(current.kind === "confirm" && !current.opts.allowDismiss ? false : null);
        }}
      >
        <h3>{current.opts.title}</h3>
        {current.opts.message && <p>{current.opts.message}</p>}
        {current.kind === "form" && <FormBody key={current.opts.title} opts={current.opts} close={close} />}
        {current.kind === "prompt" && (
          <input
            ref={inputRef}
            className="text-input"
            value={value}
            placeholder={current.opts.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) close(value.trim() || null);
            }}
          />
        )}
        {current.kind !== "form" && <div className="dialog-actions">
          {current.kind === "confirm" ? (
            <>
              {current.opts.allowDismiss && (
                <button className="btn" onClick={() => close(null)}>
                  취소
                </button>
              )}
              <button className="btn" onClick={() => close(false)}>
                {current.opts.cancel ?? "취소"}
              </button>
              <button className={`btn ${current.opts.danger ? "btn-danger" : "btn-primary"}`} autoFocus onClick={() => close(true)}>
                {current.opts.confirm ?? "확인"}
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => close(null)}>
                취소
              </button>
              <button className="btn btn-primary" onClick={() => close(value.trim() || null)}>
                {current.opts.confirm ?? "확인"}
              </button>
            </>
          )}
        </div>}
      </div>
    </div>
  );
}
