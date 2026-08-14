import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

export default function LicensePage() {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -14 }}
      className="page"
    >
      <h1 className="page-title">{t("license_title")}</h1>
      <p className="page-subtitle">{t("license_desc")}</p>
      <div className="license-scroll">{t("license_body")}</div>
    </motion.div>
  );
}