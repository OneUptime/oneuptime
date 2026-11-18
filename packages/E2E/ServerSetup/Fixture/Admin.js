/*
 * The Admin Dashboard's side of Server setup (#7027), its production pages
 * from this branch: Server setup (/admin/setup), Settings > Emails
 * (/admin/settings/smtp) and Settings > Call and SMS
 * (/admin/settings/call-and-sms), over the server's answers kept in memory
 * (Fixture/Checklist.js). A link between them - Set up email, say - moves
 * within the page, as in the Admin Dashboard, so what one page did the next
 * one reads.
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
import SetupPage from "../../../App/FeatureSet/AdminDashboard/src/Pages/Setup/Index";
import EmailSettings from "../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Email/Index";
import CallAndSmsSettings from "../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/CallSMS/Index";
import Navigation from "Common/UI/Utils/Navigation";
import { language } from "./Checklist";

function Fixture() {
  const location = useLocation();

  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(location);
  Navigation.setParams(useParams());

  if (location.pathname.startsWith("/admin/settings/smtp")) {
    return <EmailSettings />;
  }

  if (location.pathname.startsWith("/admin/settings/call-and-sms")) {
    return <CallAndSmsSettings />;
  }

  return <SetupPage />;
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
