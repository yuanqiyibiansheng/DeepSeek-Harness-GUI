import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export default function FinishPage({ targetDir }: { targetDir: string }) {
  const { t } = useTranslation();
  const [launch, setLaunch] = useState(true);

  const finish = async () => {
    if (launch) {
      try {
        await invoke("launch_installed_app", { targetDir });
      } catch {}
    }
    try {
      await getCurrentWindow().close();
    } catch {}
  };

  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="page finish-page">
      <div className="success-mark">✓</div>
      <h1 className="page-title">{t("finish_title")}</h1>
      <p className="page-subtitle">{t("finish_desc")}</p>
      <label className="checkbox-label">
        <input type="checkbox" checked={launch} onChange={(e) => setLaunch(e.target.checked)} />
        <span className="checkbox-mark" />
        <span>{t("finish_launch")}</span>
      </label>
      <button className="btn-primary finish-btn" onClick={finish}>{t("finish_done")}</button>
    </motion.div>
  );
}