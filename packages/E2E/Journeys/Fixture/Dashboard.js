/*
 * The Dashboard for the journey budgets: its own App (src/App.tsx) - the
 * header, the products menu, every route and side menu - from this branch,
 * over a project made a minute ago (Fixture/NewProject.js) kept in memory
 * (Fixture/Store.js). Only the data boundary and the signed-in person are
 * replaced; every page, form, dialog and menu a journey passes through is
 * the production one.
 *
 * Steered by the query string (kept for the tab, so a reload or a link
 * that drops it changes nothing):
 *   - seed=<a,b>   what earlier journeys left behind, so each journey can
 *                  start where a newcomer would: `monitor` (the website
 *                  monitor of the first journey)
 *   - as=member    signed in as Grace Hopper, a member invited a minute
 *                  ago, not as the project's owner
 *   - billing=on   OneUptime Cloud (server.js sets BILLING_ENABLED)
 *
 * Recorded on window.__journeyFixture: every write (`writes`: creates,
 * updates and deletes, with the misc data sent beside a create), every API
 * request a route answered (`api`), and every one none did (`unhandled`).
 */
import "Common/UI/Styles/Theme.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "../../../App/FeatureSet/Dashboard/src/App";
import { i18nReady } from "../../../App/FeatureSet/Dashboard/src/Utils/i18n";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import BaseAPI from "Common/Utils/API";
import Realtime from "Common/UI/Utils/Realtime";
import {
  createStore,
  installAnalyticsModelApi,
  installApi,
  installModelApi,
  silenceRealtime,
} from "./Store";
import {
  seedNewProject,
  signIn,
  dashboardRoutes,
  dashboardHooks,
} from "./NewProject";

// The query parameters, kept for the tab by server.js's boot script.
const params = window.__journeyParams || {};

const log = {
  writes: [],
  reads: [],
  api: [],
  unhandled: [],
};
window.__journeyFixture = log;

const project = seedNewProject({
  createStore,
  log,
  seeds: String(params.seed || "")
    .split(",")
    .filter(Boolean),
  billing: params.billing === "on",
});

signIn(project, params.as === "member" ? "member" : "owner");

installModelApi(ModelAPI, project.store, dashboardHooks(project));
installAnalyticsModelApi(AnalyticsModelAPI, project.store);
installApi([API, BaseAPI], project.store, dashboardRoutes(project));
silenceRealtime(Realtime);

await i18nReady.catch(() => {});

/*
 * As the Dashboard's src/Index.tsx renders it: each navigation renders at
 * once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <App />
  </BrowserRouter>,
);
