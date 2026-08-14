import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

export default function WelcomePage() {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      className="page welcome"
    >
      <div className="panel">
        <h1 className="page-title">{t("welcome_title")}</h1>
        <p className="page-subtitle">{t("welcome_desc")}</p>
      </div>
    </motion.div>
  );
}