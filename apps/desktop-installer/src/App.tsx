import { useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import TitleBar from "./components/TitleBar";
import InstallerLayout from "./components/InstallerLayout";
import StepIndicator from "./components/StepIndicator";
import WelcomePage from "./pages/WelcomePage";
import LicensePage from "./pages/LicensePage";
import SelectDirPage from "./pages/SelectDirPage";
import InstallingPage from "./pages/InstallingPage";
import FinishPage from "./pages/FinishPage";

export default function App() {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [targetDir, setTargetDir] = useState("");
  const [dirValid, setDirValid] = useState(false);
  const [createDesktopShortcut, setCreateDesktopShortcut] = useState(true);

  useEffect(() => {
    void getCurrentWindow().show().catch(() => {});
  }, []);

  const canNext = step === 1 || step === 2 || (step === 3 && dirValid);
  const nextLabel = step === 1 ? t("btn_next") : step === 3 ? t("btn_install") : undefined;

  return (
    <div className={`stage stage-${Math.min(step, 3)}`}>
      <TitleBar />
      <StepIndicator currentStep={step} />
      <InstallerLayout
        currentStep={step}
        canGoBack={step > 1 && step < 4}
        canGoNext={step < 4 && canNext}
        nextLabel={nextLabel}
        onBack={step > 1 && step < 4 ? () => setStep((s) => s - 1) : undefined}
        onNext={step < 4 ? () => setStep((s) => s + 1) : undefined}
      >
        <AnimatePresence mode="wait">
          {step === 1 && <WelcomePage key="welcome" />}
          {step === 2 && <LicensePage key="license" />}
          {step === 3 && (
            <SelectDirPage
              key="dir"
              onDirChange={setTargetDir}
              onValidChange={setDirValid}
              createDesktopShortcut={createDesktopShortcut}
              onShortcutChange={setCreateDesktopShortcut}
            />
          )}
          {step === 4 && (
            <InstallingPage
              key="install"
              targetDir={targetDir}
              createDesktopShortcut={createDesktopShortcut}
              onComplete={() => setStep(5)}
            />
          )}
          {step === 5 && <FinishPage key="finish" targetDir={targetDir} />}
        </AnimatePresence>
      </InstallerLayout>
    </div>
  );
}
