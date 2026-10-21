// "tidyplots로" in the Plots pane: converts the figure the current plot's
// code draws (host figures.convert, R package rsageFigures), shows the
// conversion as a new plot, lets the user try colours, theme and size on
// it, and writes it back into the .qmd chunk after showing the change.
// What R cannot convert by rule goes to the assistant with the context.

import { create } from "zustand";
import { applyFigureConversion, type FigureConversion, type FigureOptions } from "@rsage/shared";
import { host } from "./host/client";
import { useStore } from "./store";
import { allCommands } from "./commands";
import { getModel, openInEditor } from "./editor/files";
import { send, useAssistant } from "./assistant";

export interface Conversion {
  result: FigureConversion;
  /** The code that drew the original figure, as it was run. */
  ranCode: string;
  /** The file it was run from, when it was run from the editor. */
  sourceFile?: string;
  options: FigureOptions;
}

/** Conversions by the execution that drew them in the Plots pane. */
export const useFigures = create<{ byExecution: Record<string, Conversion>; busy: boolean }>(() => ({ byExecution: {}, busy: false }));

export const STATUS_LABEL: Record<FigureConversion["status"], string> = {
  rule: "규칙 변환 · 확인됨",
  partial: "일부 변환 · ggplot 코드 남음",
  mismatch: "변환됨 · 원본과 다름",
  ai: "어시스턴트 필요",
  unsupported: "바꿀 수 없음",
  already: "이미 tidyplots",
  none: "그림 없음",
  error: "오류",
  missing: "패키지 필요",
};

const notify = (text: string, level: "info" | "error" = "info") => useStore.getState().notify(text, level);

/**
 * Converts the plot drawn by an execution. When that execution is itself a
 * conversion (the user changes colours on it), the original is converted
 * again with the new options.
 */
export async function convertExecution(executionId: string, options?: FigureOptions) {
  const prev = useFigures.getState().byExecution[executionId];
  const exec = useStore.getState().executions[executionId];
  const ranCode = prev?.ranCode ?? exec?.code;
  if (!ranCode?.trim()) return notify("이 플롯을 만든 코드를 찾지 못했습니다.", "error");
  const sourceFile = prev ? prev.sourceFile : exec?.source?.file;
  const opts = { ...prev?.options, ...options };
  useFigures.setState({ busy: true });
  try {
    const result = await host.call("figures.convert", { code: ranCode, options: opts });
    switch (result.status) {
      case "missing":
        return void offerInstall(result.missing ?? [], () => convertExecution(executionId, options));
      case "none":
        return notify("이 코드에서 그림을 찾지 못했습니다.", "error");
      case "already":
        return notify("이미 tidyplots로 그린 그림입니다.");
      case "error":
        return notify(`변환하지 못했습니다: ${result.message ?? "오류"}`, "error");
      case "unsupported":
        return notify(`tidyplots로 바꿀 수 없는 그림입니다. ${result.notes.join(" ")}`, "error");
      case "ai":
        return offerAssistant({ result, ranCode, sourceFile, options: opts });
    }
    if (result.previewExecutionId) {
      useFigures.setState((s) => ({ byExecution: { ...s.byExecution, [result.previewExecutionId!]: { result, ranCode, sourceFile, options: opts } } }));
    }
  } catch (e: any) {
    notify(`변환하지 못했습니다: ${e?.message ?? e}`, "error");
  } finally {
    useFigures.setState({ busy: false });
  }
}

/** Installs what the conversion needs, then converts again. */
async function offerInstall(pkgs: string[], then: () => Promise<void>) {
  const { confirmDialog } = await import("./components/Dialogs");
  const ok = await confirmDialog({
    title: "패키지 설치",
    message: `그림을 바꾸려면 R 패키지가 필요합니다: ${pkgs.join(", ")}. 설치한 뒤 이어서 바꿀까요?`,
    confirm: "설치",
  });
  if (!ok) return;
  const { installPackages } = await import("./packages");
  if (await installPackages(pkgs)) await then();
  else notify(`${pkgs.join(", ")} 설치에 실패했습니다. 콘솔을 확인해 주세요.`, "error");
}

async function offerAssistant(c: Conversion) {
  const { confirmDialog } = await import("./components/Dialogs");
  const why = c.result.notes.join(" ") || c.result.message || "규칙으로 바꿀 수 없는 그림입니다.";
  const ok = await confirmDialog({ title: "어시스턴트에게 맡기기", message: `${why} 어시스턴트에게 tidyplots로 바꿔 달라고 할까요?`, confirm: "맡기기" });
  if (ok) await askAssistant(c);
}

/** Hands the conversion to the assistant, with the code, what the rules did and how to check. */
export async function askAssistant(c: Conversion) {
  const fence = (code: string) => "```r\n" + code.replace(/\n+$/, "") + "\n```";
  const parts = [
    "이 그림을 tidyplots로 바꿔 주세요.",
    "",
    c.sourceFile ? `파일: ${c.sourceFile}` : "콘솔에서 그린 그림입니다 (파일 없음).",
    "그림을 그린 코드:",
    fence(c.ranCode),
  ];
  if (c.result.notes.length) parts.push("", `자동 변환에서 알린 점: ${c.result.notes.join(" ")}`);
  if (c.result.code) parts.push("", "규칙으로 바꾼 코드 (tidyplots에 없는 부분은 add()로 남김):", fence(c.result.code));
  if (c.result.checks?.some((k) => !k.ok)) {
    parts.push("", "원본과 다른 점: " + c.result.checks.filter((k) => !k.ok).map((k) => `${k.check} ${k.before} → ${k.after}`).join("; "));
  }
  parts.push(
    "",
    "할 일:",
    "1. tidyplot(), add_*(), adjust_*(), split_plot()으로 같은 그림을 그리세요. 데이터, 변수, 요약값(평균인지 중앙값인지, 오차막대가 SE인지 SD인지)은 원본과 같아야 합니다. base R 그림이면 먼저 tidy 데이터 프레임을 만드세요.",
    "2. run_r로 rsageFigures::check(before = \"<원본 코드>\", after = \"<새 코드>\")를 실행해 ok와 checks를 확인하세요. 원본이 ggplot이 아니면 새 그림을 그려 보여 주세요.",
    c.sourceFile
      ? "3. edit_file로 그 청크의 그림 코드만 바꾸세요. 청크 옵션(#|)은 그대로 두고, 문서에 library(tidyplots)가 없으면 setup 청크에 넣으세요."
      : "3. 바꾼 코드를 보여 주세요.",
  );
  allCommands().find((x) => x.id === "view.assistant")?.run();
  if (!useAssistant.getState().model) return notify("AI 조수에서 모델을 먼저 고르세요.", "error");
  await send(parts.join("\n"), c.sourceFile ? { file: c.sourceFile } : {});
}

/** Shows the change to the .qmd and applies it when the user agrees. */
export async function applyToDocument(c: Conversion) {
  if (!c.result.code || !c.result.target) return;
  if (!c.sourceFile || !/\.(qmd|rmd)$/i.test(c.sourceFile)) {
    return notify("Quarto 문서에서 실행한 그림만 문서에 반영할 수 있습니다. 코드를 복사해 쓰세요.", "error");
  }
  await openInEditor(c.sourceFile);
  const model = getModel(c.sourceFile);
  if (!model) return notify("문서를 열지 못했습니다.", "error");
  const before = model.getValue();
  const edit = applyFigureConversion(before, c.ranCode, c.result.target, c.result.code);
  if (!edit) return notify("그림을 그린 코드가 문서에서 바뀌어 찾지 못했습니다. 코드를 복사해 직접 붙여 넣으세요.", "error");
  const { confirmDialog } = await import("./components/Dialogs");
  const { DiffView } = await import("./components/AssistantPanel");
  const ok = await confirmDialog({
    title: "문서에 반영",
    message: `${c.sourceFile.split("/").pop()}의 그림 코드를 tidyplots 코드로 바꿉니다.${edit.addedLibrary ? " setup 청크에 library(tidyplots)를 넣습니다." : ""} ⌘Z로 되돌릴 수 있습니다.`,
    detail: <DiffView before={before} after={edit.text} />,
    confirm: "반영",
  });
  if (!ok) return;
  if (model.getValue() !== before) return notify("그사이 문서가 바뀌었습니다. 다시 반영해 주세요.", "error");
  // Only the changed span, so undo, the visual editor and the language server see a small edit.
  let a = 0;
  while (a < before.length && a < edit.text.length && before[a] === edit.text[a]) a++;
  let b = 0;
  while (b < before.length - a && b < edit.text.length - a && before[before.length - 1 - b] === edit.text[edit.text.length - 1 - b]) b++;
  const start = model.getPositionAt(a);
  const end = model.getPositionAt(before.length - b);
  model.pushEditOperations(
    [],
    [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: edit.text.slice(a, edit.text.length - b) }],
    () => null,
  );
  notify("문서에 반영했습니다. 저장하면 파일에 쓰입니다.");
}
