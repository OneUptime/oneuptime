/*
 * Admin > OneUptime Health (#7048), its production landing page from this
 * branch (/admin/health): "What needs attention" at the top - the same
 * findings `npm run doctor` prints - then, on the Community Edition, the
 * note about the Enterprise live overview and the tools every edition has,
 * over the server's answers kept in memory (Fixture/Answers.js).
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
import HealthPage from "../../../App/FeatureSet/AdminDashboard/src/Pages/Health/Index";
import Navigation from "Common/UI/Utils/Navigation";
import { language } from "./Answers";

function Fixture() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return <HealthPage />;
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
