import { useStore } from "./store";
import { Welcome } from "./components/Welcome";
import { Workbench } from "./components/Workbench";
import { DialogHost } from "./components/Dialogs";
import { Palette } from "./components/Palette";
import { FolderPickerHost } from "./components/FolderPicker";
import { SettingsDialog } from "./components/SettingsDialog";
import { AiSettingsDialog } from "./components/AiSettingsDialog";

export function App() {
  const connected = useStore((s) => s.connected);
  const project = useStore((s) => s.project);
  const toast = useStore((s) => s.toast);
  if (!connected) return <div className="splash">R Sage에 연결하는 중…</div>;
  return (
    <>
      {project ? <Workbench /> : <Welcome />}
      {!project && toast && <div className={`toast toast-${toast.level}`}>{toast.text}</div>}
      <Palette />
      <SettingsDialog />
      <AiSettingsDialog />
      <FolderPickerHost />
      <DialogHost />
    </>
  );
}
