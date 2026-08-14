import { useTranslation } from "react-i18next";

const steps = ["step_welcome", "step_license", "step_directory", "step_install", "step_finish"] as const;

export default function StepIndicator({ currentStep }: { currentStep: number }) {
  const { t } = useTranslation();
  return (
    <div className="steps">
      {steps.map((key, index) => {
        const num = index + 1;
        const done = currentStep > num;
        const active = currentStep === num;
        return (
          <div key={key} className={`step ${active ? "active" : ""} ${done ? "done" : ""}`}>
            <div className="step-dot">{done ? "✓" : num}</div>
            <div className="step-label">{t(key)}</div>
          </div>
        );
      })}
    </div>
  );
}