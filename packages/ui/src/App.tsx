import { useStore } from "./store";
import { Workbench } from "./components/Workbench";
import { DialogHost } from "./components/Dialogs";
import { Palette } from "./components/Palette";
import { FolderPickerHost } from "./components/FolderPicker";
import { SettingsDialog } from "./components/SettingsDialog";
import { AiSettingsDialog } from "./components/AiSettingsDialog";

export function App() {
  const connected = useStore((s) => s.connected);
  if (!connected) return <div className="splash">R Sage에 연결하는 중…</div>;
  return (
    <>
      <Workbench />
      <Palette />
      <SettingsDialog />
      <AiSettingsDialog />
      <FolderPickerHost />
      <DialogHost />
    </>
  );
}
