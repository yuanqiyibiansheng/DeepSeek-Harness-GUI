import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "./locales/zh.json";
import en from "./locales/en.json";

const language = navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";

i18n.use(initReactI18next).init({
  resources: { zh: { translation: zh }, en: { translation: en } },
  lng: language,
  fallbackLng: "zh",
  interpolation: { escapeValue: false },
});