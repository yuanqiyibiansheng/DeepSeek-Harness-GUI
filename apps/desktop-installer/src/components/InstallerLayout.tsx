import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  currentStep: number;
  children: ReactNode;
  canGoBack?: boolean;
  canGoNext?: boolean;
  nextLabel?: string;
  onBack?: () => void;
  onNext?: () => void;
}

export default function InstallerLayout({ children, canGoBack, canGoNext, nextLabel, onBack, onNext }: Props) {
  const { t } = useTranslation();
  return (
    <div className="installer">
      <div className="installer-content">{children}</div>
      <div className="installer-footer">
        {onBack && (
          <button className="btn-secondary" onClick={onBack} disabled={!canGoBack}>
            {t("btn_back")}
          </button>
        )}
        {onNext && (
          <button className="btn-primary" onClick={onNext} disabled={!canGoNext}>
            {nextLabel || t("btn_next")}
          </button>
        )}
      </div>
    </div>
  );
}