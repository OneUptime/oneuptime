/*
 * Admin Dashboard > Settings > Products (#6815, #7480), its production page
 * from this branch (/admin/settings/products): the presets, what switching
 * off does, the ingestion notes and the switch per product folded away, in
 * the Admin Dashboard's Settings layout, over the server's answers kept in
 * the page (Fixture/AdminAnswers.js).
 */
import "Common/UI/Styles/Theme.css";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { i18nReady } from "../../../App/FeatureSet/AdminDashboard/src/Utils/i18n";
import SettingsProducts from "../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Products/Index";
import Navigation from "Common/UI/Utils/Navigation";
import { language } from "./AdminAnswers";

function Fixture() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return <SettingsProducts />;
}

/*
 * As the Admin Dashboard's src/Index.tsx starts: every language but English
 * is a chunk of its own (Utils/i18n.ts), so i18n first settles on the
 * language it detects, and only then is this page's language set.
 */
await i18nReady.catch(() => {});
await i18next.changeLanguage(language);
document.documentElement.lang = language;
document.documentElement.dir = language === "fa" ? "rtl" : "ltr";

/*
 * The Admin Dashboard mounts a bare BrowserRouter, so this one keeps React
 * Router's transitions (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Fixture />
  </BrowserRouter>,
);
