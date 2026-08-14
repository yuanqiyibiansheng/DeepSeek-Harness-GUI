import { useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LuMinus, LuX } from "react-icons/lu";

export default function TitleBar() {
  const handleMouseDown = useCallback(async (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    try {
      await getCurrentWindow().startDragging();
    } catch {}
  }, []);

  const minimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch {}
  };

  const close = async () => {
    try {
      await getCurrentWindow().close();
    } catch {}
  };

  return (
    <div className="titlebar" onMouseDown={handleMouseDown}>
      <span className="titlebar-title">DeepSeek Harness Setup</span>
      <div className="titlebar-controls">
        <button className="titlebar-btn" onClick={minimize} aria-label="minimize">
          <LuMinus size={16} />
        </button>
        <button className="titlebar-btn titlebar-btn-close" onClick={close} aria-label="close">
          <LuX size={16} />
        </button>
      </div>
    </div>
  );
}