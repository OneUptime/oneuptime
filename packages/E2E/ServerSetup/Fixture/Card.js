/*
 * The Dashboard's "This server is not finished" card (#7027), the
 * production component from this branch, where Home draws it: at the top
 * of the page, for the server's master admin, over the server's answers
 * kept in memory (Fixture/Checklist.js).
 */
import "Common/UI/Styles/Theme.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import ServerSetupCard from "../../../App/FeatureSet/Dashboard/src/Components/ServerSetup/ServerSetupCard";
import EN from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import { localeResources } from "../../SuiteHelpers/FixtureLocales";
import { language } from "./Checklist";

/*
 * English, the fallback, is in the bundle; German and Persian are each a
 * chunk of their own, loaded only by a page drawn in that language, as the
 * Dashboard loads a locale (SuiteHelpers/FixtureLocales.js).
 */
const LOCALE_LOADERS = {
  de: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/de.json");
  },
  fa: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/fa.json");
  },
};

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: "en",
  resources: await localeResources({
    language,
    english: EN,
    loaders: LOCALE_LOADERS,
  }),
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
// Dates in the reader's language, as the Dashboard's Utils/i18n.ts sets them.
followLanguageForDates(i18next);
document.documentElement.lang = language;
document.documentElement.dir = language === "fa" ? "rtl" : "ltr";

// Home's frame: the card first, above what Home holds.
function Home() {
  return (
    <main
      className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:px-8"
      data-testid="fixture-home"
    >
      <ServerSetupCard />
      <div
        className="rounded-lg border border-gray-200 bg-white p-6"
        data-testid="fixture-home-rest"
      />
    </main>
  );
}

/*
 * Navigates as the Dashboard does (its src/Index.tsx): each navigation
 * renders at once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <Home />
  </BrowserRouter>,
);
