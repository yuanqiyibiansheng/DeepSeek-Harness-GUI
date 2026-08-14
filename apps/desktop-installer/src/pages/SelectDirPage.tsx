import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

const REQUIRED_SPACE = 300_000_000;

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return (bytes / 1_000_000_000).toFixed(1) + " GB";
  if (bytes >= 1_000_000) return (bytes / 1_000_000).toFixed(0) + " MB";
  if (bytes >= 1_000) return (bytes / 1_000).toFixed(0) + " KB";
  return bytes + " B";
}

interface Props {
  onDirChange: (dir: string) => void;
  onValidChange: (valid: boolean) => void;
  createDesktopShortcut: boolean;
  onShortcutChange: (value: boolean) => void;
}

export default function SelectDirPage({ onDirChange, onValidChange, createDesktopShortcut, onShortcutChange }: Props) {
  const { t } = useTranslation();
  const [dir, setDir] = useState("");
  const [available, setAvailable] = useState(-1);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    invoke<string>("get_default_install_path").then((path) => {
      setDir(path);
      onDirChange(path);
      checkSpace(path);
    });
  }, []);

  useEffect(() => {
    onValidChange(available >= REQUIRED_SPACE);
  }, [available]);

  const checkSpace = async (path: string) => {
    try {
      setChecking(true);
      const space = await invoke<number>("check_disk_space", { path });
      setAvailable(space);
    } catch {
      setAvailable(0);
    } finally {
      setChecking(false);
    }
  };

  const browse = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        const target = selected + "\\DeepSeek Harness";
        setDir(target);
        onDirChange(target);
        checkSpace(target);
      }
    } catch {}
  };

  const change = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setDir(value);
    onDirChange(value);
    checkSpace(value);
  };

  const enough = available >= REQUIRED_SPACE;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -14 }}
      className="page"
    >
      <h1 className="page-title">{t("dir_title")}</h1>
      <p className="page-subtitle">{t("dir_desc")}</p>

      <div className="panel">
        <div className="dir-row">
          <input value={dir} onChange={change} placeholder="C:\\Program Files\\DeepSeek Harness" />
          <button className="btn-ghost" onClick={browse}>{t("dir_browse")}</button>
        </div>
        <div className="space-row">
          <div>
            <div className="space-label">{t("dir_space")}</div>
            <div className={enough ? "space-ok" : "space-bad"}>
              {checking ? "..." : formatSize(available)}
            </div>
          </div>
          <div>
            <div className="space-label">{t("dir_required")}</div>
            <div className="space-value">{formatSize(REQUIRED_SPACE)}</div>
          </div>
        </div>
      </div>

      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={createDesktopShortcut}
          onChange={(e) => onShortcutChange(e.target.checked)}
        />
        <span className="checkbox-mark" />
        <span>{t("finish_desktop")}</span>
      </label>

      {!enough && !checking && <div className="error-text">{t("error_space")}</div>}
    </motion.div>
  );
}