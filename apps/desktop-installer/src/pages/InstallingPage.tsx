import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  targetDir: string;
  createDesktopShortcut: boolean;
  onComplete: () => void;
}

export default function InstallingPage({ targetDir, createDesktopShortcut, onComplete }: Props) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState(t("install_copying"));
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    (async () => {
      try {
        for (let i = 0; i <= 60; i += 4) {
          setProgress(i);
          await sleep(22);
        }
        await invoke("install", { targetDir, createDesktopShortcut });
        setStatus(t("install_shortcuts"));
        for (let i = 60; i <= 88; i += 3) {
          setProgress(i);
          await sleep(18);
        }
        setStatus(t("install_register"));
        for (let i = 88; i < 100; i += 2) {
          setProgress(i);
          await sleep(12);
        }
        setStatus(t("install_done"));
        setProgress(100);
        await sleep(400);
        onComplete();
      } catch (error) {
        alert(t("error_generic") + "\n" + String(error));
      }
    })();
  }, []);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="page install-page">
      <h1 className="page-title">{t("install_title")}</h1>
      <p className="page-subtitle">{t("install_desc")}</p>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="progress-text">{progress}%</div>
      <div className="status-text">{status}</div>
    </motion.div>
  );
}